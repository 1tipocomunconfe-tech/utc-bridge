const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { ERROR_TYPES } = require("../errors");
const { SeenRegistry } = require("../idempotency");
const { LimitsStore } = require("../limits");
const { getNextQueuedItem } = require("../queue");
const { postWithResult } = require("../post-finalizer");
const { _private: youtubePrivate } = require("../youtube-uploader");

test("orphaned idempotency lock becomes uncertain and notifies", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-orphan-lock-"));
  const statePath = path.join(root, "seen.json");
  const lockPath = `${statePath}.lock`;
  const notifications = [];
  await fs.writeFile(lockPath, JSON.stringify({
    pid: 99999999,
    host: os.hostname(),
    acquiredAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
    accountId: "account",
    platform: "youtube",
    hash: "orphan-hash",
    videoPath: path.join(root, "clip.mp4"),
  }));

  const registry = new SeenRegistry({
    statePath,
    staleLockMs: 30 * 60 * 1000,
    notifier: { notifyFailure: async (payload) => notifications.push(payload) },
  });
  const result = await registry.claim("account", "youtube", "orphan-hash", path.join(root, "clip.mp4"));
  assert.equal(result.claimed, false);
  assert.equal(result.existing.status, "uncertain");
  await assert.rejects(fs.access(lockPath), { code: "ENOENT" });
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.equal(state.accounts.account.youtube["orphan-hash"].status, "uncertain");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notifications.length, 1);
});

test("fresh lock from a live process is never removed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-fresh-lock-"));
  const statePath = path.join(root, "seen.json");
  const lockPath = `${statePath}.lock`;
  await fs.writeFile(lockPath, JSON.stringify({
    pid: process.pid,
    host: os.hostname(),
    acquiredAt: new Date().toISOString(),
    accountId: "account",
    platform: "tiktok",
    hash: "fresh-hash",
  }));
  const registry = new SeenRegistry({ statePath, staleLockMs: 30 * 60 * 1000 });
  const result = await registry.claim("account", "tiktok", "fresh-hash", "clip.mp4");
  assert.equal(result.existing.status, "lock-held");
  await fs.access(lockPath);
  await fs.unlink(lockPath);
});

test("concurrent quota reservations stay within the cap", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-limits-lock-"));
  const storeOptions = {
    statePath: path.join(root, "limits.json"),
    timezone: "UTC",
    caps: { tiktok: 2, instagram: 2, youtube: 2 },
    staleLockMs: 100,
  };
  const stores = Array.from({ length: 8 }, () => new LimitsStore(storeOptions));
  const results = await Promise.all(stores.map((store) => store.reserve("account", "tiktok", new Date("2026-10-21T12:00:00Z"))));
  assert.equal(results.filter((result) => result.ok).length, 2);
  assert.equal((await stores[0].getStatus("account", "tiktok", new Date("2026-10-21T12:00:00Z"))).count, 2);
});

test("daily cap one permits exactly one concurrent reservation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-limits-cap-one-"));
  const options = {
    statePath: path.join(root, "limits.json"),
    timezone: "UTC",
    caps: { tiktok: 1, instagram: 2, youtube: 2 },
    staleLockMs: 100,
  };
  const stores = [new LimitsStore(options), new LimitsStore(options)];
  const at = new Date("2026-10-21T12:00:00Z");
  const results = await Promise.all(stores.map((store) => store.reserve("account", "tiktok", at)));

  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok).length, 1);
  assert.equal((await stores[0].getStatus("account", "tiktok", at)).count, 1);
});

test("YouTube processing is uncertain, not confirmed", async () => {
  const page = {
    url: () => "https://studio.youtube.com/video/upload",
    locator: () => ({ innerText: async () => "Video processing" }),
    waitForTimeout: async () => {},
  };
  const result = await youtubePrivate.waitForPublishConfirmation(page);
  assert.equal(result.ok, false);
  assert.equal(result.status, "uncertain");
  assert.match(result.reason, /processing/i);
});

test("corrupt metadata publishes with the legacy txt caption", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-meta-chaos-"));
  const videoPath = path.join(root, "clip.mp4");
  await fs.writeFile(videoPath, "video");
  await fs.writeFile(path.join(root, "clip.meta.json"), "{{{{");
  await fs.writeFile(path.join(root, "clip.txt"), "Legacy caption used");
  const item = await getNextQueuedItem(root);
  let publishedCaption = null;
  const result = await postWithResult({
    platform: "tiktok",
    videoPath: item.videoPath,
    caption: item.caption,
    metadata: item.metadata,
    postedDir: path.join(root, "posted"),
    failedDir: path.join(root, "failed"),
    accountId: "account",
    seen: new SeenRegistry({ statePath: path.join(root, "seen.json") }),
    uploadVideoFn: async ({ caption }) => {
      publishedCaption = caption;
      return { ok: true, status: "confirmed" };
    },
  });
  assert.equal(result.status, "confirmed");
  assert.equal(publishedCaption, "Legacy caption used");
});

test("uncertain publication moves to posted-uncertain and notifies", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-uncertain-"));
  const videoPath = path.join(root, "clip.mp4");
  const notifications = [];
  await fs.writeFile(videoPath, "video");
  const result = await postWithResult({
    platform: "youtube",
    videoPath,
    postedDir: path.join(root, "posted"),
    failedDir: path.join(root, "failed"),
    uncertainDir: path.join(root, "posted-uncertain"),
    accountId: "account",
    seen: new SeenRegistry({ statePath: path.join(root, "seen.json") }),
    notifier: { notifyFailure: async (payload) => notifications.push(payload) },
    uploadVideoFn: async () => ({
      ok: false,
      status: "uncertain",
      error: "YouTube still reports processing.",
      errorType: ERROR_TYPES.DUDOSO,
    }),
  });
  assert.equal(result.status, "uncertain");
  assert.equal((await fs.readdir(path.join(root, "posted-uncertain"))).some((name) => name.endsWith(".mp4")), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notifications.length, 1);
});

test("uploaders preserve the manual-login contract", async () => {
  for (const fileName of ["tiktok-uploader.js", "instagram-uploader.js", "youtube-uploader.js"]) {
    const source = await fs.readFile(path.join(__dirname, "..", fileName), "utf8");
    assert.doesNotMatch(source, /password|captcha/i, `${fileName} must not automate credentials or captchas`);
  }
});
