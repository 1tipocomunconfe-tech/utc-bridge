const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { SeenRegistry } = require("../idempotency");
const { startDaemon } = require("../scheduler");
const { reconcileStartupState } = require("../startup-reconcile");

test("scheduler startup reconciles in-progress hashes before registering the first tick", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-startup-reconcile-"));
  const statePath = path.join(root, "seen.json");
  const registry = new SeenRegistry({ statePath, notifier: { notifyFailure: async () => {} } });
  const data = {
    accounts: {
      account: {
        tiktok: {
          hash: {
            status: "in-progress",
            videoPath: path.join(root, "clip.mp4"),
          },
        },
      },
    },
  };
  await fs.writeFile(statePath, `${JSON.stringify(data)}\n`);

  let scheduled = false;
  await startDaemon({
    reconcile: () => registry.reconcileInProgress(),
    schedule: () => {
      scheduled = true;
      return { stop() {} };
    },
  });

  const reconciled = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.equal(reconciled.accounts.account.tiktok.hash.status, "uncertain");
  assert.equal(scheduled, true);
});

test("startup sweep moves inconsistent pending and uncertain files before publishing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-queue-reconcile-"));
  const statePath = path.join(root, "seen.json");
  const directories = {
    tiktok: {
      pending: path.join(root, "tiktok", "pending"),
      posted: path.join(root, "tiktok", "posted"),
    },
    instagram: { pending: path.join(root, "instagram", "pending"), posted: path.join(root, "instagram", "posted") },
    youtube: { pending: path.join(root, "youtube", "pending"), posted: path.join(root, "youtube", "posted") },
  };
  const pendingConfirmed = path.join(directories.tiktok.pending, "confirmed.mp4");
  const pendingInProgress = path.join(directories.tiktok.pending, "in-progress.mp4");
  const uncertainConfirmed = path.join(root, "tiktok", "posted-uncertain", "uncertain.mp4");
  await Promise.all([
    fs.mkdir(directories.tiktok.pending, { recursive: true }),
    fs.mkdir(path.dirname(uncertainConfirmed), { recursive: true }),
  ]);
  await fs.writeFile(pendingConfirmed, "confirmed");
  await fs.writeFile(pendingInProgress, "in-progress");
  await fs.writeFile(uncertainConfirmed, "uncertain");
  const registry = new SeenRegistry({ statePath, notifier: { notifyFailure: async () => {} } });
  const confirmedHash = await registry.hashFile(pendingConfirmed);
  const inProgressHash = await registry.hashFile(pendingInProgress);
  const uncertainHash = await registry.hashFile(uncertainConfirmed);
  await fs.writeFile(statePath, `${JSON.stringify({ accounts: { account: { tiktok: {
    [confirmedHash]: { status: "confirmed", videoPath: pendingConfirmed },
    [inProgressHash]: { status: "in-progress", videoPath: pendingInProgress },
    [uncertainHash]: { status: "confirmed", videoPath: uncertainConfirmed },
  } } } })}\n`);

  const result = await reconcileStartupState({
    registry,
    accounts: [{ id: "account" }],
    getQueueDirs: () => directories,
    logger: () => {},
  });
  assert.equal(result.movements.length, 3);
  assert.equal(await fs.access(path.join(directories.tiktok.posted, "confirmed.mp4")).then(() => true), true);
  assert.equal(await fs.access(path.join(directories.tiktok, "posted-uncertain", "in-progress.mp4")).then(() => true), true);
  assert.equal(await fs.access(path.join(directories.tiktok.posted, "uncertain.mp4")).then(() => true), true);
});
