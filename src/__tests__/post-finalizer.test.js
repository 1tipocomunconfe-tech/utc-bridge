const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { ERROR_TYPES } = require("../errors");
const { SeenRegistry } = require("../idempotency");
const { postWithResult } = require("../post-finalizer");

test("fatal upload moves video to failed and writes error report", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-failure-"));
  const videoPath = path.join(root, "clip.mp4");
  const failedDir = path.join(root, "failed");
  const postedDir = path.join(root, "posted");
  const uncertainDir = path.join(root, "posted-uncertain");
  await fs.writeFile(videoPath, "video");

  const result = await postWithResult({
    platform: "tiktok",
    videoPath,
    postedDir,
    failedDir,
    uncertainDir,
    accountId: "account",
    seen: new SeenRegistry({ statePath: path.join(root, "seen.json") }),
    uploadVideoFn: async () => ({
      ok: false,
      status: "failed",
      error: "Could not find caption selector.",
      errorType: ERROR_TYPES.FATAL,
      screenshotPath: "/tmp/fatal.png",
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  const failedFiles = await fs.readdir(failedDir);
  assert.equal(failedFiles.filter((name) => name.endsWith(".mp4")).length, 1);
  const report = JSON.parse(await fs.readFile(path.join(failedDir, result.errorReport.split(path.sep).pop()), "utf8"));
  assert.equal(report.tipo, ERROR_TYPES.FATAL);
  assert.equal(report.screenshot, "/tmp/fatal.png");
  assert.ok(report.timestamp);
});

test("dispatches a success notification without delaying finalization", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-success-"));
  const videoPath = path.join(root, "clip.mp4");
  const notifications = [];
  await fs.writeFile(videoPath, "video");

  const result = await postWithResult({
    platform: "youtube",
    videoPath,
    postedDir: path.join(root, "posted"),
    failedDir: path.join(root, "failed"),
    accountId: "creator",
    seen: new SeenRegistry({ statePath: path.join(root, "seen.json") }),
    notifier: {
      notifySuccess: async (payload) => notifications.push(payload),
    },
    uploadVideoFn: async () => ({ ok: true, status: "confirmed" }),
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.ok, true);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].platform, "youtube");
  assert.equal(notifications[0].accountId, "creator");
});
