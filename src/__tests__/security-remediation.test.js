const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  fetchWithRedirectPolicy,
  validateAllowedUrl,
} = require("../net-policy");
const { ProfileDownloadController } = require("../profile-download-controller");
const { AutoDownloadController } = require("../autodownload-controller");
const {
  redactAccountState,
  requireDashboardAccess,
  serializeAccountsResponse,
} = require("../dashboard-server");

const projectRoot = path.resolve(__dirname, "../..");

test("downloaders reject link-local IPs and evil-tiktok.com", async () => {
  assert.throws(
    () => validateAllowedUrl("http://169.254.169.254/latest/meta-data"),
    /private or loopback/
  );
  assert.throws(
    () => validateAllowedUrl("https://evil-tiktok.com/@creator"),
    /not allowlisted/
  );

  const profileDownloader = new ProfileDownloadController({ fetchImpl: async () => { throw new Error("fetch should not run"); } });
  await assert.rejects(
    profileDownloader._runYtDlp("http://169.254.169.254/", 0, 1, true),
    /private or loopback/
  );

  const autoDownloader = new AutoDownloadController({ fetchImpl: async () => { throw new Error("fetch should not run"); } });
  autoDownloader.channel = "https://evil-tiktok.com/@creator";
  assert.throws(() => autoDownloader._channelUrl(), /not allowlisted/);
});

test("redirect to a non-allowlisted host aborts before the second request", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(null, {
      status: 302,
      headers: { location: "https://evil-tiktok.com/redirected" },
    });
  };

  await assert.rejects(
    fetchWithRedirectPolicy("https://www.tiktok.com/@creator", { fetchImpl }),
    /not allowlisted/
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, "manual");
});

test("redirect policy revalidates every allowed hop and caps the chain", async () => {
  const urls = [
    "https://www.tiktok.com/one",
    "https://cdn.tiktokcdn.com/two",
    "https://www.tiktok.com/three",
  ];
  const fetchImpl = async (url) => {
    const index = urls.indexOf(url);
    if (index < urls.length - 1) {
      return new Response(null, { status: 302, headers: { location: urls[index + 1] } });
    }
    return new Response("ok", { status: 200 });
  };

  const response = await fetchWithRedirectPolicy(urls[0], { fetchImpl, maxRedirects: 5 });
  assert.equal(response.status, 200);
  assert.deepEqual(urls, ["https://www.tiktok.com/one", "https://cdn.tiktokcdn.com/two", "https://www.tiktok.com/three"]);
});

test("/api/accounts serialization never returns proxy credentials", () => {
  const response = serializeAccountsResponse({
    accounts: [{ id: "default", name: "Default", proxy: "http://user:secret-pass@proxy.us.example:8080" }],
  }, { id: "default", name: "Default", proxy: "http://user:secret-pass@proxy.us.example:8080" });
  const serialized = JSON.stringify(response);
  assert.equal(serialized.includes("secret-pass"), false);
  assert.equal(serialized.includes("password"), false);
  assert.match(serialized, /user:\*\*\*@proxy\.us\.example:8080/);
});

test("dashboard GET state requires DASHBOARD_TOKEN", () => {
  const config = require("../config").config;
  const previousToken = config.dashboardToken;
  config.dashboardToken = "test-token";
  try {
    let statusCode = null;
    let nextCalled = false;
    requireDashboardAccess(
      { path: "/api/accounts", method: "GET", get: () => "" },
      { status(code) { statusCode = code; return this; }, json() {} },
      () => { nextCalled = true; }
    );
    assert.equal(statusCode, 401);
    assert.equal(nextCalled, false);

    statusCode = null;
    requireDashboardAccess(
      { path: "/api/accounts", method: "GET", get: (header) => header === "x-dashboard-token" ? "test-token" : "" },
      { status(code) { statusCode = code; return this; }, json() {} },
      () => { nextCalled = true; }
    );
    assert.equal(statusCode, null);
    assert.equal(nextCalled, true);
  } finally {
    config.dashboardToken = previousToken;
  }
});

test("dashboard HTML uses only local assets and no persistent token storage", () => {
  const html = fs.readFileSync(path.join(projectRoot, "web", "index.html"), "utf8");
  const operations = fs.readFileSync(path.join(projectRoot, "web", "operations.html"), "utf8");
  const scripts = fs.readFileSync(path.join(projectRoot, "web", "app.js"), "utf8") +
    fs.readFileSync(path.join(projectRoot, "web", "operations.js"), "utf8");
  const combined = `${html}\n${operations}\n${scripts}`;
  assert.doesNotMatch(combined, /unpkg\.com|fonts\.googleapis\.com/);
  assert.doesNotMatch(combined, /localStorage/);
  assert.match(html, /assets\/phosphor\.css/);
  assert.match(html, /assets\/fonts\.css/);
  assert.match(operations, /operations\.js/);
});
