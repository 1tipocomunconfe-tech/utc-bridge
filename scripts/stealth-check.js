#!/usr/bin/env node
const fs = require("fs/promises");
const http = require("http");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const { config } = require("../src/config");
const { initStealth } = require("../src/stealth");

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

async function serveFixture() {
  const fixturePath = path.resolve(__dirname, "stealth-fixture.html");
  const fixture = await fs.readFile(fixturePath);
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    if (requestUrl.pathname !== "/") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixture);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}/`,
  };
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(() => resolve()));
}

async function run() {
  const accountId = getArgument("--account") || "default";
  const screenshotPath = path.resolve(config.projectRoot, "docs", "stealth-check.png");
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-stealth-check-"));
  const profileDir = path.join(temporaryRoot, "profile");
  const fixture = await serveFixture();
  let context;
  let navigationError = null;

  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: hasFlag("--headless") || config.headless,
      viewport: { width: 1400, height: 1000 },
      locale: config.browserLocale,
      timezoneId: config.timezone,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    await initStealth(context, { accountId, locale: config.browserLocale, timezone: config.timezone });
    log(`Disposable context launched for account seed ${accountId}.`);

    const page = context.pages()[0] || (await context.newPage());
    try {
      await page.goto(fixture.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (error) {
      navigationError = error;
      log(`Navigation warning: ${error.message}`, console.warn);
    }
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(async () => {
      await page.screenshot({ path: screenshotPath }).catch(() => { });
    });
    log(`Screenshot saved to ${screenshotPath}.`);
  } finally {
    await context?.close().catch(() => { });
    await closeServer(fixture.server);
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }

  return { ok: !navigationError, screenshotPath, navigationError };
}

if (require.main === module) {
  run().catch((error) => {
    log(`Fatal error: ${error.message}`, console.error);
    process.exitCode = 1;
  });
}

module.exports = { run, serveFixture };
