const fs = require("fs/promises");
const path = require("path");
const { getAllAccounts, getAccountQueueDirs, PLATFORMS } = require("./account-manager");
const { config } = require("./config");
const { ERROR_TYPES, writeErrorReport } = require("./errors");
const { SeenRegistry } = require("./idempotency");

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv"]);
const SIDEcar_SUFFIXES = [".description", ".txt", ".meta.json", ".error.json"];

function log(message, logger = console.log) {
  logger(`[${new Date().toISOString()}] [startup-reconcile] ${message}`);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function listVideos(directory) {
  if (!(await exists(directory))) return [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(directory, entry.name));
}

async function moveQueueItem(videoPath, targetDirectory) {
  await fs.mkdir(targetDirectory, { recursive: true });
  const fileName = path.basename(videoPath);
  const targetPath = path.join(targetDirectory, fileName);
  if (await exists(targetPath)) {
    throw new Error(`Startup reconciliation collision: ${targetPath}`);
  }
  await fs.rename(videoPath, targetPath);

  const stem = path.parse(fileName).name;
  for (const suffix of SIDEcar_SUFFIXES) {
    const sourceSidecar = path.join(path.dirname(videoPath), `${stem}${suffix}`);
    if (!(await exists(sourceSidecar))) continue;
    const targetSidecar = path.join(targetDirectory, `${stem}${suffix}`);
    if (await exists(targetSidecar)) continue;
    await fs.rename(sourceSidecar, targetSidecar);
  }
  return targetPath;
}

function getPlatformDirectories(accountId, platform, getQueueDirs) {
  const dirs = getQueueDirs(accountId)[platform];
  return {
    pending: dirs.pending,
    posted: dirs.posted,
    uncertain: path.resolve(dirs.posted, "../posted-uncertain"),
  };
}

async function reconcileDirectory({ accountId, platform, sourceState, sourceDirectory, targetState, targetDirectory, registry, logger, notifier }) {
  const movements = [];
  for (const videoPath of await listVideos(sourceDirectory)) {
    const hash = await registry.hashFile(videoPath);
    let entry = sourceState.accounts?.[accountId]?.[platform]?.[hash];

    if (!entry && targetState === "uncertain") {
      entry = await registry.markUncertain(
        accountId,
        platform,
        hash,
        videoPath,
        "Video found in posted-uncertain without a .seen record; human review required."
      );
    }

    const shouldMove = targetState === "uncertain"
      ? entry?.status === "confirmed"
      : entry?.status === targetState;
    if (!shouldMove) continue;

    const movedPath = await moveQueueItem(videoPath, targetDirectory);
    const message = `${accountId}/${platform} ${path.basename(videoPath)} ${sourceState}->${targetState}`;
    log(`Moved ${message}.`, logger);
    movements.push({ accountId, platform, hash, from: sourceState, to: targetState, movedPath });
    if (targetState === "uncertain") {
      await writeErrorReport(targetDirectory, {
        error: entry.uncertaintyReason || "Publication state requires human review.",
        errorType: ERROR_TYPES.DUDOSO,
      }, movedPath);
    }
  }
  return movements;
}

async function reconcileStartupState(options = {}) {
  const notifier = options.notifier;
  const registry = options.registry || new SeenRegistry({ notifier });
  const logger = options.logger || console.log;
  const getQueueDirs = options.getQueueDirs || getAccountQueueDirs;
  const accounts = options.accounts || await getAllAccounts();
  const inProgress = await registry.reconcileInProgress({ notifier });
  const sourceState = await registry.getSnapshot();
  const movements = [];

  for (const account of accounts) {
    const accountId = typeof account === "string" ? account : account.id;
    for (const platform of PLATFORMS) {
      const directories = getPlatformDirectories(accountId, platform, getQueueDirs);
      movements.push(...await reconcileDirectory({
        accountId,
        platform,
        sourceState,
        sourceDirectory: directories.pending,
        targetState: "uncertain",
        targetDirectory: directories.uncertain,
        registry,
        logger,
        notifier,
      }));
      movements.push(...await reconcileDirectory({
        accountId,
        platform,
        sourceState,
        sourceDirectory: directories.pending,
        targetState: "posted",
        targetDirectory: directories.posted,
        registry,
        logger,
        notifier,
      }));
      movements.push(...await reconcileDirectory({
        accountId,
        platform,
        sourceState,
        sourceDirectory: directories.uncertain,
        targetState: "posted",
        targetDirectory: directories.posted,
        registry,
        logger,
        notifier,
      }));
    }
  }

  log(`Completed: ${inProgress.reconciled} in-progress records, ${movements.length} file movements.`, logger);
  return { ...inProgress, movements };
}

module.exports = { reconcileStartupState, moveQueueItem };
