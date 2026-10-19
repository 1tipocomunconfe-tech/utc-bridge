const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { copyIfMissing, processInboxOnce } = require("../orchestrator");

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "autosocial-orchestrator-"));
}

async function makeFixture() {
  const root = await makeTempDir();
  const inboxDir = path.join(root, "inbox");
  const queueDirs = {
    tiktok: path.join(root, "queue", "tiktok", "pending"),
    instagram: path.join(root, "queue", "instagram", "pending"),
    youtube: path.join(root, "queue", "youtube", "pending"),
  };
  await fs.mkdir(inboxDir, { recursive: true });
  await fs.writeFile(path.join(inboxDir, "mi-video.mp4"), "video-content");
  await fs.writeFile(
    path.join(inboxDir, "mi-video.meta.json"),
    JSON.stringify({
      caption: {
        tiktok: "TikTok text",
        instagram: "Instagram text",
        youtube: { title: "YouTube title", description: "YouTube description" },
      },
      visibility: { tiktok: "public", youtube: "public" },
      scheduledAt: "2026-10-21T09:30:00-04:00",
      tags: ["#fyp"],
    })
  );
  return { root, inboxDir, queueDirs };
}

test("applies stagger offsets to each platform sidecar", async () => {
  const fixture = await makeFixture();
  const result = await processInboxOnce({ ...fixture, accountId: "test", now: new Date("2026-10-19T00:00:00Z") });

  assert.equal(result.ok, true);
  for (const [platform, expectedSchedule] of Object.entries({
    tiktok: "2026-10-21T13:30:00.000Z",
    instagram: "2026-10-21T14:15:00.000Z",
    youtube: "2026-10-21T15:00:00.000Z",
  })) {
    const files = await fs.readdir(fixture.queueDirs[platform]);
    const metadataFile = files.find((fileName) => fileName.endsWith(".meta.json"));
    const metadata = JSON.parse(await fs.readFile(path.join(fixture.queueDirs[platform], metadataFile), "utf8"));
    assert.equal(metadata.scheduledAt, expectedSchedule);
  }
});

test("propagates only the fields relevant to each platform", async () => {
  const fixture = await makeFixture();
  await processInboxOnce({ ...fixture, accountId: "test" });

  const tiktokFiles = await fs.readdir(fixture.queueDirs.tiktok);
  const instagramFiles = await fs.readdir(fixture.queueDirs.instagram);
  const youtubeFiles = await fs.readdir(fixture.queueDirs.youtube);
  const tiktok = JSON.parse(await fs.readFile(path.join(fixture.queueDirs.tiktok, tiktokFiles.find((name) => name.endsWith(".meta.json"))), "utf8"));
  const instagram = JSON.parse(await fs.readFile(path.join(fixture.queueDirs.instagram, instagramFiles.find((name) => name.endsWith(".meta.json"))), "utf8"));
  const youtube = JSON.parse(await fs.readFile(path.join(fixture.queueDirs.youtube, youtubeFiles.find((name) => name.endsWith(".meta.json"))), "utf8"));

  assert.deepEqual(tiktok.caption, { tiktok: "TikTok text" });
  assert.deepEqual(tiktok.visibility, { tiktok: "public" });
  assert.deepEqual(instagram.caption, { instagram: "Instagram text" });
  assert.equal(instagram.visibility, undefined);
  assert.deepEqual(youtube.caption, { youtube: { title: "YouTube title", description: "YouTube description" } });
  assert.deepEqual(youtube.visibility, { youtube: "public" });
});

test("is idempotent and does not duplicate destination files", async () => {
  const fixture = await makeFixture();
  const first = await processInboxOnce({ ...fixture, accountId: "test" });
  const second = await processInboxOnce({ ...fixture, accountId: "test" });

  assert.equal(first.processed.length, 1);
  assert.equal(second.processed.length, 0);
  for (const platform of Object.keys(fixture.queueDirs)) {
    const files = await fs.readdir(fixture.queueDirs[platform]);
    assert.equal(files.filter((name) => name.endsWith(".mp4")).length, 1);
    assert.equal(files.filter((name) => name.endsWith(".meta.json")).length, 1);
  }
  const processedFiles = await fs.readdir(path.join(fixture.inboxDir, "processed"));
  assert.equal(processedFiles.filter((name) => name.endsWith(".mp4")).length, 1);
});

test("replaces partial copies atomically and retries only the failed platform", async () => {
  const root = await makeTempDir();
  const source = path.join(root, "source.mp4");
  const destination = path.join(root, "destination.mp4");
  await fs.writeFile(source, "complete-video");
  await fs.writeFile(destination, "partial");
  await copyIfMissing(source, destination);
  assert.equal(await fs.readFile(destination, "utf8"), "complete-video");

  const inbox = path.join(root, "inbox");
  const queueDirs = {
    tiktok: path.join(root, "tiktok"),
    instagram: path.join(root, "instagram"),
    youtube: path.join(root, "youtube"),
  };
  await fs.mkdir(inbox, { recursive: true });
  await fs.writeFile(path.join(inbox, "clip.mp4"), "video");
  await fs.writeFile(queueDirs.instagram, "not-a-directory");
  const first = await processInboxOnce({ inboxDir: inbox, queueDirs, accountId: "test", now: new Date("2026-10-19T00:00:00Z") });
  assert.equal(first.ok, false);
  assert.equal(first.failed.length, 1);
  assert.equal((await fs.readdir(queueDirs.tiktok)).some((name) => name.endsWith(".mp4")), true);
  assert.equal((await fs.readdir(queueDirs.youtube)).some((name) => name.endsWith(".mp4")), true);

  await fs.unlink(queueDirs.instagram);
  const second = await processInboxOnce({ inboxDir: inbox, queueDirs, accountId: "test", now: new Date("2026-10-19T00:00:00Z") });
  assert.equal(second.ok, true);
  assert.equal((await fs.readdir(path.join(inbox, "processed"))).some((name) => name.endsWith(".mp4")), true);
});
