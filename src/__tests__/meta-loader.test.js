const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { loadVideoMetadata } = require("../meta-loader");

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "autosocial-meta-"));
}

test("parses complete metadata and normalizes optional fields", async () => {
  const dir = await makeTempDir();
  const videoPath = path.join(dir, "clip.mp4");
  await fs.writeFile(videoPath, "fixture");
  await fs.writeFile(
    path.join(dir, "clip.meta.json"),
    JSON.stringify({
      caption: {
        tiktok: " TikTok caption ",
        instagram: " Instagram caption ",
        youtube: { title: " YouTube title ", description: " YouTube description " },
      },
      visibility: { tiktok: "public", youtube: "unlisted" },
      scheduledAt: "2026-10-21T09:30:00-04:00",
      tags: ["#fyp", " #shorts "],
    })
  );

  assert.deepEqual(await loadVideoMetadata(videoPath), {
    caption: {
      tiktok: "TikTok caption",
      instagram: "Instagram caption",
      youtube: { title: "YouTube title", description: "YouTube description" },
    },
    visibility: { tiktok: "public", youtube: "unlisted" },
    scheduledAt: "2026-10-21T09:30:00-04:00",
    tags: ["#fyp", "#shorts"],
  });
});

test("applies defaults for minimal metadata", async () => {
  const dir = await makeTempDir();
  const videoPath = path.join(dir, "clip.mp4");
  await fs.writeFile(videoPath, "fixture");
  await fs.writeFile(path.join(dir, "clip.meta.json"), JSON.stringify({ caption: { tiktok: "Only TikTok" } }));

  assert.deepEqual(await loadVideoMetadata(videoPath), {
    caption: {
      tiktok: "Only TikTok",
      instagram: "",
      youtube: { title: "", description: "" },
    },
    visibility: { tiktok: "public", youtube: "public" },
    scheduledAt: null,
    tags: [],
  });
});

test("falls back to the legacy txt sidecar", async () => {
  const dir = await makeTempDir();
  const videoPath = path.join(dir, "clip.mp4");
  await fs.writeFile(videoPath, "fixture");
  await fs.writeFile(path.join(dir, "clip.txt"), " Legacy caption ");

  const metadata = await loadVideoMetadata(videoPath);

  assert.equal(metadata.caption.tiktok, "Legacy caption");
  assert.equal(metadata.caption.instagram, "Legacy caption");
  assert.deepEqual(metadata.caption.youtube, {
    title: "Legacy caption",
    description: "Legacy caption",
  });
});

test("falls back to legacy caption when metadata JSON is corrupt", async () => {
  const dir = await makeTempDir();
  const videoPath = path.join(dir, "clip.mp4");
  await fs.writeFile(videoPath, "fixture");
  await fs.writeFile(path.join(dir, "clip.meta.json"), "{invalid");
  await fs.writeFile(path.join(dir, "clip.txt"), "Fallback caption");

  const warnings = [];
  const metadata = await loadVideoMetadata(videoPath, { logger: (message) => warnings.push(message) });
  assert.equal(metadata.caption.tiktok, "Fallback caption");
  assert.equal(metadata.caption.instagram, "Fallback caption");
  assert.deepEqual(metadata.caption.youtube, { title: "Fallback caption", description: "Fallback caption" });
  assert.match(warnings[0], /^\[\d{4}-\d{2}-\d{2}T/);
});
