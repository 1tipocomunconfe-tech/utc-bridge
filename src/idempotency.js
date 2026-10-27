const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

// Importación segura con fallback inmediato
const config = require("./config") || {};

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
    // SOLUCIÓN ULTRA-SEGURA: Verificación exhaustiva de config y config.schedulerStateDir
    const safeConfig = config || {};
    const stateDir = (safeConfig && safeConfig.schedulerStateDir)
      ? safeConfig.schedulerStateDir
      : process.cwd();

    this.statePath = options.statePath || path.resolve(stateDir, "seen.json");
    this.lockPath = `${this.statePath}.lock`;

    // Fallback para staleLockMs
    this.staleLockMs = options.staleLockMs ?? (safeConfig && safeConfig.staleLockMs) ?? 1800000;
    this.notifier = options.notifier || defaultNotifier;
  }
}

module.exports = {
  SeenRegistry,
  dispatchUncertainNotification,
};