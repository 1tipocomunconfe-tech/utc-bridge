const crypto = require("crypto");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { config } = require("./config");
const { getKillSwitchReason, isKillSwitchEnabled } = require("./kill-switch");
const { getActiveAccount, getAccountQueueDirs } = require("./account-manager");
const { getMetadataPath, loadVideoMetadata } = require("./meta-loader");

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv"]);
const PLATFORM_OFFSETS = {
  tiktok: "staggerTikTokMin",
  instagram: "staggerInstagramMin",
  youtube: "staggerYouTubeMin",
};

function nowIso() {
  return new Date().toISOString();
}

function log(message, logger = console.log) {
  logger(`[${nowIso()}] [orchestrator] ${message}`);
}

function getProcessedDir(inboxDir) {
  return path.join(inboxDir, "processed");
}

function getVideoFiles(entries) {
  return entries
    .filter((entry) => entry.isFile())
    .filter((entry) => VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function normalizeStem(fileName) {
  const stem = path.parse(fileName).name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 64);
  return stem || "video";
}

function formatTimestamp(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}_${values.hour}${values.minute}`;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function getQueueDirs(accountId, options = {}) {
  if (options.queueDirs) {
    return options.queueDirs;
  }
  if (accountId === "default") {
    return config.platformQueues;
  }
  return getAccountQueueDirs(accountId);
}

function getStaggerMinutes(platform, options = {}) {
  const configKey = PLATFORM_OFFSETS[platform];
  const value = options[`${platform}StaggerMin`] ?? config[configKey];
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(`Invalid stagger offset for ${platform}: ${value}`);
  }
  return minutes;
}

async function getContentHash(videoPath) {
  const content = await fs.readFile(videoPath);
  return crypto.createHash("sha1").update(content).digest("hex").slice(0, 6);
}

async function getFileDigest(filePath) {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function makeDestinationName(fileName, timestamp, hash) {
  return `${formatTimestamp(timestamp)}_${hash}_${normalizeStem(fileName)}${path.extname(fileName).toLowerCase()}`;
}

function makePlatformMetadata(metadata, platform, scheduledAt) {
  const platformMetadata = {
    caption: {},
    scheduledAt: scheduledAt.toISOString(),
    tags: metadata.tags,
  };

  if (platform === "youtube") {
    platformMetadata.caption.youtube = metadata.caption.youtube;
    platformMetadata.visibility = { youtube: metadata.visibility.youtube };
  } else {
    platformMetadata.caption[platform] = metadata.caption[platform];
    if (platform === "tiktok") {
      platformMetadata.visibility = { tiktok: metadata.visibility.tiktok };
    }
  }

  return platformMetadata;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function copyIfMissing(sourcePath, destinationPath) {
  const sourceStat = await fs.stat(sourcePath);
  const sourceDigest = await getFileDigest(sourcePath);
  if (await pathExists(destinationPath)) {
    const destinationStat = await fs.stat(destinationPath);
    if (destinationStat.size === sourceStat.size && (await getFileDigest(destinationPath)) === sourceDigest) {
      return false;
    }
    await fs.unlink(destinationPath);
  }

  const tempPath = `${destinationPath}.${process.pid}.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await fs.copyFile(sourcePath, tempPath);
    const tempStat = await fs.stat(tempPath);
    const tempDigest = await getFileDigest(tempPath);
    if (tempStat.size !== sourceStat.size || tempDigest !== sourceDigest) {
      throw new Error(`Atomic copy verification failed for ${destinationPath}.`);
    }
    await fs.rename(tempPath, destinationPath);
  } finally {
    await fs.unlink(tempPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return true;
}

async function writeJsonIfMissing(destinationPath, value) {
  if (await pathExists(destinationPath)) {
    return false;
  }
  const tempPath = `${destinationPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, destinationPath);
  } finally {
    await fs.unlink(tempPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return true;
}

async function moveIfMissing(sourcePath, destinationPath) {
  if (!(await pathExists(sourcePath))) {
    return null;
  }
  if (await pathExists(destinationPath)) {
    await fs.unlink(sourcePath);
    return destinationPath;
  }
  await fs.rename(sourcePath, destinationPath);
  return destinationPath;
}

async function processVideo(videoPath, options) {
  const fileName = path.basename(videoPath);
  const inboxDir = path.dirname(videoPath);
  const processedDir = options.processedDir || getProcessedDir(inboxDir);
  const metadata = await loadVideoMetadata(videoPath);
  const baseDate = metadata.scheduledAt ? new Date(metadata.scheduledAt) : options.now;
  const hash = await getContentHash(videoPath);
  const destinationName = makeDestinationName(fileName, baseDate, hash);
  const sidecarSourcePath = getMetadataPath(videoPath);
  const plans = [];

  for (const platform of Object.keys(PLATFORM_OFFSETS)) {
    const staggerMinutes = getStaggerMinutes(platform, options);
    const targetDir = options.queueDirs[platform];
    const targetVideoPath = path.join(targetDir, destinationName);
    const targetMetadataPath = path.join(targetDir, `${path.parse(destinationName).name}.meta.json`);
    const scheduledAt = addMinutes(baseDate, staggerMinutes);
    const platformMetadata = makePlatformMetadata(metadata, platform, scheduledAt);
    plans.push({
      platform,
      staggerMinutes,
      targetDir,
      targetVideoPath,
      targetMetadataPath,
      platformMetadata,
    });
  }

  for (const plan of plans) {
    log(
      `${options.dryRun ? "Would copy" : "Copying"} ${fileName} -> ${plan.platform} ` +
      `${plan.targetVideoPath} (scheduledAt ${plan.platformMetadata.scheduledAt})`,
      options.logger
    );
  }

  if (options.dryRun) {
    return { fileName, destinationName, dryRun: true, plans };
  }

  const failures = [];
  for (const plan of plans) {
    try {
      await fs.mkdir(plan.targetDir, { recursive: true });
      await copyIfMissing(videoPath, plan.targetVideoPath);
      await writeJsonIfMissing(plan.targetMetadataPath, plan.platformMetadata);
    } catch (error) {
      failures.push({ platform: plan.platform, error });
      log(`Platform ${plan.platform} failed; it will be retried on the next tick: ${error.message}`, options.logger);
    }
  }

  if (failures.length > 0) {
    const retryError = new Error(
      `Could not replicate ${fileName} to: ${failures.map((failure) => failure.platform).join(", ")}.`
    );
    retryError.failures = failures;
    throw retryError;
  }

  await fs.mkdir(processedDir, { recursive: true });
  const processedVideoPath = path.join(processedDir, destinationName);
  await moveIfMissing(videoPath, processedVideoPath);
  if (await pathExists(sidecarSourcePath)) {
    await moveIfMissing(sidecarSourcePath, path.join(processedDir, `${path.parse(destinationName).name}.meta.json`));
  }
  for (const legacyExtension of [".description", ".txt"]) {
    const legacyPath = path.join(inboxDir, `${path.parse(fileName).name}${legacyExtension}`);
    if (await pathExists(legacyPath)) {
      await moveIfMissing(legacyPath, path.join(processedDir, `${path.parse(destinationName).name}${legacyExtension}`));
    }
  }

  log(`Processed ${fileName} as ${destinationName}.`, options.logger);
  return { fileName, destinationName, dryRun: false, plans, processedVideoPath };
}

async function processInboxOnce(options = {}) {
  const inboxDir = options.inboxDir || config.orchestratorInboxDir;
  const enabled = options.enabled ?? config.orchestratorEnabled;
  const dryRun = options.dryRun ?? config.orchestratorDryRun;
  if (isKillSwitchEnabled(options.killSwitch)) {
    log(getKillSwitchReason(), options.logger);
    return { ok: true, paused: true, reason: getKillSwitchReason(), processed: [], failed: [] };
  }
  if (!enabled) {
    log("Disabled by ORCHESTRATOR_ENABLED=false.", options.logger);
    return { ok: true, disabled: true, processed: [], failed: [] };
  }

  const activeAccount = options.accountId
    ? { id: options.accountId }
    : await getActiveAccount();
  const queueDirs = getQueueDirs(activeAccount.id, options);
  const now = options.now || new Date();
  await fs.mkdir(inboxDir, { recursive: true });
  const entries = await fs.readdir(inboxDir, { withFileTypes: true });
  const videoFiles = getVideoFiles(entries);
  const results = { ok: true, processed: [], failed: [] };

  for (const fileName of videoFiles) {
    try {
      const result = await processVideo(path.join(inboxDir, fileName), {
        ...options,
        dryRun,
        now,
        queueDirs,
        processedDir: options.processedDir || getProcessedDir(inboxDir),
      });
      results.processed.push(result);
    } catch (error) {
      const failure = { fileName, error: error.message };
      results.failed.push(failure);
      log(`Failed to process ${fileName}: ${error.message}`, options.logger);
    }
  }

  results.ok = results.failed.length === 0;
  return results;
}

function watchInbox(options = {}) {
  const inboxDir = options.inboxDir || config.orchestratorInboxDir;
  let timer = null;
  let running = false;
  let queued = false;

  const run = async () => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      await processInboxOnce(options);
    } finally {
      running = false;
      if (queued) {
        queued = false;
        run();
      }
    }
  };

  const watcher = fsSync.watch(inboxDir, () => {
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  });
  run();
  return watcher;
}

async function runCli(args = process.argv.slice(2)) {
  const once = args.includes("--once");
  if (once) {
    const result = await processInboxOnce();
    if (!result.ok) {
      process.exitCode = 1;
    }
    return result;
  }

  await fs.mkdir(config.orchestratorInboxDir, { recursive: true });
  log(`Watching ${config.orchestratorInboxDir}.`);
  return watchInbox();
}

if (require.main === module) {
  runCli().catch((error) => {
    log(`Fatal error: ${error.message}`, console.error);
    process.exitCode = 1;
  });
}

module.exports = {
  VIDEO_EXTENSIONS,
  formatTimestamp,
  getProcessedDir,
  getQueueDirs,
  copyIfMissing,
  makeDestinationName,
  makePlatformMetadata,
  processInboxOnce,
  processVideo,
  runCli,
  watchInbox,
};
