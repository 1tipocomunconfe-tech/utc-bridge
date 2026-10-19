const test = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const {
  getStealthSeed,
  initStealth,
  normalizeLocaleLanguages,
} = require("../stealth");

test("stealth seed and locale languages are deterministic", () => {
  assert.equal(getStealthSeed("account-a"), getStealthSeed("account-a"));
  assert.notEqual(getStealthSeed("account-a"), getStealthSeed("account-b"));
  assert.deepEqual(normalizeLocaleLanguages("es-MX"), ["es-MX", "es"]);
});

test("stealth init script exposes coherent browser signals", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await initStealth(context, {
    accountId: "test-account",
    locale: "es-MX",
    timezone: "America/Mexico_City",
  });
  const page = await context.newPage();
  const signals = await page.evaluate(() => ({
    webdriver: navigator.webdriver,
    language: navigator.language,
    languages: navigator.languages,
    plugins: navigator.plugins.length,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }));

  assert.equal(signals.webdriver, undefined);
  assert.equal(signals.language, "es-MX");
  assert.deepEqual(signals.languages, ["es-MX", "es"]);
  assert.ok(signals.plugins >= 1);
  assert.equal(signals.timezone, "America/Mexico_City");
  await browser.close();
});
