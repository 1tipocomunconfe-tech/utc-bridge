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
    this.telegramBotToken = options.telegramBotToken ?? config.notifyTelegramBotToken;
    this.telegramChatId = options.telegramChatId ?? config.notifyTelegramChatId;
    this.discordWebhookUrl = options.discordWebhookUrl ?? config.notifyDiscordWebhookUrl;
    this.level = normalizeLevel(options.level ?? config.notifyLevel);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.maxAttempts = options.maxAttempts ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 250;
    this.logger = options.logger || null;
  }

  get hasTelegram() {
    return Boolean(this.telegramBotToken && this.telegramChatId);
  }

  get hasDiscord() {
    return Boolean(this.discordWebhookUrl);
  }

  shouldNotify(kind) {
    return this.level === "all" || this.level === kind;
  }

  async notifySuccess({ platform, accountId = "default", videoPath, publishedAt } = {}) {
    if (!this.shouldNotify("success")) {
      return { sent: false, skipped: true };
    }
    const timestamp = getTimestamp(publishedAt);
    const text = [
      "\u2705 AutoSocial+ publicado",
      `Plataforma: ${platform || "desconocida"}`,
      `Cuenta: ${accountId}`,
      `Archivo: ${getFileName(videoPath)}`,
      `Hora: ${timestamp}`,
    ].join("\n");
    return this._broadcast(text);
  }

  async notifyFailure({ platform, accountId = "default", videoPath, error, screenshotPath, timestamp } = {}) {
    if (!this.shouldNotify("errors")) {
      return { sent: false, skipped: true };
    }
    const text = [
      "\u274c AutoSocial+ fallo de publicaci\u00f3n",
      `Plataforma: ${platform || "desconocida"}`,
      `Cuenta: ${accountId}`,
      `Archivo: ${getFileName(videoPath)}`,
      `Motivo: ${error || "Error no especificado."}`,
      `Hora: ${getTimestamp(timestamp)}`,
    ].join("\n");
    return this._broadcast(text, screenshotPath);
  }

  async notifySessionExpired({ platform, accountId = "default", videoPath, screenshotPath, timestamp } = {}) {
    if (!this.shouldNotify("errors")) {
      return { sent: false, skipped: true };
    }
    const text = [
      "\ud83d\udea8 CR\u00cdTICO: sesi\u00f3n expirada",
      `Plataforma: ${platform || "desconocida"}`,
      `Cuenta: ${accountId}`,
      `Archivo: ${getFileName(videoPath)}`,
      "Acci\u00f3n: necesita re-login humano.",
      `Hora: ${getTimestamp(timestamp)}`,
    ].join("\n");
    return this._broadcast(text, screenshotPath);
  }

  async notifyDailySummary({ accountId = "default", published = 0, failed = 0, pending = 0, timestamp } = {}) {
    if (!this.shouldNotify("success")) {
      return { sent: false, skipped: true };
    }
    const text = [
      "\ud83d\udcca AutoSocial+ resumen diario",
      `Cuenta: ${accountId}`,
      `Publicados: ${published}`,
      `Fallidos: ${failed}`,
      `Pendientes: ${pending}`,
      `Hora: ${getTimestamp(timestamp)}`,
    ].join("\n");
    return this._broadcast(text);
  }

  scheduleDailySummary({ getSummary, accountId = "default", timezone = config.timezone, intervalMs = 30000, now = () => new Date() } = {}) {
    if (!config.notifyDailySummary || typeof getSummary !== "function") {
      return () => { };
    }

    let lastNotificationKey = "";
    let stopped = false;
    const tick = async () => {
      if (stopped) {
        return;
      }
      const clock = getLocalClock(now(), timezone);
      const key = `${clock.year}-${clock.month}-${clock.day}`;
      if (clock.hour !== "21" || clock.minute !== "00" || key === lastNotificationKey) {
        return;
      }
      lastNotificationKey = key;
      const summary = await getSummary();
      await this.notifyDailySummary({ ...summary, accountId, timestamp: now() });
    };

    const timer = setInterval(() => {
      tick().catch((error) => this._log(`Daily summary failed: ${error.message}`));
    }, intervalMs);
    timer.unref?.();
    tick().catch((error) => this._log(`Daily summary failed: ${error.message}`));
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  async _broadcast(text, screenshotPath) {
    const operations = [];
    if (this.hasTelegram) {
      operations.push(this._sendTelegram(text, screenshotPath));
    }
    if (this.hasDiscord) {
      operations.push(this._sendDiscord(text, screenshotPath));
    }
    if (operations.length === 0) {
      return { sent: false, skipped: true };
    }

    const results = await Promise.allSettled(operations);
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length === results.length) {
      throw failures[0].reason;
    }
    return { sent: true, adapters: results.length - failures.length };
  }

  async _sendTelegram(text, screenshotPath) {
    const baseUrl = `https://api.telegram.org/bot${this.telegramBotToken}`;
    if (await readableFile(screenshotPath)) {
      return this._requestWithRetries(
        () => this._telegramPhotoRequest(`${baseUrl}/sendPhoto`, text, screenshotPath),
        "Telegram sendPhoto"
      );
    }
    return this._requestWithRetries(
      () => ({
        url: `${baseUrl}/sendMessage`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: this.telegramChatId, text }),
        },
      }),
      "Telegram sendMessage"
    );
  }

  async _telegramPhotoRequest(url, text, screenshotPath) {
    const form = new FormData();
    form.append("chat_id", this.telegramChatId);
    form.append("caption", text.slice(0, 1024));
    form.append("photo", new Blob([await fs.readFile(screenshotPath)]), path.basename(screenshotPath));
    return { url, init: { method: "POST", body: form } };
  }

  async _sendDiscord(text, screenshotPath) {
    if (await readableFile(screenshotPath)) {
      return this._requestWithRetries(
        () => this._discordFileRequest(text, screenshotPath),
        "Discord webhook screenshot"
      );
    }
    return this._requestWithRetries(
      () => ({
        url: this.discordWebhookUrl,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: text }),
        },
      }),
      "Discord webhook"
    );
  }

  async _discordFileRequest(text, screenshotPath) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ content: text }));
    form.append("files[0]", new Blob([await fs.readFile(screenshotPath)]), path.basename(screenshotPath));
    return { url: this.discordWebhookUrl, init: { method: "POST", body: form } };
  }

  async _requestWithRetries(requestFactory, label) {
    let lastError;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const request = await requestFactory();
        if (typeof this.fetchImpl !== "function") {
          throw new Error("fetch is not available in this Node.js runtime.");
        }
        const response = await this.fetchImpl(request.url, request.init);
        if (response && response.ok === false) {
          throw new Error(`${label} returned HTTP ${response.status || "error"}.`);
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt < this.maxAttempts) {
          await this.sleep(this.retryDelayMs * attempt);
        }
      }
    }
    this._log(`${label} failed after ${this.maxAttempts} attempts: ${lastError.message}`);
    throw lastError;
  }

  _log(message) {
    this.logger?.(`[${new Date().toISOString()}] ${message}`);
  }
}

const notifier = new Notifier();

module.exports = {
  NOTIFY_LEVELS,
  Notifier,
  normalizeLevel,
  notifier,
};
