const test = require("node:test");
const assert = require("node:assert/strict");

const { _private: tiktokPrivate } = require("../tiktok-uploader");
const { _private: instagramPrivate } = require("../instagram-uploader");

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
