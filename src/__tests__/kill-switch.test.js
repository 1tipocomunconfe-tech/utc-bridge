const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const {
  getKillSwitchReason,
  isKillSwitchEnabled,
  setKillSwitchSourceForTest,
  stopControllerIfKilled,
} = require("../kill-switch");
const { DaemonController } = require("../daemon-controller");

test("recognizes KILL_SWITCH true values and exposes a clear reason", () => {
  assert.equal(isKillSwitchEnabled(true), true);
  assert.equal(isKillSwitchEnabled("TRUE"), true);
  assert.equal(isKillSwitchEnabled(false), false);
  assert.match(getKillSwitchReason(), /KILL_SWITCH=true/);
});

test("stops a controller only when the kill-switch is enabled", () => {
  let stops = 0;
  const logs = [];
  const controller = { stop: () => { stops += 1; } };
  assert.equal(stopControllerIfKilled(controller, (message) => logs.push(message), false), false);
  assert.equal(stops, 0);
  assert.equal(stopControllerIfKilled(controller, (message) => logs.push(message), true), true);
  assert.equal(stops, 1);
  assert.equal(logs.length, 1);
});

test("a live daemon observes a kill-switch file change on the next tick", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-kill-live-"));
  const envPath = path.join(root, ".env");
  await fs.writeFile(envPath, "KILL_SWITCH=false\n");
  setKillSwitchSourceForTest(envPath);
  try {
    const daemon = new DaemonController({
      accountId: "kill-test",
      queueDir: path.join(root, "pending"),
      postedDir: path.join(root, "posted"),
      failedDir: path.join(root, "failed"),
      statePath: path.join(root, "scheduler.json"),
    });
    daemon.cronExpression = "*/5 * * * * *";
    daemon.schedulePlan = { type: "cron", expression: daemon.cronExpression };
    assert.equal(daemon.start().paused, undefined);
    await fs.writeFile(envPath, "KILL_SWITCH=true\n");
    const result = await daemon.runOnce("integration-tick");
    assert.equal(result.paused, true);
    assert.equal(daemon.task, null);
  } finally {
    setKillSwitchSourceForTest(path.resolve(__dirname, "../..", ".env"));
  }
});
