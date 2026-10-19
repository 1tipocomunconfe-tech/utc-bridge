const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { Notifier, normalizeLevel } = require("../notifier");

test("normalizes notification levels and stays silent without destinations", async () => {
  assert.equal(normalizeLevel("ALL"), "all");
  assert.equal(normalizeLevel("invalid"), "errors");
  let calls = 0;
  const notifier = new Notifier({ fetchImpl: async () => { calls += 1; } });
  const result = await notifier.notifySuccess({ platform: "tiktok", videoPath: "clip.mp4" });
  assert.equal(result.skipped, true);
  assert.equal(calls, 0);
});

test("sends success to Telegram and Discord through mocked fetch", async () => {
  const requests = [];
  const notifier = new Notifier({
    level: "success",
    telegramBotToken: "bot-token",
    telegramChatId: "chat-id",
    discordWebhookUrl: "https://discord.test/webhook",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 200 };
    },
  });

  const result = await notifier.notifySuccess({
    platform: "youtube",
    accountId: "creator",
    videoPath: "/queue/clip.mp4",
    publishedAt: "2026-10-19T12:00:00.000Z",
  });

  assert.equal(result.sent, true);
  assert.equal(requests.length, 2);
  assert.match(requests[0].init.body, /creator/);
  assert.match(requests[1].init.body, /youtube/);
});

test("attaches a screenshot and retries a failed notification once", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-notifier-"));
  const screenshotPath = path.join(root, "failure.png");
  await fs.writeFile(screenshotPath, "png");
  let calls = 0;
  const notifier = new Notifier({
    level: "errors",
    discordWebhookUrl: "https://discord.test/webhook",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 503 };
      }
      return { ok: true, status: 204 };
    },
    sleep: async () => { },
  });

  const result = await notifier.notifyFailure({
    platform: "instagram",
    videoPath: "/queue/clip.mp4",
    error: "UI rejected publication",
    screenshotPath,
  });

  assert.equal(result.sent, true);
  assert.equal(calls, 2);
});

test("session notification includes the required human re-login warning", async () => {
  let body = "";
  const notifier = new Notifier({
    level: "errors",
    telegramBotToken: "bot-token",
    telegramChatId: "chat-id",
    fetchImpl: async (_url, init) => {
      body = init.body;
      return { ok: true };
    },
  });

  await notifier.notifySessionExpired({ platform: "tiktok", videoPath: "clip.mp4" });
  assert.match(body, /necesita re-login humano/);
});
