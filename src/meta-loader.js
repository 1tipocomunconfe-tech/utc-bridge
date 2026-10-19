const fs = require("fs/promises");
const path = require("path");

const DEFAULT_VISIBILITY = {
  tiktok: "public",
  youtube: "public",
};

const TIKTOK_VISIBILITY = new Set(["public", "friends", "private"]);
const YOUTUBE_VISIBILITY = new Set(["public", "unlisted", "private"]);

function getMetadataPath(videoPath) {
  const parsed = path.parse(videoPath);
  return path.join(parsed.dir, `${parsed.name}.meta.json`);
}

function getLegacyCaptionPaths(videoPath) {
  const parsed = path.parse(videoPath);
  return [
    path.join(parsed.dir, `${parsed.name}.description`),
    path.join(parsed.dir, `${parsed.name}.txt`),
  ];
}

async function readLegacyCaption(videoPath) {
  for (const captionPath of getLegacyCaptionPaths(videoPath)) {
    try {
      return (await fs.readFile(captionPath, "utf8")).trim();
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  return "";
}

function normalizeText(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new Error("Metadata text values must be strings.");
  }
  return value.trim();
}

function normalizeVisibility(value, platform, allowedValues) {
  const normalized = normalizeText(value, DEFAULT_VISIBILITY[platform]).toLowerCase();
  if (!allowedValues.has(normalized)) {
    throw new Error(`Invalid ${platform} visibility: ${normalized}`);
  }
  return normalized;
}

function normalizeScheduledAt(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error("scheduledAt must be a valid ISO date string.");
  }
  return value.trim();
}

function normalizeTags(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) {
    throw new Error("tags must be an array of strings.");
  }
  return value.map((tag) => tag.trim()).filter(Boolean);
}

function normalizeMetadata(rawMetadata, fallbackCaption = "") {
  if (!rawMetadata || typeof rawMetadata !== "object" || Array.isArray(rawMetadata)) {
    throw new Error("Metadata root must be a JSON object.");
  }

  const rawCaption = rawMetadata.caption;
  if (rawCaption !== undefined && (!rawCaption || typeof rawCaption !== "object" || Array.isArray(rawCaption))) {
    throw new Error("caption must be an object.");
  }

  const rawYoutubeCaption = rawCaption?.youtube;
  let youtubeTitle = fallbackCaption;
  let youtubeDescription = fallbackCaption;
  if (rawYoutubeCaption !== undefined) {
    if (typeof rawYoutubeCaption === "string") {
      youtubeTitle = rawYoutubeCaption;
      youtubeDescription = rawYoutubeCaption;
    } else if (rawYoutubeCaption && typeof rawYoutubeCaption === "object" && !Array.isArray(rawYoutubeCaption)) {
      youtubeTitle = normalizeText(rawYoutubeCaption.title, fallbackCaption);
      youtubeDescription = normalizeText(rawYoutubeCaption.description, fallbackCaption);
    } else {
      throw new Error("caption.youtube must be a string or object.");
    }
  }

  return {
    caption: {
      tiktok: normalizeText(rawCaption?.tiktok, fallbackCaption),
      instagram: normalizeText(rawCaption?.instagram, fallbackCaption),
      youtube: {
        title: youtubeTitle,
        description: youtubeDescription,
      },
    },
    visibility: {
      tiktok: normalizeVisibility(rawMetadata.visibility?.tiktok, "tiktok", TIKTOK_VISIBILITY),
      youtube: normalizeVisibility(rawMetadata.visibility?.youtube, "youtube", YOUTUBE_VISIBILITY),
    },
    scheduledAt: normalizeScheduledAt(rawMetadata.scheduledAt),
    tags: normalizeTags(rawMetadata.tags),
  };
}

async function loadVideoMetadata(videoPath, options = {}) {
  const fallbackCaption = await readLegacyCaption(videoPath);
  const metadataPath = getMetadataPath(videoPath);

  let rawMetadata;
  try {
    rawMetadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      rawMetadata = {};
    } else if (error instanceof SyntaxError) {
      const logger = options.logger || console.warn;
      logger(
        `[${new Date().toISOString()}] [meta-loader] WARNING Invalid metadata JSON in ${metadataPath}; using legacy caption fallback.`
      );
      rawMetadata = {};
    } else {
      throw error;
    }
  }

  return normalizeMetadata(rawMetadata, fallbackCaption);
}

module.exports = {
  getLegacyCaptionPaths,
  getMetadataPath,
  loadVideoMetadata,
  normalizeMetadata,
};
