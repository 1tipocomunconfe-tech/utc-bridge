const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { SeenRegistry } = require("../idempotency");

test("seen registry blocks the same hash after a new instance", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-seen-"));
  const videoPath = path.join(root, "clip.mp4");
  const statePath = path.join(root, ".scheduler-state", "seen.json");
  await fs.writeFile(videoPath, "same-video");

  const first = new SeenRegistry({ statePath });
  const hash = await first.hashFile(videoPath);
  assert.equal((await first.claim("account", "tiktok", hash, videoPath)).claimed, true);

  const restarted = new SeenRegistry({ statePath });
  const secondClaim = await restarted.claim("account", "tiktok", hash, videoPath);
  assert.equal(secondClaim.claimed, false);
  assert.equal(secondClaim.existing.status, "in-progress");
});
