const fs = require("fs/promises");
const path = require("path");
const { config } = require("./config");
const { getNextQueuedItem, getCaptionPaths } = require("./youtube-queue");
const { getMetadataPath } = require("./meta-loader");
const { uploadVideo } = require("./youtube-uploader");
const { ensureDirectories, fileExists, moveWithTimestamp } = require("./fs-utils");
const { postWithResult, reconcileSeenState } = require("./post-finalizer");

async function moveSidecarsIfExists(sidecarPaths, targetDir) {
  const moved = [];
  for (const cp of sidecarPaths) {
    if (await fileExists(cp)) {
      const result = await moveFileSafely(cp, targetDir, "sidecar file");
      if (result) moved.push(result);
    }
  }
  return moved.length > 0 ? moved[0] : null;
}

async function moveFileSafely(sourcePath, targetDir, label) {
  try {
    return await moveWithTimestamp(sourcePath, targetDir);
  } catch (error) {
    console.error(`Could not move ${label}: ${error.message}`);
    return null;
  }
}

async function postSingleVideo({ videoPath, caption, metadata, postedDir, failedDir, uncertainDir, accountId, uploadVideoFn = uploadVideo, seen, notifier }) {
  return postWithResult({
    platform: "youtube",
    videoPath,
    caption,
    metadata,
    postedDir: postedDir || config.youtubePostedDir,
    failedDir: failedDir || config.youtubeFailedDir,
    uncertainDir,
    accountId,
    uploadVideoFn,
    seen,
    notifier,
  });
}

async function postNextFromQueue({ source, queueDir, postedDir, failedDir, uncertainDir, accountId, notifier } = {}) {
  const queue = queueDir || config.youtubeQueueDir;
  const posted = postedDir || config.youtubePostedDir;
  const failed = failedDir || config.youtubeFailedDir;
  await ensureDirectories([queue, posted, failed]);
  await reconcileSeenState(notifier);

  const nextItem = await getNextQueuedItem(queue);
  if (!nextItem) {
    return { ok: true, skipped: true, reason: "YouTube queue is empty." };
  }

  return postSingleVideo({ ...nextItem, source, postedDir: posted, failedDir: failed, uncertainDir, accountId, notifier });
}

async function postFromManualInput(videoPath, caption) {
  const resolvedPath = path.resolve(videoPath);
  await fs.access(resolvedPath);
  return postSingleVideo({
    videoPath: resolvedPath,
    caption: caption || "",
  });
}

module.exports = {
  postSingleVideo,
  postNextFromQueue,
  postFromManualInput,
};
