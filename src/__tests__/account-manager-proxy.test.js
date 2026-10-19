const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getProxyGeographyWarning,
  parseProxy,
} = require("../account-manager");

test("parseProxy converts credentials into Playwright proxy options", () => {
  assert.deepEqual(parseProxy("http://user:p%40ss@proxy.us.example:8080"), {
    server: "http://proxy.us.example:8080",
    username: "user",
    password: "p@ss",
  });
});

test("proxy geography warning detects country mismatch", () => {
  assert.match(
    getProxyGeographyWarning("http://proxy.mx.example:8080", {
      locale: "en-US",
      timezone: "America/New_York",
    }),
    /Proxy country MX differs/
  );
  assert.equal(
    getProxyGeographyWarning("http://proxy.us.example:8080", {
      locale: "en-US",
      timezone: "America/New_York",
    }),
    null
  );
});
