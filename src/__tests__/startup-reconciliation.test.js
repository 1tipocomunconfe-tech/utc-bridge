const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { SeenRegistry } = require("../idempotency");
const { startDaemon } = require("../scheduler");

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
