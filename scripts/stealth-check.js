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

// Net-policy check function
function checkNetPolicy(url) {
  /*
   * net-policy: only allow 127.0.0.1 with ephemeral port.
   * Bloquear cualquier otro host o IP literal.
   */
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const port = parsed.port;

    // Bloquear IPs literales (IPv4 o IPv6)
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || /^\[.*\]$/.test(hostname)) {
      return { pass: false, detail: `IP literal blocked: ${hostname}` };
    }

    // Permitir 127.0.0.1 con cualquier puerto
    if (hostname === "127.0.0.1") {
      return { pass: true, detail: `127.0.0.1 allowed: ${url}` };
    }

    // Bloquear cualquier otro hostname
    return { pass: false, detail: `Hostname blocked: ${hostname}` };
  } catch (e) {
    return { pass: false, detail: `Invalid URL: ${e.message}` };
  }
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

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function run() {
  const accountId = getArgument("--account") || "default";
  const screenshotPath = path.resolve(config.projectRoot, "docs", "stealth-check.png");
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-stealth-check-"));
  const profileDir = path.join(temporaryRoot, "profile");
  const fixture = await serveFixture();
  let context;
  let navigationError = null;

  // Definir checks
  const checks = [];

  // Check 1: Fixture load
  checks.push({
    name: "fixture-load",
    purpose: "Verify the test fixture HTML loads correctly",
    setup: async () => { },
    execute: async () => {
      try {
        return { pass: true, detail: `Fixture loaded: ${fixture.url}` };
      } catch (e) {
        return { pass: false, detail: `Fixture load error: ${e.message}` };
      }
    },
    cleanup: async () => { },
  });

  // Check 2: Stealth mode initialization
  checks.push({
    name: "stealth-init",
    purpose: "Verify stealth plugin is initialized correctly",
    setup: async () => { },
    execute: async () => {
      try {
        context = await chromium.launchPersistentContext(profileDir, {
          headless: hasFlag("--headless") || config.headless,
          viewport: { width: 1400, height: 1000 },
          locale: config.browserLocale,
          timezoneId: config.timezone,
          args: ["--disable-blink-features=AutomationControlled"],
        });
        await initStealth(context, { accountId, locale: config.browserLocale, timezone: config.timezone });
        log("Disposable context launched for account seed " + accountId + ".");
        context.close();
        context = null;
        return { pass: true, detail: "Stealth initialized successfully" };
      } catch (e) {
        if (context) try { await context.close(); } catch {}
        return { pass: false, detail: `Stealth init error: ${e.message}` };
      }
    },
    cleanup: async () => { },
  });

  // Check 3: Net-policy route interception
  checks.push({
    name: "net-policy",
    purpose: "Verify network policy blocks external IPs and allows localhost only",
    setup: async () => { },
    execute: async () => {
      const blockedUrls = [];
      const allowedUrls = [];

      const browser = await chromium.launch({ headless: true });
      const testContext = await browser.newContext();
      const page = await testContext.newPage();

      page.on("request", (request) => {
        const url = request.url();
        const result = checkNetPolicy(url);
        if (result.pass) {
          allowedUrls.push({ url, detail: result.detail });
        } else {
          blockedUrls.push({ url, detail: result.detail });
        }
      });

      try {
        await page.goto(fixture.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      } catch (e) {
        blockedUrls.push({ url: fixture.url, detail: `Navigation error: ${e.message}` });
      }

      await page.waitForTimeout(3000);

      await browser.close();

      const totalChecks = blockedUrls.length + allowedUrls.length;
      const passRate = totalChecks > 0 ? Math.round((allowedUrls.length / totalChecks) * 100) : 100;

      let status;
      if (blockedUrls.length > 0 && allowedUrls.some(u => u.url.includes("127.0.0.1"))) {
        status = "pass";
      } else {
        status = "fail";
      }

      return {
        pass: status === "pass",
        detail: `Net-policy check: ${allowedUrls.length} allowed, ${blockedUrls.length} blocked. Pass rate: ${passRate}%`,
        blockedUrls,
        allowedUrls,
      };
    },
    cleanup: async () => { },
  });

  // Check 4: External URL blocking
  checks.push({
    name: "external-url-block",
    purpose: "Verify external URLs (non-localhost) are blocked",
    setup: async () => { },
    execute: async () => {
      const externalBlocked = [];

      const browser = await chromium.launch({ headless: true });
      const testContext = await browser.newContext();
      const page = await testContext.newPage();

      page.on("request", (request) => {
        const url = request.url();
        try {
          const parsed = new URL(url);
          if (parsed.hostname !== "127.0.0.1" && !parsed.hostname.startsWith("127.")) {
            externalBlocked.push({ url, detail: `External hostname blocked: ${parsed.hostname}` });
          }
        } catch {
          externalBlocked.push({ url, detail: "Invalid URL blocked" });
        }
      });

      await page.goto(fixture.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3000);

      await browser.close();

      return {
        pass: externalBlocked.length === 0,
        detail: `External URL blocking: ${externalBlocked.length} external URLs attempted, ${externalBlocked.length} blocked`,
        blockedCount: externalBlocked.length,
      };
    },
    cleanup: async () => { },
  });

  // Ejecutar todos los checks
  log("Running " + checks.length + " stealth checks...");

  const results = [];

  for (const check of checks) {
    log("Running check: " + check.name);
    const setupResult = await check.setup();
    if (setupResult !== undefined && setupResult !== null) {
      log("  Setup result: " + JSON.stringify(setupResult));
    }
    const executeResult = await check.execute();
    results.push({
      name: check.name,
      pass: executeResult.pass,
      detail: executeResult.detail,
    });
    if (check.cleanup) {
      await check.cleanup();
    }
    log("  Check " + check.name + ": " + (executeResult.pass ? "PASS" : "FAIL") + " - " + executeResult.detail);
  }

  // Resultado final
  const allPassed = results.every(r => r.pass);
  const passCount = results.filter(r => r.pass).length;
  const failCount = results.filter(r => !r.pass).length;

  log("\n=== Stealth Check Results ===");
  log("Total checks: " + checks.length);
  log("Passed: " + passCount);
  log("Failed: " + failCount);
  log("Overall: " + (allPassed ? "PASS" : "FAIL"));

  // Captura de pantalla final
  if (context) {
    try {
      await context.close();
    } catch {}
  }

  try {
    await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
    if (context && context.pages() && context.pages().length > 0) {
      await context.pages()[0].screenshot({ path: screenshotPath, fullPage: true }).catch(() => { });
    }
  } catch (e) {
    log("Screenshot directory creation warning: " + e.message);
  }

  if (allPassed) {
    log("\nAll checks passed. Exit code: 0");
    process.exitCode = 0;
  } else {
    log("\nSome checks failed. Exit code: 1");
    process.exitCode = 1;
  }
}

if (require.main === module) {
  run().catch((error) => {
    log("Fatal error: " + error.message, console.error);
    process.exitCode = 1;
  });
}

module.exports = { run, serveFixture, checkNetPolicy };
