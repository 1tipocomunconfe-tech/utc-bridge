const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { LimitsStore } = require("../limits");
const { createSchedulerPolicy, isWithinPublishWindow } = require("../scheduler");
const { getNextQueuedItemForPlatform } = require("../queue");

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "autosocial-scheduler-"));
}

function makeItem(scheduledAt = null) {
  return {
    videoPath: "/queue/video.mp4",
    metadata: {
      scheduledAt,
    },
  };
}

function makePolicy(root, options = {}) {
  const now = options.now || new Date("2026-10-21T12:00:00.000Z");
  return createSchedulerPolicy({
    accountId: "test-account",
    platform: "tiktok",
    queueDir: path.join(root, "queue"),
    statePath: path.join(root, "scheduler.json"),
    limitsStatePath: path.join(root, "limits.json"),
    getNextQueuedItem: options.getNextQueuedItem || (async () => makeItem()),
    clock: () => now,
    limits: options.limits,
    postDelayMs: options.postDelayMs ?? 0,
    jitterMaxMs: options.jitterMaxMs ?? 0,
    random: options.random || (() => 0),
    wait: options.wait || (async () => {}),
    windowStart: options.windowStart || "00:00",
    windowEnd: options.windowEnd || "23:59",
    timezone: "UTC",
  });
}

test("defers a video scheduled in the future", async () => {
  const root = await makeTempDir();
  const policy = makePolicy(root, {
    getNextQueuedItem: async () => makeItem("2026-10-21T13:00:00.000Z"),
  });

  const result = await policy.prepare();

  assert.equal(result.skipped, true);
  assert.match(result.reason, /deferred until/);
});

test("prioritizes a due scheduled video over alphabetical order", async () => {
  const root = await makeTempDir();
  const queueDir = path.join(root, "queue");
  await fs.mkdir(queueDir, { recursive: true });
  await fs.writeFile(path.join(queueDir, "a-future.mp4"), "future");
  await fs.writeFile(
    path.join(queueDir, "a-future.meta.json"),
    JSON.stringify({ scheduledAt: "2026-10-21T13:00:00.000Z" })
  );
  await fs.writeFile(path.join(queueDir, "z-due.mp4"), "due");
  await fs.writeFile(
    path.join(queueDir, "z-due.meta.json"),
    JSON.stringify({ scheduledAt: "2026-10-21T11:00:00.000Z" })
  );

  const item = await getNextQueuedItemForPlatform(
    queueDir,
    "tiktok",
    new Date("2026-10-21T12:00:00.000Z")
  );

  assert.equal(path.basename(item.videoPath), "z-due.mp4");
});

test("defers when the daily quota is exhausted", async () => {
  const root = await makeTempDir();
  const limits = new LimitsStore({
    statePath: path.join(root, "limits.json"),
    timezone: "UTC",
    clock: () => new Date("2026-10-21T12:00:00.000Z"),
    caps: { tiktok: 1, instagram: 2, youtube: 2 },
  });
  await limits.reserve("test-account", "tiktok");
  const policy = makePolicy(root, { limits });

  const result = await policy.prepare();

  assert.equal(result.skipped, true);
  assert.match(result.reason, /Daily cap exhausted/);
});

test("defers outside the configured publication window", async () => {
  const root = await makeTempDir();
  const policy = makePolicy(root, {
    now: new Date("2026-10-21T23:00:00.000Z"),
    windowStart: "08:00",
    windowEnd: "22:00",
  });

  const result = await policy.prepare();

  assert.equal(result.skipped, true);
  assert.match(result.reason, /window closed/);
  assert.equal(isWithinPublishWindow(new Date("2026-10-21T12:00:00Z"), "08:00", "22:00", "UTC"), true);
});

test("adds jitter to the configured post delay", async () => {
  const root = await makeTempDir();
  let waited = 0;
  const policy = makePolicy(root, {
    postDelayMs: 1000,
    jitterMaxMs: 120000,
    random: () => 0.5,
    wait: async (milliseconds) => {
      waited = milliseconds;
    },
  });

  const result = await policy.prepare();

  assert.equal(result.ok, true);
  assert.equal(result.jitterMs, 60000);
  assert.equal(result.totalDelayMs, 61000);
  assert.equal(waited, 60000);
  await policy.finish(result, { ok: false });
});

test("persisted lock blocks a second scheduler after restart", async () => {
  const root = await makeTempDir();
  const options = {
    getNextQueuedItem: async () => makeItem(),
  };
  const first = makePolicy(root, options);
  const firstPrepared = await first.prepare();
  assert.equal(firstPrepared.ok, true);

  const restarted = makePolicy(root, options);
  const secondPrepared = await restarted.prepare();

  assert.equal(secondPrepared.skipped, true);
  assert.match(secondPrepared.reason, /Publication already in progress|publication lock/);
  await first.finish(firstPrepared, { ok: false });
});
