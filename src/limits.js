const fs = require("fs/promises");
const path = require("path");
const { config } = require("./config");
const {
  acquireExclusiveLock,
  moveLockToReview,
  releaseExclusiveLock,
} = require("./exclusive-lock");

const PLATFORM_CONFIG_KEYS = {
  tiktok: "dailyCapTikTok",
  instagram: "dailyCapInstagram",
  youtube: "dailyCapYouTube",
};

function getCalendarDate(date, timezone = config.timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getDefaultCaps() {
  return Object.fromEntries(
    Object.entries(PLATFORM_CONFIG_KEYS).map(([platform, configKey]) => [
      platform,
      Number(config[configKey]),
    ])
  );
}

function assertPlatform(platform) {
  if (!Object.prototype.hasOwnProperty.call(PLATFORM_CONFIG_KEYS, platform)) {
    throw new Error(`Unknown platform for daily limit: ${platform}`);
  }
}

class LimitsStore {
  constructor(options = {}) {
    this.statePath = options.statePath || path.resolve(config.schedulerStateDir, "limits.json");
    this.lockPath = `${this.statePath}.lock`;
    this.staleLockMs = options.staleLockMs ?? config.staleLockMs;
    this.timezone = options.timezone || config.timezone;
    this.clock = options.clock || (() => new Date());
    this.caps = { ...getDefaultCaps(), ...(options.caps || {}) };
  }

  async _read() {
    try {
      const raw = await fs.readFile(this.statePath, "utf8");
      const data = JSON.parse(raw);
      return data && typeof data === "object" ? data : { accounts: {} };
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) {
        return { accounts: {} };
      }
      throw error;
    }
  }

  async _write(data) {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.statePath);
  }

  _getEntry(data, accountId, platform, date) {
    data.accounts ||= {};
    data.accounts[accountId] ||= {};
    const existing = data.accounts[accountId][platform];
    if (!existing || existing.date !== date) {
      data.accounts[accountId][platform] = { date, count: 0 };
    }
    return data.accounts[accountId][platform];
  }

  async _withStateLock(operation) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const lock = await acquireExclusiveLock(
        this.lockPath,
        { purpose: "limits" },
        { staleLockMs: this.staleLockMs }
      );
      if (lock.acquired) {
        try {
          return await operation();
        } finally {
          await releaseExclusiveLock(this.lockPath, lock.handle);
        }
      }
      if (lock.stale) {
        const reviewPath = await moveLockToReview(this.lockPath, "recovered");
        console.warn(
          `[${new Date().toISOString()}] [limits] Recovered stale lock${reviewPath ? ` to ${reviewPath}` : ""}.`
        );
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Could not acquire daily limits lock after 100 attempts.");
  }

  async getStatus(accountId, platform, at = this.clock()) {
    assertPlatform(platform);
    return this._withStateLock(async () => {
      const data = await this._read();
      const date = getCalendarDate(at, this.timezone);
      const entry = this._getEntry(data, accountId, platform, date);
      const cap = Number(this.caps[platform]);
      return { accountId, platform, date, count: entry.count, cap, remaining: Math.max(0, cap - entry.count) };
    });
  }

  async reserve(accountId, platform, at = this.clock()) {
    assertPlatform(platform);
    return this._withStateLock(async () => {
      const data = await this._read();
      const date = getCalendarDate(at, this.timezone);
      const entry = this._getEntry(data, accountId, platform, date);
      const cap = Number(this.caps[platform]);
      if (!Number.isInteger(cap) || cap < 0) {
        throw new Error(`Invalid daily cap for ${platform}: ${cap}`);
      }
      if (entry.count >= cap) {
        return { ok: false, date, count: entry.count, cap, remaining: 0 };
      }
      entry.count += 1;
      await this._write(data);
      return { ok: true, date, count: entry.count, cap, remaining: cap - entry.count };
    });
  }

  async release(accountId, platform, at = this.clock()) {
    assertPlatform(platform);
    return this._withStateLock(async () => {
      const data = await this._read();
      const date = getCalendarDate(at, this.timezone);
      const entry = this._getEntry(data, accountId, platform, date);
      if (entry.count > 0) {
        entry.count -= 1;
        await this._write(data);
      }
    });
  }
}

module.exports = {
  LimitsStore,
  getCalendarDate,
  getDefaultCaps,
};
