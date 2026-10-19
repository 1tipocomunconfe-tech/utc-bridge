#!/usr/bin/env node
const fs = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");
const { config } = require("../src/config");
const { initStealth } = require("../src/stealth");
const {
  getActiveAccount,
  getAccountProxy,
  getPlatformProfileDir,
  getProxyGeographyWarning,
  parseProxy,
} = require("../src/account-manager");

function getArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function log(message, method = console.log) {
  method(`[${new Date().toISOString()}] [stealth-check] ${message}`);
}

async function run() {
  const activeAccount = await getActiveAccount();
  const accountId = getArgument("--account") || activeAccount.id;
  const platform = getArgument("--platform") || "tiktok";
  const proxyValue = getArgument("--proxy");
  const proxy = proxyValue ? parseProxy(proxyValue) : await getAccountProxy(accountId);
  const profileDir = await getPlatformProfileDir(platform, accountId);
  const screenshotPath = path.resolve(config.projectRoot, "docs", "stealth-check.png");
  await fs.mkdir(profileDir, { recursive: true });
  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });

  if (proxyValue) {
    const warning = getProxyGeographyWarning(proxyValue);
    if (warning) {
      log(`WARNING ${warning}`, console.warn);
    }
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: hasFlag("--headless") || config.headless,
    viewport: { width: 1400, height: 1000 },
    locale: config.browserLocale,
    timezoneId: config.timezone,
    proxy,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  await initStealth(context, { accountId, locale: config.browserLocale, timezone: config.timezone });
  log(`Persistent context launched for account ${accountId} with ${proxy ? `proxy ${proxy.server}` : "direct connection"}.`);

  const page = context.pages()[0] || (await context.newPage());
  let navigationError = null;
  try {
    await page.goto("https://bot.sannysoft.com", { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (error) {
    navigationError = error;
    log(`Navigation warning: ${error.message}`, console.warn);
  }
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(async () => {
    await page.screenshot({ path: screenshotPath }).catch(() => { });
  });
  log(`Screenshot saved to ${screenshotPath}.`);
  await context.close();
  return { ok: !navigationError, screenshotPath, navigationError };
}

if (require.main === module) {
  run().catch((error) => {
    log(`Fatal error: ${error.message}`, console.error);
    process.exitCode = 1;
  });
}

module.exports = { run };
