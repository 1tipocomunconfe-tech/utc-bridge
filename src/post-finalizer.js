const path = require("path");
const { config } = require("./config");
const { getCaptionPaths } = require("./queue");
const { getMetadataPath } = require("./meta-loader");
const {
  classifyError,
  ERROR_TYPES,
  isSessionExpiredText,
  writeErrorReport,
} = require("./errors");
const { ensureDirectories, fileExists, moveWithTimestamp } = require("./fs-utils");
const { SeenRegistry } = require("./idempotency");
const { notifier: defaultNotifier } = require("./notifier");

const seenRegistry = new SeenRegistry();

async function reconcileSeenState(notifier) {
  return seenRegistry.reconcileInProgress({ notifier });
}

async function moveFileSafely(sourcePath, targetDir, label) {
  try {
    return await moveWithTimestamp(sourcePath, targetDir);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Could not move ${label}: ${error.message}`);
    return null;
  }
}

async function moveSidecarsIfExists(sidecarPaths, targetDir) {
  const moved = [];
  for (const sidecarPath of sidecarPaths) {
    if (await fileExists(sidecarPath)) {
      const result = await moveFileSafely(sidecarPath, targetDir, "sidecar file");
      if (result) moved.push(result);
    }
  }
  return moved.length > 0 ? moved[0] : null;
}

async function postWithResult({
  platform,
  videoPath,
  caption,
  metadata,
  source,
  postedDir,
  failedDir,
  uncertainDir,
  accountId,
  uploadVideoFn,
  seen = seenRegistry,
  notifier = defaultNotifier,
}) {
  const posted = postedDir || config.platformQueues[platform]?.replace(/pending$/, "posted");
  const failed = failedDir || config.platformQueues[platform]?.replace(/pending$/, "failed");
  const uncertain = uncertainDir || path.resolve(posted, "../posted-uncertain");
  await ensureDirectories([posted, failed, uncertain]);

  const resolvedAccountId = accountId || "default";
  if (typeof seen.reconcileInProgress === "function") {
    await seen.reconcileInProgress({ notifier });
  }
  const hash = await seen.hashFile(videoPath);
  const claim = await seen.claim(resolvedAccountId, platform, hash, videoPath);
  if (!claim.claimed) {
    return {
      ok: true,
      skipped: true,
      reason: `Video hash already seen for ${platform}: ${hash}.`,
      seen: claim.existing,
    };
  }

  let result;
  try {
    result = await uploadVideoFn({ videoPath, caption, metadata, source, accountId });
  } catch (error) {
    const normalized = classifyError(error, { platform });
    result = { ok: false, error: normalized.message, errorType: normalized.type };
  }

  const sidecarPaths = [...getCaptionPaths(videoPath), getMetadataPath(videoPath)];
  if (result.ok && result.status !== "uncertain") {
    const movedVideo = await moveFileSafely(videoPath, posted, "posted video");
    const movedSidecar = await moveSidecarsIfExists(sidecarPaths, posted);
    await seen.complete(resolvedAccountId, platform, hash, "confirmed");
    if (!movedVideo) {
      const archiveFailure = {
        error: "Video posted, but could not archive file from queue.",
        errorType: ERROR_TYPES.FATAL,
        screenshotPath: result.screenshotPath,
      };
      const errorReport = await writeErrorReport(failed, archiveFailure, videoPath);
      dispatchNotification(notifier, "notifyFailure", {
        platform,
        accountId: resolvedAccountId,
        videoPath,
        error: archiveFailure.error,
        screenshotPath: result.screenshotPath,
        timestamp: new Date().toISOString(),
      });
      return {
        ok: false,
        status: "failed",
        error: archiveFailure.error,
        errorType: archiveFailure.errorType,
        screenshotPath: result.screenshotPath,
        errorReport,
      };
    }
    dispatchNotification(notifier, "notifySuccess", {
      platform,
      accountId: resolvedAccountId,
      videoPath,
      publishedAt: new Date().toISOString(),
    });
    return { ok: true, status: "confirmed", movedVideo, movedCaption: movedSidecar };
  }

  const isUncertain = result.status === "uncertain" || result.errorType === ERROR_TYPES.DUDOSO;
  const targetDir = isUncertain ? uncertain : failed;
  const movedVideo = await moveFileSafely(
    videoPath,
    targetDir,
    isUncertain ? "uncertain video" : "failed video"
  );
  const movedSidecar = await moveSidecarsIfExists(sidecarPaths, targetDir);
  if (isUncertain) {
    await seen.complete(resolvedAccountId, platform, hash, "uncertain");
  } else {
    await seen.release(resolvedAccountId, platform, hash);
  }
  const errorReport = await writeErrorReport(targetDir, result, movedVideo || videoPath);
  const notificationMethod = isSessionExpiredText(result.error)
    ? "notifySessionExpired"
    : "notifyFailure";
  dispatchNotification(notifier, notificationMethod, {
    platform,
    accountId: resolvedAccountId,
    videoPath,
    error: result.error,
    screenshotPath: result.screenshotPath,
    timestamp: new Date().toISOString(),
  });
  return {
    ok: false,
    status: isUncertain ? "uncertain" : "failed",
    movedVideo,
    movedCaption: movedSidecar,
    error: result.error,
    errorType: result.errorType,
    screenshotPath: result.screenshotPath,
    errorReport,
  };
}

function dispatchNotification(notifier, method, payload) {
  if (!notifier || typeof notifier[method] !== "function") {
    return;
  }
  Promise.resolve()
    .then(() => notifier[method](payload))
    .catch((error) => {
      console.error(`[${new Date().toISOString()}] Notification failed: ${error.message}`);
    });
}

module.exports = {
  reconcileSeenState,
  postWithResult,
};
