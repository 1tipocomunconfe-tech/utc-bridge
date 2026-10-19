const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { config } = require("./config");
const {
  acquireExclusiveLock,
  moveLockToReview,
  releaseExclusiveLock,
} = require("./exclusive-lock");
const { notifier: defaultNotifier } = require("./notifier");

function dispatchUncertainNotification(notifier, payload) {
  if (!notifier || typeof notifier.notifyFailure !== "function") {
    return;
  }
  Promise.resolve()
    .then(() => notifier.notifyFailure(payload))
    .catch((error) => {
      console.error(`[${new Date().toISOString()}] Idempotency notification failed: ${error.message}`);
    });
}

class SeenRegistry {
  constructor(options = {}) {
    this.statePath = options.statePath || path.resolve(config.schedulerStateDir, "seen.json");
    this.lockPath = `${this.statePath}.lock`;
    this.staleLockMs = options.staleLockMs ?? config.staleLockMs;
    this.notifier = options.notifier || defaultNotifier;
  }

  async _read() {
    try {
      const value = JSON.parse(await fs.readFile(this.statePath, "utf8"));
      return value && typeof value === "object" ? value : { accounts: {} };
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) {
        return { accounts: {} };
      }
      throw error;
    }
  }

  async _write(value) {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.statePath);
  }

  async hashFile(videoPath) {
    const contents = await fs.readFile(videoPath);
    return crypto.createHash("sha256").update(contents).digest("hex");
  }

  async _markStaleLockUncertain(existing) {
    const data = await this._read();
    const { accountId, platform, hash } = existing || {};
    let entry = null;
    if (accountId && platform && hash) {
      data.accounts ||= {};
      data.accounts[accountId] ||= {};
      data.accounts[accountId][platform] ||= {};
      entry = {
        ...(data.accounts[accountId][platform][hash] || {}),
        status: "uncertain",
        videoPath: existing.videoPath,
        uncertaintyReason: "Recovered stale idempotency lock after interrupted publication.",
        uncertainAt: new Date().toISOString(),
        orphanedLock: existing,
      };
      data.accounts[accountId][platform][hash] = entry;
      await this._write(data);
    }

    const reviewPath = await moveLockToReview(this.lockPath, "uncertain");
    dispatchUncertainNotification(this.notifier, {
      platform: platform || "unknown",
      accountId: accountId || "unknown",
      videoPath: existing?.videoPath,
      error: entry?.uncertaintyReason || "Recovered stale idempotency lock; human review required.",
      screenshotPath: null,
      timestamp: new Date().toISOString(),
    });
    return { status: "uncertain", reviewPath, ...entry };
  }

  async _withStateLock(operation) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const lock = await acquireExclusiveLock(
        this.lockPath,
        { purpose: "seen-state" },
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
        await this._markStaleLockUncertain(lock.existing);
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Could not acquire idempotency state lock after 100 attempts.");
  }

  async claim(accountId, platform, hash, videoPath) {
    const lock = await acquireExclusiveLock(
      this.lockPath,
      { purpose: "seen", accountId, platform, hash, videoPath },
      { staleLockMs: this.staleLockMs }
    );
    if (!lock.acquired) {
      if (lock.stale) {
        const existing = await this._markStaleLockUncertain(lock.existing);
        return { claimed: false, existing };
      }
      return { claimed: false, existing: { status: "lock-held", ...lock.existing } };
    }

    try {
      const data = await this._read();
      data.accounts ||= {};
      data.accounts[accountId] ||= {};
      data.accounts[accountId][platform] ||= {};
      const existing = data.accounts[accountId][platform][hash];
      if (existing) {
        return { claimed: false, existing };
      }
      data.accounts[accountId][platform][hash] = {
        status: "in-progress",
        videoPath,
        pid: process.pid,
        host: os.hostname(),
        acquiredAt: new Date().toISOString(),
        timestamp: new Date().toISOString(),
      };
      await this._write(data);
      return { claimed: true };
    } finally {
      await releaseExclusiveLock(this.lockPath, lock.handle);
    }
  }

  async reconcileInProgress(options = {}) {
    const lock = await acquireExclusiveLock(
      this.lockPath,
      { purpose: "reconcile" },
      { staleLockMs: this.staleLockMs }
    );
    if (!lock.acquired) {
      if (lock.stale) {
        await this._markStaleLockUncertain(lock.existing);
      }
      return { reconciled: 0, skipped: true };
    }

    let reconciled = 0;
    const notifications = [];
    try {
      const data = await this._read();
      for (const [accountId, account] of Object.entries(data.accounts || {})) {
        for (const [platform, hashes] of Object.entries(account || {})) {
          for (const [hash, entry] of Object.entries(hashes || {})) {
            if (entry?.status !== "in-progress") continue;
            entry.status = "uncertain";
            entry.uncertaintyReason = "Interrupted publication requires human verification.";
            entry.uncertainAt = new Date().toISOString();
            reconciled += 1;
            notifications.push({ accountId, platform, hash, videoPath: entry.videoPath });
          }
        }
      }
      if (reconciled > 0) {
        await this._write(data);
      }
    } finally {
      await releaseExclusiveLock(this.lockPath, lock.handle);
    }

    const notifier = options.notifier || this.notifier;
    for (const item of notifications) {
      dispatchUncertainNotification(notifier, {
        ...item,
        error: "Interrupted publication marked uncertain; human review required.",
        screenshotPath: null,
        timestamp: new Date().toISOString(),
      });
    }
    return { reconciled, skipped: false };
  }

  async complete(accountId, platform, hash, status = "confirmed") {
    return this._withStateLock(async () => {
      const data = await this._read();
      const entry = data.accounts?.[accountId]?.[platform]?.[hash];
      if (!entry) return;
      entry.status = status;
      entry.completedAt = new Date().toISOString();
      await this._write(data);
    });
  }

  async release(accountId, platform, hash) {
    return this._withStateLock(async () => {
      const data = await this._read();
      if (!data.accounts?.[accountId]?.[platform]?.[hash]) return;
      delete data.accounts[accountId][platform][hash];
      await this._write(data);
    });
  }
}

module.exports = { SeenRegistry };
