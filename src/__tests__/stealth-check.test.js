const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");

test("stealth-check is local and isolated from production profiles", async () => {
  const script = await fs.readFile(path.resolve(__dirname, "../../scripts/stealth-check.js"), "utf8");
  const forbiddenThirdPartyFixture = ["sanny", "soft"].join("");
  assert.doesNotMatch(script, new RegExp(forbiddenThirdPartyFixture, "i"));
  assert.doesNotMatch(script, /getPlatformProfileDir/);
  assert.doesNotMatch(script, /getAccountProxy/);
  assert.match(script, /mkdtemp/);
  assert.match(script, /127\.0\.0\.1/);
});
