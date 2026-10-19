const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const {
  collectOperationsStatus,
  collectSessionsHealth,
  requeueFailedVideo,
} = require("../operations-state");

function makeDirs(root) {
  return {
    tiktok: { pending: path.join(root, "tiktok", "pending"), posted: path.join(root, "tiktok", "posted"), failed: path.join(root, "tiktok", "failed") },
    instagram: { pending: path.join(root, "instagram", "pending"), posted: path.join(root, "instagram", "posted"), failed: path.join(root, "instagram", "failed") },
    youtube: { pending: path.join(root, "youtube", "pending"), posted: path.join(root, "youtube", "posted"), failed: path.join(root, "youtube", "failed") },
  };
}

test("collects real queue counts, schedules, quotas and recent errors", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-operations-"));
  const dirs = makeDirs(root);
  for (const platform of Object.values(dirs)) {
    await Promise.all(Object.values(platform).map((directory) => fs.mkdir(directory, { recursive: true })));
  }
  await fs.writeFile(path.join(dirs.tiktok.pending, "next.mp4"), "video");
  await fs.writeFile(path.join(dirs.tiktok.pending, "next.meta.json"), JSON.stringify({ scheduledAt: "2026-10-20T12:00:00Z" }));
  await fs.writeFile(path.join(dirs.tiktok.posted, "old.mp4"), "video");
  await fs.writeFile(path.join(dirs.tiktok.failed, "bad.mp4"), "video");
  await fs.writeFile(path.join(dirs.tiktok.failed, "bad.mp4.error.json"), JSON.stringify({ motivo: "Session expired", tipo: "FATAL", timestamp: "2026-10-19T10:00:00Z" }));

  const accounts = [{ id: "creator", name: "Creator" }];
  const daemon = { getStatus: async () => ({ running: true, lastRunAt: "2026-10-19T11:00:00Z", lastResult: { ok: false, error: "Session expired" }, logs: [] }) };
  const limits = { getStatus: async (_accountId, platform) => ({ count: platform === "tiktok" ? 1 : 0, cap: 2, remaining: platform === "tiktok" ? 1 : 2 }) };
  const status = await collectOperationsStatus({
    accounts,
    getQueueDirs: () => dirs,
    getDaemons: async () => ({ tiktok: daemon, instagram: daemon, youtube: daemon }),
    limits,
    now: new Date("2026-10-19T12:00:00Z"),
  });

  const tiktok = status.accounts.creator.platforms.tiktok;
  assert.deepEqual(tiktok.counts, { pending: 1, posted: 1, failed: 1 });
  assert.equal(tiktok.nextScheduledAt, "2026-10-20T12:00:00.000Z");
  assert.equal(tiktok.quota.count, 1);
  assert.equal(tiktok.recentErrors[0].motivo, "Session expired");
});

test("marks expired sessions suspicious and requeues a failed video safely", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-health-"));
  const dirs = makeDirs(root);
  await Promise.all(Object.values(dirs.tiktok).map((directory) => fs.mkdir(directory, { recursive: true })));
  await fs.writeFile(path.join(dirs.tiktok.failed, "retry.mp4"), "video");
  await fs.writeFile(path.join(dirs.tiktok.failed, "retry.description"), "caption");
  const profileDir = path.join(root, "profile");
  await fs.mkdir(profileDir, { recursive: true });

  const daemon = { getStatus: async () => ({ lastResult: { ok: false, error: "Session expired; login required" }, logs: [] }) };
  const health = await collectSessionsHealth({
    accounts: [{ id: "creator", name: "Creator" }],
    getProfileDir: async () => profileDir,
    hasSession: async () => true,
    getDaemons: async () => ({ tiktok: daemon, instagram: daemon, youtube: daemon }),
  });
  assert.equal(health.accounts.creator.platforms.tiktok.profileExists, true);
  assert.equal(health.accounts.creator.platforms.tiktok.suspiciousExpiration, true);
  assert.equal(health.accounts.creator.platforms.tiktok.cookiesLikelyValid, false);

  const result = await requeueFailedVideo({ accountId: "creator", platform: "tiktok", fileName: "retry.mp4", getQueueDirs: () => dirs });
  assert.equal(result.ok, true);
  assert.equal(await fs.readFile(path.join(dirs.tiktok.pending, "retry.mp4"), "utf8"), "video");
  assert.equal(await fs.readFile(path.join(dirs.tiktok.pending, "retry.description"), "utf8"), "caption");
  await assert.rejects(
    () => requeueFailedVideo({ accountId: "creator", platform: "tiktok", fileName: "../retry.mp4", getQueueDirs: () => dirs }),
    /safe fileName/
  );
});
