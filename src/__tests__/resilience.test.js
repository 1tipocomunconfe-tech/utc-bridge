const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { ERROR_TYPES } = require("../errors");
const { SeenRegistry } = require("../idempotency");
const { LimitsStore } = require("../limits");
const { getNextQueuedItem } = require("../queue");
const { postWithResult } = require("../post-finalizer");
const { _private: youtubePrivate } = require("../youtube-uploader");

test("orphaned idempotency lock becomes uncertain and notifies", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-orphan-lock-"));
  const statePath = path.join(root, "seen.json");
  const lockPath = `${statePath}.lock`;
  const notifications = [];
  await fs.writeFile(lockPath, JSON.stringify({
    pid: 99999999,
    host: os.hostname(),
    acquiredAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
    accountId: "account",
    platform: "youtube",
    hash: "orphan-hash",
    videoPath: path.join(root, "clip.mp4"),
  }));

  const registry = new SeenRegistry({
    statePath,
    staleLockMs: 30 * 60 * 1000,
    notifier: { notifyFailure: async (payload) => notifications.push(payload) },
  });
  const result = await registry.claim("account", "youtube", "orphan-hash", path.join(root, "clip.mp4"));
  assert.equal(result.claimed, false);
  assert.equal(result.existing.status, "uncertain");
  await assert.rejects(fs.access(lockPath), { code: "ENOENT" });
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.equal(state.accounts.account.youtube["orphan-hash"].status, "uncertain");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notifications.length, 1);
});

test("fresh lock from a live process is never removed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-fresh-lock-"));
  const statePath = path.join(root, "seen.json");
  const lockPath = `${statePath}.lock`;
  await fs.writeFile(lockPath, JSON.stringify({
    pid: process.pid,
    host: os.hostname(),
    acquiredAt: new Date().toISOString(),
    accountId: "account",
    platform: "tiktok",
    hash: "fresh-hash",
  }));
  const registry = new SeenRegistry({ statePath, staleLockMs: 30 * 60 * 1000 });
  const result = await registry.claim("account", "tiktok", "fresh-hash", "clip.mp4");
  assert.equal(result.existing.status, "lock-held");
  await fs.access(lockPath);
  await fs.unlink(lockPath);
});

test("concurrent quota reservations stay within the cap", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-limits-lock-"));
  const storeOptions = {
    statePath: path.join(root, "limits.json"),
    timezone: "UTC",
    caps: { tiktok: 2, instagram: 2, youtube: 2 },
    staleLockMs: 100,
  };
  const stores = Array.from({ length: 8 }, () => new LimitsStore(storeOptions));
  const results = await Promise.all(stores.map((store) => store.reserve("account", "tiktok", new Date("2026-10-21T12:00:00Z"))));
  assert.equal(results.filter((result) => result.ok).length, 2);
  assert.equal((await stores[0].getStatus("account", "tiktok", new Date("2026-10-21T12:00:00Z"))).count, 2);
});

test("daily cap one permits exactly one concurrent reservation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-limits-cap-one-"));
  const options = {
    statePath: path.join(root, "limits.json"),
    timezone: "UTC",
    caps: { tiktok: 1, instagram: 2, youtube: 2 },
    staleLockMs: 100,
  };
  const stores = [new LimitsStore(options), new LimitsStore(options)];
  const at = new Date("2026-10-21T12:00:00Z");
  const results = await Promise.all(stores.map((store) => store.reserve("account", "tiktok", at)));

  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok).length, 1);
  assert.equal((await stores[0].getStatus("account", "tiktok", at)).count, 1);
});

test("literal concurrent quota race test cap=1", async () => {
  const round = 25;
  const cap = 1;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-literal-quota-"));
  const options = {
    statePath: path.join(root, "limits.json"),
    timezone: "UTC",
    caps: { tiktok: cap },
    staleLockMs: 10,
  };
  const stores = Array.from({ length: round }, () => new LimitsStore(options));
  const at = new Date("2026-10-21T12:00:00Z");

  // Ejecutar reservas concurrentes
  const results = await Promise.all(stores.map((store) => store.reserve("account", "tiktok", at)));

  // Verificar resultados finales
  const fulfilledCount = results.filter((r) => r.ok).length;
  const rejectedCount = results.filter((r) => !r.ok).length;

  // Con cap=1 y 'round' reservas concurrentes, exactamente 1 debería fulfillment
  // y las restantes 'round-1' deberían ser rechazadas
  assert.equal(fulfilledCount, 1, "Exactly 1 reservation should be fulfilled with cap=1 and " + round + " concurrent attempts");
  assert.equal(rejectedCount, round - 1, "All other " + (round - 1) + " reservations should be rejected with cap=1");

  // El store debe quedar consistente: count = 1
  const status = await stores[0].getStatus("account", "tiktok", at);
  assert.equal(status.count, 1, "LimitsStore count should be exactly 1 after race");
  assert.equal(status.remaining, 0, "LimitsStore remaining should be 0 after cap=1");
});

test("orphaned idempotency lock becomes uncertain and notifies", async () => {
  // Duplicate - already tested above, but keeping for test suite completeness
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-orphan-lock-"));
  const statePath = path.join(root, "seen.json");
  const lockPath = `${statePath}.lock`;
  const notifications = [];
  await fs.writeFile(lockPath, JSON.stringify({
    pid: 99999999,
    host: os.hostname(),
    acquiredAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
    accountId: "account",
    platform: "youtube",
    hash: "orphan-hash",
    videoPath: path.join(root, "clip.mp4"),
  }));

  const registry = new SeenRegistry({
    statePath,
    staleLockMs: 30 * 60 * 1000,
    notifier: { notifyFailure: async (payload) => notifications.push(payload) },
  });
  const result = await registry.claim("account", "youtube", "orphan-hash", path.join(root, "clip.mp4"));
  assert.equal(result.claimed, false);
  assert.equal(result.existing.status, "uncertain");
  await assert.rejects(fs.access(lockPath), { code: "ENOENT" });
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.equal(state.accounts.account.youtube["orphan-hash"].status, "uncertain");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notifications.length, 1);
});
