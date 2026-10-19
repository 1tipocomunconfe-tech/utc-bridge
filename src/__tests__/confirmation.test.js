const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { _private: tiktokPrivate } = require("../tiktok-uploader");
const { _private: instagramPrivate } = require("../instagram-uploader");
const { postWithResult } = require("../post-finalizer");
const { SeenRegistry } = require("../idempotency");
const { ERROR_TYPES } = require("../errors");

function createPage({ bodyText = "", confirmationTexts = [], url }) {
  const emptyLocator = {
    allInnerTexts: async () => confirmationTexts,
    count: async () => 0,
    click: async () => {},
    filter() {
      return this;
    },
    first() {
      return this;
    },
    locator() {
      return this;
    },
    nth() {
      return this;
    },
    isVisible: async () => false,
  };

  return {
    url: () => url,
    evaluate: async () => false,
    locator(selector) {
      if (selector === "body") {
        return { innerText: async () => bodyText };
      }
      return emptyLocator;
    },
    getByRole: () => emptyLocator,
    waitForTimeout: async () => {},
  };
}

test("generic Posted/Shared body text without a confirmation element is uncertain", async () => {
  const tiktok = await tiktokPrivate.waitForPublishConfirmation(
    createPage({ bodyText: "Posted", url: "https://www.tiktok.com/tiktokstudio/upload" }),
    { failure: () => null, success: () => false }
  );
  const instagram = await instagramPrivate.waitForPostConfirmation(
    createPage({ bodyText: "Shared", url: "https://www.instagram.com/create/style/" }),
    "https://www.instagram.com/create/style/"
  );

  assert.equal(tiktok.ok, false);
  assert.equal(tiktok.status, "uncertain");
  assert.equal(instagram.ok, false);
  assert.equal(instagram.status, "uncertain");
});

test("specific confirmation element or post permalink is accepted", async () => {
  const tiktokElement = await tiktokPrivate.waitForPublishConfirmation(
    createPage({
      bodyText: "Posted",
      confirmationTexts: ["Video published successfully"],
      url: "https://www.tiktok.com/tiktokstudio/upload",
    }),
    { failure: () => null, success: () => false }
  );
  const instagramUrl = await instagramPrivate.waitForPostConfirmation(
    createPage({
      bodyText: "Shared",
      url: "https://www.instagram.com/reel/ABC123/",
    }),
    "https://www.instagram.com/create/style/"
  );

  assert.equal(tiktokElement.ok, true);
  assert.equal(instagramUrl.ok, true);
});

test("posted-uncertain is archived with a report and never retried automatically", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-confirmation-uncertain-"));
  const pendingPath = path.join(root, "pending", "clip.mp4");
  const seen = new SeenRegistry({ statePath: path.join(root, "seen.json") });
  const notifications = [];
  let uploadCalls = 0;
  await fs.mkdir(path.dirname(pendingPath), { recursive: true });
  await fs.writeFile(pendingPath, "video");

  const first = await postWithResult({
    platform: "tiktok",
    videoPath: pendingPath,
    postedDir: path.join(root, "posted"),
    failedDir: path.join(root, "failed"),
    uncertainDir: path.join(root, "posted-uncertain"),
    accountId: "account",
    seen,
    notifier: { notifyFailure: async (payload) => notifications.push(payload) },
    uploadVideoFn: async () => {
      uploadCalls += 1;
      return { ok: false, status: "uncertain", error: "No specific confirmation", errorType: ERROR_TYPES.DUDOSO };
    },
  });
  assert.equal(first.status, "uncertain");
  assert.equal(uploadCalls, 1);
  assert.equal((await fs.readdir(path.join(root, "posted-uncertain"))).some((name) => name.endsWith(".error.json")), true);

  const retryPath = path.join(root, "retry", "clip.mp4");
  await fs.mkdir(path.dirname(retryPath), { recursive: true });
  await fs.writeFile(retryPath, "video");
  const second = await postWithResult({
    platform: "tiktok",
    videoPath: retryPath,
    postedDir: path.join(root, "posted-2"),
    failedDir: path.join(root, "failed-2"),
    uncertainDir: path.join(root, "posted-uncertain-2"),
    accountId: "account",
    seen,
    uploadVideoFn: async () => {
      uploadCalls += 1;
      return { ok: true, status: "confirmed" };
    },
  });
  assert.equal(second.skipped, true);
  assert.match(second.reason, /human review/i);
  assert.equal(uploadCalls, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notifications.length, 1);
});
