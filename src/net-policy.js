const net = require("net");

const MAX_REDIRECTS = 5;
const ALLOWED_HOSTS = Object.freeze([
  "www.tiktok.com",
]);

const ALLOWED_CDN_SUFFIXES = Object.freeze([
  ".tiktokcdn.com",
  ".ibytedtos.com",
  ".muscdn.com",
]);

function normalizeHostname(hostname) {
  return String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
}

function ipv4ToNumber(value) {
  const parts = value.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256) + parts[3];
}

function isPrivateIp(hostname) {
  const normalized = normalizeHostname(hostname);
  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) {
    const value = ipv4ToNumber(normalized);
    if (value === null) return true;
    const ranges = [
      [ipv4ToNumber("0.0.0.0"), ipv4ToNumber("0.255.255.255")],
      [ipv4ToNumber("10.0.0.0"), ipv4ToNumber("10.255.255.255")],
      [ipv4ToNumber("100.64.0.0"), ipv4ToNumber("100.127.255.255")],
      [ipv4ToNumber("127.0.0.0"), ipv4ToNumber("127.255.255.255")],
      [ipv4ToNumber("169.254.0.0"), ipv4ToNumber("169.254.255.255")],
      [ipv4ToNumber("172.16.0.0"), ipv4ToNumber("172.31.255.255")],
      [ipv4ToNumber("192.0.0.0"), ipv4ToNumber("192.0.0.255")],
      [ipv4ToNumber("192.168.0.0"), ipv4ToNumber("192.168.255.255")],
      [ipv4ToNumber("198.18.0.0"), ipv4ToNumber("198.19.255.255")],
      [ipv4ToNumber("224.0.0.0"), ipv4ToNumber("255.255.255.255")],
    ];
    return ranges.some(([start, end]) => value >= start && value <= end);
  }

  if (ipVersion === 6) {
    return normalized === "::" || normalized === "::1" ||
      normalized.startsWith("fc") || normalized.startsWith("fd") ||
      normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
      normalized.startsWith("fea") || normalized.startsWith("feb") ||
      normalized.startsWith("::ffff:");
  }

  return false;
}

function isAllowedTikTokHost(hostname) {
  const normalized = normalizeHostname(hostname);
  if (ALLOWED_HOSTS.includes(normalized)) {
    return true;
  }
  return ALLOWED_CDN_SUFFIXES.some((suffix) => normalized.endsWith(suffix) && normalized.length > suffix.length);
}

function validateAllowedUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    throw new Error(`Blocked network URL: invalid URL (${String(value)}).`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Blocked network URL: protocol ${parsed.protocol} is not allowed.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`Blocked network URL: credentials are not allowed (${parsed.origin}).`);
  }
  if (isPrivateIp(parsed.hostname)) {
    throw new Error(`Blocked network URL: private or loopback address ${parsed.hostname}.`);
  }
  if (!isAllowedTikTokHost(parsed.hostname)) {
    throw new Error(`Blocked network URL: host ${normalizeHostname(parsed.hostname)} is not allowlisted.`);
  }
  return parsed;
}

async function cancelResponseBody(response) {
  if (response?.body && typeof response.body.cancel === "function") {
    await response.body.cancel().catch(() => { });
  }
}

async function fetchWithRedirectPolicy(value, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("Global fetch is unavailable. Node 18+ is required.");
  }

  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  let currentUrl = validateAllowedUrl(value).toString();
  const requestOptions = { ...options };
  delete requestOptions.fetchImpl;
  delete requestOptions.maxRedirects;
  requestOptions.redirect = "manual";

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetchImpl(currentUrl, requestOptions);
    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers?.get?.("location");
    await cancelResponseBody(response);
    if (!location) {
      throw new Error(`Blocked network redirect: ${currentUrl} did not provide a location.`);
    }
    if (redirectCount >= maxRedirects) {
      throw new Error(`Blocked network redirect: more than ${maxRedirects} redirects.`);
    }
    currentUrl = validateAllowedUrl(new URL(location, currentUrl).toString()).toString();
  }

  throw new Error("Blocked network redirect: redirect policy exhausted.");
}

async function validateUrlRedirects(value, options = {}) {
  const response = await fetchWithRedirectPolicy(value, {
    fetchImpl: options.fetchImpl,
    method: options.method || "HEAD",
    headers: options.headers,
    signal: options.signal,
    maxRedirects: options.maxRedirects,
  });
  await cancelResponseBody(response);
  return true;
}

module.exports = {
  ALLOWED_CDN_SUFFIXES,
  ALLOWED_HOSTS,
  MAX_REDIRECTS,
  fetchWithRedirectPolicy,
  isPrivateIp,
  isAllowedTikTokHost,
  validateAllowedUrl,
  validateUrlRedirects,
};
