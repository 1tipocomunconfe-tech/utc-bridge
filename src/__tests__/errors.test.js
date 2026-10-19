const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ERROR_TYPES,
  classifyError,
  createTransientError,
  createFatalError,
  assertPageSession,
  isSessionExpiredText,
  withTransientRetries,
} = require("../errors");

test("classifies transient and fatal automation failures", () => {
  assert.equal(classifyError(new Error("HTTP 429 rate limit")).type, ERROR_TYPES.TRANSIENTE);
  assert.equal(classifyError(new Error("Could not find caption selector")).type, ERROR_TYPES.FATAL);
  assert.equal(isSessionExpiredText("Please log in and enter your 2FA code"), true);
});

test("retries transient failures twice with one-minute and five-minute backoff", async () => {
  let attempts = 0;
  const waits = [];
  const result = await withTransientRetries(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw createTransientError("temporary network failure");
      }
      return "ok";
    },
    {
      wait: async (milliseconds) => waits.push(milliseconds),
      classify: (error) => error,
    }
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [60000, 300000]);
});

test("does not retry fatal failures", async () => {
  let attempts = 0;
  await assert.rejects(
    () => withTransientRetries(
      async () => {
        attempts += 1;
        throw createFatalError("selector missing");
      },
      { wait: async () => {}, classify: (error) => error }
    ),
    /selector missing/
  );
  assert.equal(attempts, 1);
});

test("detects a login redirect that appears after initial page load", async () => {
  let bodyReads = 0;
  const page = {
    locator: () => ({
      innerText: async () => {
        bodyReads += 1;
        return bodyReads === 1 ? "" : "Log in with QR code";
      },
    }),
    url: () => "https://www.tiktok.com/tiktokstudio/upload",
    waitForTimeout: async () => { },
  };

  await assert.rejects(
    () => assertPageSession(page, "tiktok"),
    /Session expired or login\/2FA required on tiktok/
  );
});
