const fs = require("fs/promises");
const os = require("os");

const DEFAULT_STALE_LOCK_MS = 30 * 60 * 1000;

async function readLockMetadata(lockPath) {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : {};
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) {
      return {};
    }
    throw error;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function isStaleLock(metadata, options = {}) {
  const staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
  const acquiredAt = Date.parse(metadata?.acquiredAt || "");
  if (!Number.isFinite(acquiredAt)) {
    return Number(options.lockAgeMs) > staleLockMs;
  }
  if (Date.now() - acquiredAt > staleLockMs) {
    return true;
  }
  if (metadata.host && metadata.host !== os.hostname()) {
    return false;
  }
  return !isProcessAlive(Number(metadata.pid));
}

async function acquireExclusiveLock(lockPath, metadata = {}, options = {}) {
  await fs.mkdir(require("path").dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await fs.open(lockPath, "wx");
    const lockMetadata = {
      pid: process.pid,
      host: os.hostname(),
      acquiredAt: new Date().toISOString(),
      ...metadata,
    };
    await handle.writeFile(`${JSON.stringify(lockMetadata)}\n`, "utf8");
    return { acquired: true, handle, metadata: lockMetadata };
  } catch (error) {
    await handle?.close().catch(() => { });
    if (error.code !== "EEXIST") {
      throw error;
    }
    const existing = await readLockMetadata(lockPath);
    let lockAgeMs = 0;
    try {
      const stat = await fs.stat(lockPath);
      lockAgeMs = Date.now() - stat.mtimeMs;
    } catch (statError) {
      if (statError.code === "ENOENT") {
        return { acquired: false, stale: false, existing: {} };
      }
      throw statError;
    }
    return {
      acquired: false,
      stale: isStaleLock(existing, { ...options, lockAgeMs }),
      existing,
    };
  }
}

async function releaseExclusiveLock(lockPath, handle) {
  await handle?.close().catch(() => { });
  await fs.unlink(lockPath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function moveLockToReview(lockPath, suffix = "uncertain") {
  const reviewPath = `${lockPath}.${suffix}-${Date.now()}-${process.pid}`;
  try {
    await fs.rename(lockPath, reviewPath);
    return reviewPath;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

module.exports = {
  DEFAULT_STALE_LOCK_MS,
  acquireExclusiveLock,
  isProcessAlive,
  isStaleLock,
  moveLockToReview,
  readLockMetadata,
  releaseExclusiveLock,
};
