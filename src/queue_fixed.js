const fs = require('fs/promises');
const path = require('path');
const { config } = require('./config');
const { getMetadataPath, loadVideoMetadata } = require('./meta-loader');

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv"]);

// Función para obtener rutas absolutas correctas
function getAbsoluteQueuePath(platform) {
  const basePath = path.resolve(__dirname, '../../queue/default');
  switch (platform) {
    case 'tiktok':
      return path.resolve(basePath, 'tiktok/pending');
    case 'instagram':
      return path.resolve(basePath, 'instagram/pending');
    case 'youtube':
      return path.resolve(basePath, 'youtube/pending');
    default:
      return path.resolve(basePath, 'tiktok/pending');
  }
}

function getCaptionPaths(videoPath) {
  const parsed = path.parse(videoPath);
  return [
    path.join(parsed.dir, `${parsed.name}.description`),
    path.join(parsed.dir, `${parsed.name}.txt`),
  ];
}

async function readCaption(videoPath) {
  const captionPaths = getCaptionPaths(videoPath);
  for (const cp of captionPaths) {
    try {
      const text = await fs.readFile(cp, "utf8");
      return text.trim();
    } catch {
      // try next
    }
  }
  return "";
}

async function listQueueVideos(queueDir) {
  const dir = queueDir || getAbsoluteQueuePath('tiktok');
  const entries = await fs.readdir(dir, { withFileTypes: true });n  const videos = entries
    .filter((entry) => entry.isFile())
    .filter((entry) => VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(dir, entry.name));

  videos.sort((a, b) => a.localeCompare(b));
  return videos;
}

function pickNextVideo(videos) {
  if (videos.length === 0) {
    return null;
  }
  if (config.randomQueueOrder) {
    return videos[Math.floor(Math.random() * videos.length)];
  }
  return videos[0];
}

async function getNextQueuedItemForPlatform(queueDir, platform = "tiktok", nowValue = new Date()) {
  const videos = await listQueueVideos(queueDir);
  if (videos.length === 0) {
    return null;
  }

  const items = await Promise.all(
    videos.map(async (videoPath) => ({
      videoPath,
      metadata: await loadVideoMetadata(videoPath),
    }))
  );
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const scheduledItems = items.filter((item) => item.metadata.scheduledAt);
  const dueItems = scheduledItems.filter(
    (item) => new Date(item.metadata.scheduledAt).getTime() <= now.getTime()
  );
  const futureItems = scheduledItems.filter(
    (item) => new Date(item.metadata.scheduledAt).getTime() > now.getTime()
  );
  const unscheduledItems = items.filter((item) => !item.metadata.scheduledAt);
  let selected;
  let scheduledFuture = false;

  if (dueItems.length > 0) {
    dueItems.sort((a, b) => a.metadata.scheduledAt.localeCompare(b.metadata.scheduledAt));
    selected = config.randomQueueOrder ? dueItems[Math.floor(Math.random() * dueItems.length)] : dueItems[0];
  } else if (unscheduledItems.length > 0) {
    const unscheduledPaths = unscheduledItems.map((item) => item.videoPath);
    const selectedPath = pickNextVideo(unscheduledPaths);
    selected = unscheduledItems.find((item) => item.videoPath === selectedPath);
  } else {
    futureItems.sort((a, b) => a.metadata.scheduledAt.localeCompare(b.metadata.scheduledAt));
    selected = futureItems[0];
    scheduledFuture = true;
  }

  const videoPath = selected.videoPath;
  const metadata = selected.metadata;
  return {
    videoPath,
    caption: metadata.caption[platform],
    metadata,
    captionPaths: getCaptionPaths(videoPath),
    metadataPath: getMetadataPath(videoPath),
    scheduledFuture,
  };
}

async function getNextQueuedItem(queueDir, nowValue) {
  return getNextQueuedItemForPlatform(queueDir, 'tiktok', nowValue);
}

module.exports = {
  getNextQueuedItem,
  getNextQueuedItemForPlatform,
  getCaptionPaths,
  listQueueVideos,
  VIDEO_EXTENSIONS,
};
