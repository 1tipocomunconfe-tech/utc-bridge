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
    // Fallback seguro: si config.schedulerStateDir no existe, usar process.cwd()
    const stateDir = config.schedulerStateDir || process.cwd();
    this.statePath = options.statePath || path.resolve(stateDir, "seen.json");
    this.lockPath = `${this.statePath}.lock`;
    this.staleLockMs = options.staleLockMs ?? config.staleLockMs ?? 1800000;
    this.notifier = options.notifier || defaultNotifier;
  }
}