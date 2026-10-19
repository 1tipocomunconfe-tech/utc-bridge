const fs = require("fs/promises");
const path = require("path");
const cron = require("node-cron");
const { config } = require("./config");
const { getNextQueuedItem } = require("./queue");
const { LimitsStore } = require("./limits");
const { postNextFromQueue } = require("./post-service");
const { reconcileStartupState } = require("./startup-reconcile");
const { getKillSwitchReason, isKillSwitchEnabled } = require("./kill-switch");

function now() {
  return new Date().toISOString();
}

function parseClock(value) {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(String(value || ""));
  if (!match) {
    throw new Error(`Invalid publication window time: ${value}`);
  }
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function getLocalMinutes(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

function isWithinPublishWindow(date, start, end, timezone = config.timezone) {
  const current = getLocalMinutes(date, timezone);
  const startMinutes = parseClock(start);
  const endMinutes = parseClock(end);
  if (startMinutes === endMinutes) {
    return true;
  }
  if (startMinutes < endMinutes) {
    return current >= startMinutes && current < endMinutes;
  }
  return current >= startMinutes || current < endMinutes;
}

function getSchedulerStatePath(accountId, platform, stateDir = config.schedulerStateDir) {
  return path.resolve(stateDir, accountId, `${platform}.json`);
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

class PublicationLock {
  constructor(options = {}) {
    this.statePath = options.statePath;
    this.lockPath = `${this.statePath}.lock`;
    this.clock = options.clock || (() => new Date());
  }

  async acquire(videoPath) {
    const state = await readJsonIfExists(this.statePath, { inProgress: null });
    if (state.inProgress) {
      return { ok: false, reason: `Publication already in progress for ${state.inProgress.videoPath}.` };
    }

    let handle;
    try {
      await fs.mkdir(path.dirname(this.statePath), { recursive: true });
      handle = await fs.open(this.lockPath, "wx");
      await handle.writeFile(`${JSON.stringify({ videoPath, startedAt: this.clock().toISOString() })}\n`, "utf8");
    } catch (error) {
      if (error.code === "EEXIST") {
        return { ok: false, reason: "Another scheduler process owns the publication lock." };
      }
      throw error;
    } finally {
      await handle?.close();
    }

    await writeJson(this.statePath, {
      inProgress: { videoPath, startedAt: this.clock().toISOString() },
    });
    return { ok: true };
  }

  async release(videoPath, successful) {
    const state = await readJsonIfExists(this.statePath, { inProgress: null });
    await writeJson(this.statePath, {
      inProgress: null,
      lastCompleted: successful
        ? { videoPath, completedAt: this.clock().toISOString() }
        : state.lastCompleted || null,
    });
    try {
      await fs.unlink(this.lockPath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function createSchedulerPolicy(options = {}) {
  const platform = options.platform || "tiktok";
  const accountId = options.accountId || "default";
  const clock = options.clock || (() => new Date());
  const queueDir = options.queueDir || config.platformQueues[platform];
  const getItem = options.getNextQueuedItem || getNextQueuedItem;
  const random = options.random || Math.random;
  const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const postDelayMs = options.postDelayMs ?? config.postDelayMs;
  const jitterMaxMs = options.jitterMaxMs ?? config.jitterMaxMs;
  const windowStart = options.windowStart || config.publishWindowStart;
  const windowEnd = options.windowEnd || config.publishWindowEnd;
  const timezone = options.timezone || config.timezone;
  const limits = options.limits || new LimitsStore({
    statePath: options.limitsStatePath,
    timezone,
    clock,
    caps: options.caps,
  });
  const publicationLock = options.publicationLock || new PublicationLock({
    statePath: options.statePath || getSchedulerStatePath(accountId, platform, options.stateDir),
    clock,
  });

  async function prepare() {
    const at = clock();
    const item = await getItem(queueDir, at);
    if (!item) {
      return { ok: true, skipped: true, reason: "Queue is empty." };
    }

    const scheduledAt = item.metadata?.scheduledAt ? new Date(item.metadata.scheduledAt) : null;
    if (scheduledAt && scheduledAt.getTime() > at.getTime()) {
      return {
        ok: true,
        skipped: true,
        reason: `Scheduled video deferred until ${item.metadata.scheduledAt}.`,
      };
    }

    if (!isWithinPublishWindow(at, windowStart, windowEnd, timezone)) {
      return {
        ok: true,
        skipped: true,
        reason: `Publication window closed (${windowStart}-${windowEnd}, ${timezone}).`,
      };
    }

    const lockResult = await publicationLock.acquire(item.videoPath);
    if (!lockResult.ok) {
      return { ok: true, skipped: true, reason: lockResult.reason };
    }

    let reserved = false;
    try {
      const limitResult = await limits.reserve(accountId, platform, at);
      if (!limitResult.ok) {
        await publicationLock.release(item.videoPath, false);
        return {
          ok: true,
          skipped: true,
          reason: `Daily cap exhausted for ${platform} (${limitResult.count}/${limitResult.cap}).`,
        };
      }
      reserved = true;

      if (!Number.isFinite(jitterMaxMs) || jitterMaxMs < 0 || !Number.isFinite(postDelayMs) || postDelayMs < 0) {
        throw new Error("POST_DELAY_MS and JITTER_MAX_MS must be non-negative numbers.");
      }
      const jitterMs = Math.floor(random() * (jitterMaxMs + 1));
      const totalDelayMs = postDelayMs + jitterMs;
      const plannedAt = new Date(at.getTime() + totalDelayMs);
      if (!isWithinPublishWindow(plannedAt, windowStart, windowEnd, timezone)) {
        await limits.release(accountId, platform, at);
        await publicationLock.release(item.videoPath, false);
        return {
          ok: true,
          skipped: true,
          reason: `Publication deferred because jitter exits the ${windowStart}-${windowEnd} window.`,
        };
      }

      if (jitterMs > 0) {
        await wait(jitterMs);
      }
      return { ok: true, item, jitterMs, totalDelayMs, reservedAt: at };
    } catch (error) {
      if (reserved) {
        await limits.release(accountId, platform, at).catch(() => { });
      }
      await publicationLock.release(item.videoPath, false).catch(() => { });
      throw error;
    }
  }

  async function finish(prepared, result) {
    if (!prepared?.item) {
      return;
    }
    const successful = Boolean(result?.ok && !result.skipped);
    if (!successful) {
      await limits.release(accountId, platform, prepared.reservedAt || clock());
    }
    await publicationLock.release(prepared.item.videoPath, successful);
  }

  return {
    finish,
    prepare,
  };
}

async function runScheduledPost(options = {}) {
  if (isKillSwitchEnabled(options.killSwitch)) {
    const reason = getKillSwitchReason();
    (options.logger || console.log)(`[${now()}] ${reason}`);
    return { ok: true, skipped: true, paused: true, reason };
  }
  const policy = options.policy || createSchedulerPolicy({
    platform: options.platform || "tiktok",
    accountId: options.accountId || "default",
    queueDir: options.queueDir || config.queueDir,
    getNextQueuedItem: options.getNextQueuedItem,
    clock: options.clock,
    limits: options.limits,
    statePath: options.statePath,
    stateDir: options.stateDir,
    limitsStatePath: options.limitsStatePath,
    postDelayMs: options.postDelayMs,
    jitterMaxMs: options.jitterMaxMs,
    windowStart: options.windowStart,
    windowEnd: options.windowEnd,
    timezone: options.timezone,
    wait: options.wait,
    random: options.random,
  });
  const logger = options.logger || console.log;
  console.log(`[${now()}] Checking queue...`);
  const prepared = await policy.prepare();
  if (prepared.skipped) {
    logger(`[${now()}] ${prepared.reason}`);
    return prepared;
  }

  try {
    const result = await (options.post || postNextFromQueue)(options.postOptions);
    await policy.finish(prepared, result);
    if (result.skipped) {
      logger(`[${now()}] ${result.reason}`);
    } else if (result.ok) {
      logger(`[${now()}] Posted successfully: ${result.movedVideo}`);
    } else {
      console.error(`[${now()}] Post failed: ${result.error}`);
      if (result.screenshotPath) {
        console.error(`[${now()}] Screenshot: ${result.screenshotPath}`);
      }
    }
    return result;
  } catch (error) {
    await policy.finish(prepared, { ok: false }).catch(() => { });
    throw error;
  }
}

async function startDaemon(options = {}) {
  await (options.reconcile || reconcileStartupState)(options);
  if (!cron.validate(config.cronExpression)) {
    throw new Error(`Invalid CRON_EXPRESSION: ${config.cronExpression}`);
  }

  console.log(`Starting scheduler: ${config.cronExpression} (${config.timezone})`);
  console.log("Press Ctrl+C to stop.");

  let task;
  const schedule = options.schedule || cron.schedule;
  task = schedule(
    config.cronExpression,
    async () => {
      if (isKillSwitchEnabled()) {
        console.log(`[${now()}] ${getKillSwitchReason()}`);
        task.stop();
        return;
      }
      await runScheduledPost();
    },
    {
      timezone: config.timezone,
    }
  );
  return task;
}

module.exports = {
  createSchedulerPolicy,
  getLocalMinutes,
  getSchedulerStatePath,
  isWithinPublishWindow,
  runScheduledPost,
  startDaemon,
};
