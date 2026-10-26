const fs = require("fs/promises");
const path = require("path");
const { config } = require("./config");

const NOTIFY_LEVELS = new Set(["success", "errors", "all"]);

function normalizeLevel(value) {
  const level = String(value || "errors").toLowerCase();
  return NOTIFY_LEVELS.has(level) ? level : "errors";
}

async function readableFile(filePath) {
  if (!filePath) {
    return false;
  }
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getTimestamp(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function getFileName(filePath) {
  return filePath ? path.basename(filePath) : "desconocido";
}

function getLocalClock(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

class Notifier {
  constructor(options = {}) {
    this.telegramBotToken = options.telegramBotToken ?? config.notifyTelegramBotToken ?? "";
    this.telegramChatId = options.telegramChatId ?? config.notifyTelegramChatId ?? "";
    this.discordWebhookUrl = options.discordWebhookUrl ?? config.notifyDiscordWebhookUrl ?? "";
    this.level = normalizeLevel(options.level ?? config.notifyLevel ?? "errors");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.maxAttempts = options.maxAttempts ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 250;
    this.logger = options.logger || null;
  }

  get hasTelegram() {
    return Boolean(this.telegramBotToken && this.telegramChatId);
  }
}