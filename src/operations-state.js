const fs = require("fs/promises");
const path = require("path");
const { config } = require("./config");
const {
  getAllAccounts,
  getAccountQueueDirs,
  getPlatformProfileDir,
  hasSavedPlatformSession,
  PLATFORMS,
} = require("./account-manager");
const { getDaemons } = require("./daemon-registry");
const { loadVideoMetadata } = require("./meta-loader");
const { LimitsStore } = require("./limits");
const { isSessionExpiredText } = require("./errors");

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv"]);
const SIDECAR_SUFFIXES = [".description", ".txt", ".meta.json"];

async function readDirectory(directory) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function isVideoName(fileName) {
  return VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

async function listVideos(directory) {
  const entries = await readDirectory(directory);
  return entries
    .filter((entry) => entry.isFile() && isVideoName(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function getNewestVideo(directory) {
  const names = await listVideos(directory);
  const candidates = await Promise.all(
    names.map(async (name) => {
      const filePath = path.join(directory, name);
      const stat = await fs.stat(filePath);
      return { fileName: name, at: stat.mtime.toISOString() };
    })
  );
  return candidates.sort((a, b) => b.at.localeCompare(a.at))[0] || null;
}

async function readRecentErrors(directory, limit = 5) {
  const entries = await readDirectory(directory);
  const reports = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".error.json")) {
      continue;
    }
    try {
      const report = JSON.parse(await fs.readFile(path.join(directory, entry.name), "utf8"));
      reports.push({
        fileName: entry.name.replace(/\.error\.json$/, ""),
        motivo: report.motivo || "Error no especificado.",
        tipo: report.tipo || "FATAL",
        screenshot: report.screenshot || null,
        timestamp: report.timestamp || null,
      });
    } catch {
      reports.push({
        fileName: entry.name,
        motivo: "Informe de error ilegible.",
        tipo: "FATAL",
        screenshot: null,
        timestamp: null,
      });
    }
  }
  reports.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  return reports.slice(0, limit);
}

async function getScheduledItems(directory, now = new Date()) {
  const names = await listVideos(directory);
  const items = [];
  for (const fileName of names) {
    const videoPath = path.join(directory, fileName);
    const metadata = await loadVideoMetadata(videoPath);
    if (!metadata.scheduledAt) {
      continue;
    }
    const scheduledDate = new Date(metadata.scheduledAt);
    if (!Number.isNaN(scheduledDate.getTime()) && scheduledDate.getTime() >= now.getTime()) {
      items.push({ fileName, scheduledAt: scheduledDate.toISOString() });
    }
  }
  return items.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

function getLastPublication(daemonStatus, newestPosted) {
  const result = daemonStatus?.lastResult;
  if (result?.ok && !result.skipped) {
    return {
      at: daemonStatus.lastRunAt || null,
      fileName: result.movedVideo ? path.basename(result.movedVideo) : null,
      status: result.status || "confirmed",
    };
  }
  return newestPosted
    ? { at: newestPosted.at, fileName: newestPosted.fileName, status: "archived" }
    : null;
}

async function collectQueuePlatformState({ account, platform, dirs, daemonStatus, limits, now }) {
  const [pending, posted, failed, scheduled, newestPosted, recentErrors] = await Promise.all([
    listVideos(dirs.pending),
    listVideos(dirs.posted),
    listVideos(dirs.failed),
    getScheduledItems(dirs.pending, now),
    getNewestVideo(dirs.posted),
    readRecentErrors(dirs.failed),
  ]);
  const quota = await limits.getStatus(account.id, platform, now);
  const schedulerError = daemonStatus?.lastResult?.error;
  const errors = schedulerError && !recentErrors.some((item) => item.motivo === schedulerError)
    ? [{ fileName: null, motivo: schedulerError, tipo: "FATAL", screenshot: daemonStatus.lastResult.screenshotPath || null, timestamp: daemonStatus.lastRunAt }].concat(recentErrors)
    : recentErrors;

  return {
    counts: { pending: pending.length, posted: posted.length, failed: failed.length },
    pendingFiles: pending,
    nextScheduled: scheduled.slice(0, 10),
    nextScheduledAt: scheduled[0]?.scheduledAt || null,
    quota,
    lastPublication: getLastPublication(daemonStatus, newestPosted),
    recentErrors: errors.slice(0, 5),
    scheduler: {
      running: Boolean(daemonStatus?.running),
      isPosting: Boolean(daemonStatus?.isPosting),
      lastRunAt: daemonStatus?.lastRunAt || null,
      schedulePlan: daemonStatus?.schedulePlan || null,
    },
  };
}

async function collectOperationsStatus(options = {}) {
  const accounts = options.accounts || await (options.getAccounts || getAllAccounts)();
  const getQueueDirs = options.getQueueDirs || getAccountQueueDirs;
  const getDaemonsImpl = options.getDaemons || getDaemons;
  const limits = options.limits || new LimitsStore({
    statePath: options.limitsStatePath,
    timezone: options.timezone || config.timezone,
  });
  const now = options.now || new Date();
  const result = {
    generatedAt: now.toISOString(),
    timezone: options.timezone || config.timezone,
    accounts: {},
  };

  for (const account of accounts) {
    const dirs = getQueueDirs(account.id);
    const daemons = await getDaemonsImpl(account.id);
    result.accounts[account.id] = { id: account.id, name: account.name, platforms: {} };
    for (const platform of PLATFORMS) {
      const daemonStatus = await daemons[platform].getStatus();
      result.accounts[account.id].platforms[platform] = await collectQueuePlatformState({
        account,
        platform,
        dirs: dirs[platform],
        daemonStatus,
        limits,
        now,
      });
    }
  }
  return result;
}

function lastStatusIndicatesExpired(status) {
  if (isSessionExpiredText(status?.lastResult?.error)) {
    return true;
  }
  return (status?.logs || []).some((entry) => entry.level === "error" && isSessionExpiredText(entry.message));
}

async function collectSessionsHealth(options = {}) {
  const accounts = options.accounts || await (options.getAccounts || getAllAccounts)();
  const getProfileDir = options.getProfileDir || getPlatformProfileDir;
  const hasSession = options.hasSession || hasSavedPlatformSession;
  const getDaemonsImpl = options.getDaemons || getDaemons;
  const result = {
    generatedAt: (options.now || new Date()).toISOString(),
    timezone: options.timezone || config.timezone,
    accounts: {},
  };

  for (const account of accounts) {
    const daemons = await getDaemonsImpl(account.id);
    result.accounts[account.id] = { id: account.id, name: account.name, platforms: {} };
    for (const platform of PLATFORMS) {
      const profileDir = await getProfileDir(platform, account.id);
      let profileExists = false;
      let lastProfileUse = null;
      try {
        const stat = await fs.stat(profileDir);
        profileExists = stat.isDirectory();
        lastProfileUse = stat.mtime.toISOString();
      } catch {
        // A missing profile is reported as unhealthy, not as a server error.
      }
      const daemonStatus = await daemons[platform].getStatus();
      const cookiesPresent = await hasSession(platform, account.id);
      const suspiciousExpiration = lastStatusIndicatesExpired(daemonStatus);
      result.accounts[account.id].platforms[platform] = {
        profileDir,
        profileExists,
        cookiesPresent,
        cookiesLikelyValid: profileExists && cookiesPresent && !suspiciousExpiration,
        lastProfileUse,
        lastPost: daemonStatus.lastResult || null,
        suspiciousExpiration,
      };
    }
  }
  return result;
}

async function requeueFailedVideo({ accountId, platform, fileName, getQueueDirs = getAccountQueueDirs } = {}) {
  if (!accountId || !PLATFORMS.includes(platform) || !fileName || path.basename(fileName) !== fileName) {
    throw new Error("accountId, platform and a safe fileName are required.");
  }
  if (!isVideoName(fileName)) {
    throw new Error("Only supported video files can be requeued.");
  }
  const dirs = getQueueDirs(accountId)[platform];
  const sourcePath = path.join(dirs.failed, fileName);
  const targetPath = path.join(dirs.pending, fileName);
  await fs.mkdir(dirs.pending, { recursive: true });
  try {
    await fs.access(targetPath);
    throw new Error(`A pending file already exists: ${fileName}`);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  await fs.rename(sourcePath, targetPath);

  const baseName = path.basename(fileName, path.extname(fileName));
  for (const suffix of SIDECAR_SUFFIXES) {
    const sourceSidecar = path.join(dirs.failed, `${baseName}${suffix}`);
    const targetSidecar = path.join(dirs.pending, `${baseName}${suffix}`);
    try {
      await fs.rename(sourceSidecar, targetSidecar);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  return { ok: true, accountId, platform, fileName, path: targetPath };
}

module.exports = {
  VIDEO_EXTENSIONS,
  collectOperationsStatus,
  collectSessionsHealth,
  isVideoName,
  readRecentErrors,
  requeueFailedVideo,
};
