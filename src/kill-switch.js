const fs = require("fs");
const path = require("path");
// Importación segura con fallback inmediato
const config = require("./config") || {};

// Solución ultra-segura contra undefined
const projectRootPath = (config && config.projectRoot) ? config.projectRoot : process.cwd();
let killSwitchSourcePath = path.resolve(projectRootPath, ".env");
let cachedSourceKey = null;
let cachedSourceValue;

function parseKillSwitchValue(contents) {
  const match = String(contents).match(/^\s*KILL_SWITCH\s*=\s*([^#\r\n]+)\s*$/m);
  if (!match) return undefined;
  return match[1].trim().replace(/^['"]|['"]$/g, "");
}

function readDynamicKillSwitch() {
  try {
    const stat = fs.statSync(killSwitchSourcePath);
    const sourceKey = `${stat.mtimeMs}:${stat.size}`;
    if (sourceKey !== cachedSourceKey) {
      cachedSourceKey = sourceKey;
      cachedSourceValue = parseKillSwitchValue(fs.readFileSync(killSwitchSourcePath, "utf8"));
    }
    // Fallback seguro para config.killSwitch
    return cachedSourceValue === undefined ? (config && config.killSwitch) : cachedSourceValue;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return process.env.KILL_SWITCH === undefined ? (config && config.killSwitch) : process.env.KILL_SWITCH;
  }
}

function isKillSwitchEnabled(value) {
  const rawValue = value === undefined ? readDynamicKillSwitch() : value;
  return String(rawValue || "").toLowerCase() === "true";
}

function getKillSwitchReason() {
  return "KILL_SWITCH=true: scheduler and orchestrator are paused.";
}

function stopControllerIfKilled(controller, logger = console.log, value) {
  if (!isKillSwitchEnabled(value)) {
    return false;
  }
  controller?.stop?.();
  logger(`[${new Date().toISOString()}] ${getKillSwitchReason()}`);
  return true;
}

function setKillSwitchSourceForTest(sourcePath) {
  killSwitchSourcePath = sourcePath;
  cachedSourceKey = null;
  cachedSourceValue = undefined;
}

module.exports = {
  getKillSwitchReason,
  isKillSwitchEnabled,
  setKillSwitchSourceForTest,
  stopControllerIfKilled,
};