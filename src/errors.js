const ERROR_TYPES = Object.freeze({
  TRANSIENTE: "TRANSIENTE",
  FATAL: "FATAL",
  DUDOSO: "DUDOSO",
});

const TRANSIENT_PATTERNS = [
  /429|rate limit/i,
  /408|500|502|503|504/,
  /timeout|timed out/i,
  /network|net::|econn|connection reset|connection refused|socket hang up/i,
  /temporarily unavailable|try again/i,
];

const FATAL_PATTERNS = [
  /selector|locator|could not find|cannot find|not found/i,
  /login|log in|sign in|signin|session expired|2fa|two-factor|verification code/i,
  /rejected|rejection|community guidelines|copyright|not eligible|forbidden|blocked/i,
];

const SESSION_PATTERNS = [
  /\blog\s*in\b|\bsign\s*in\b|\blogin\b|\bsignin\b/i,
  /2fa|two[- ]factor|verification code|security challenge/i,
  /iniciar sesi[o\u00f3]n|anmelden|connexion/i,
];

class AutoSocialError extends Error {
  constructor(message, type, details = {}) {
    super(message);
    this.name = "AutoSocialError";
    this.type = type;
    this.platform = details.platform;
    this.cause = details.cause;
    this.screenshotPath = details.screenshotPath;
  }
}

function createTransientError(message, details) {
  return new AutoSocialError(message, ERROR_TYPES.TRANSIENTE, details);
}

function createFatalError(message, details) {
  return new AutoSocialError(message, ERROR_TYPES.FATAL, details);
}

function createUncertainError(message, details) {
  return new AutoSocialError(message, ERROR_TYPES.DUDOSO, details);
}

function isSessionExpiredText(value) {
  const text = String(value || "");
  return SESSION_PATTERNS.some((pattern) => pattern.test(text));
}

function assertNotExpired({ bodyText = "", url = "", platform } = {}) {
  if (isSessionExpiredText(`${bodyText}\n${url}`)) {
    throw createFatalError(`Session expired or login/2FA required on ${platform || "platform"}.`, {
      platform,
    });
  }
}

async function assertPageSession(page, platform) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    assertNotExpired({ bodyText, url: page.url(), platform });
    if (bodyText.trim() || attempt === 2) {
      return;
    }
    await page.waitForTimeout(500).catch(() => { });
  }
}

function classifyError(error, details = {}) {
  if (error instanceof AutoSocialError) {
    return error;
  }
  const message = String(error?.message || error || "Unknown automation error");
  const type = FATAL_PATTERNS.some((pattern) => pattern.test(message))
    ? ERROR_TYPES.FATAL
    : TRANSIENT_PATTERNS.some((pattern) => pattern.test(message))
      ? ERROR_TYPES.TRANSIENTE
      : ERROR_TYPES.FATAL;
  return new AutoSocialError(message, type, { ...details, cause: error });
}

async function withTransientRetries(operation, options = {}) {
  const maxRetries = options.maxRetries ?? 2;
  const backoffMs = options.backoffMs || [60000, 300000];
  const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const classify = options.classify || classifyError;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const normalized = classify(error);
      if (normalized.type !== ERROR_TYPES.TRANSIENTE || attempt >= maxRetries) {
        throw normalized;
      }
      const delay = backoffMs[attempt] ?? backoffMs[backoffMs.length - 1] ?? 0;
      options.onRetry?.({ attempt: attempt + 1, delay, error: normalized });
      await wait(delay);
    }
  }
}

async function writeErrorReport(directory, result, videoPath) {
  const fs = require("fs/promises");
  const path = require("path");
  await fs.mkdir(directory, { recursive: true });
  const baseName = path.basename(videoPath);
  const reportPath = path.join(directory, `${baseName}.error.json`);
  const report = {
    motivo: result.error || "Unknown publication failure.",
    tipo: result.errorType || result.type || ERROR_TYPES.FATAL,
    screenshot: result.screenshotPath || null,
    timestamp: new Date().toISOString(),
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return reportPath;
}

module.exports = {
  AutoSocialError,
  ERROR_TYPES,
  assertNotExpired,
  assertPageSession,
  classifyError,
  createFatalError,
  createTransientError,
  createUncertainError,
  isSessionExpiredText,
  withTransientRetries,
  writeErrorReport,
};
