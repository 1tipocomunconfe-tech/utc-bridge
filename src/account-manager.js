const fs = require("fs/promises");
const path = require("path");
const { config } = require("./config");

const STATE_FILE = path.resolve(config.projectRoot, "accounts-state.json");
const DEFAULT_ACCOUNT = { id: "default", name: "Default" };
const LEGACY_PROFILE_DIRS = {
  tiktok: config.profileDir,
  instagram: config.instagramProfileDir,
  youtube: config.youtubeProfileDir,
};

let state = {
  activeAccountId: DEFAULT_ACCOUNT.id,
  accounts: [DEFAULT_ACCOUNT],
};
let loaded = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseProxy(proxyValue) {
  const value = String(proxyValue || "").trim();
  if (!value) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error("Proxy must be a valid URL such as http://user:pass@host:port.");
  }

  if (!["http:", "https:", "socks5:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error("Proxy protocol must be http, https or socks5 and include a hostname.");
  }

  const proxy = {
    server: `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`,
  };
  if (parsed.username) {
    proxy.username = decodeURIComponent(parsed.username);
  }
  if (parsed.password) {
    proxy.password = decodeURIComponent(parsed.password);
  }
  return proxy;
}

function inferCountryFromTimezone(timezone) {
  const normalized = String(timezone || "").toLowerCase();
  const matches = [
    [/america\/(new_york|detroit|chicago|denver|los_angeles|phoenix)/, "US"],
    [/america\/(toronto|vancouver|winnipeg|edmonton)/, "CA"],
    [/america\/(mexico_city|tijuana|monterrey)/, "MX"],
    [/america\/sao_paulo/, "BR"],
    [/america\/argentina/, "AR"],
    [/europe\/madrid|atlantic\/canary/, "ES"],
    [/europe\/lisbon|atlantic\/azores/, "PT"],
    [/europe\/london/, "GB"],
    [/europe\/berlin/, "DE"],
    [/europe\/paris/, "FR"],
    [/europe\/rome/, "IT"],
    [/asia\/tokyo/, "JP"],
    [/australia\//, "AU"],
  ];
  return matches.find(([pattern]) => pattern.test(normalized))?.[1] || null;
}

function inferCountryFromLocale(locale) {
  const match = /[-_]([a-z]{2})$/i.exec(String(locale || ""));
  return match ? match[1].toUpperCase() : null;
}

function inferCountryFromProxy(proxyValue) {
  const value = String(proxyValue || "").trim();
  if (!value) {
    return null;
  }
  const hostname = new URL(value).hostname.toLowerCase();
  const labels = hostname.split(".");
  const countryCodes = new Set([
    "ar", "au", "br", "ca", "cl", "co", "de", "es", "fr", "gb", "it", "jp", "mx", "pe", "pt", "us",
  ]);
  const countryLabel = [...labels].reverse().find((label) => countryCodes.has(label));
  return countryLabel ? countryLabel.toUpperCase() : null;
}

function getProxyGeographyWarning(proxyValue, options = {}) {
  if (!proxyValue) {
    return null;
  }
  const proxyCountry = inferCountryFromProxy(proxyValue);
  const locale = options.locale || config.browserLocale;
  const timezone = options.timezone || config.timezone;
  const expectedCountries = [inferCountryFromLocale(locale), inferCountryFromTimezone(timezone)].filter(Boolean);
  if (!proxyCountry || expectedCountries.length === 0 || expectedCountries.every((country) => country === proxyCountry)) {
    return null;
  }
  return `Proxy country ${proxyCountry} differs from browser geography (expected ${expectedCountries.join("/")}, TZ=${timezone}, locale=${locale}).`;
}

function normalizeState(raw) {
  const accounts = Array.isArray(raw?.accounts)
    ? raw.accounts
      .filter((item) => item && typeof item.id === "string" && typeof item.name === "string")
      .map((item) => ({
        id: item.id,
        name: item.name,
        ...(typeof item.proxy === "string" && item.proxy.trim() ? { proxy: item.proxy.trim() } : {}),
      }))
    : [];
  if (!accounts.length) {
    accounts.push({ ...DEFAULT_ACCOUNT });
  }

  const activeExists = accounts.some((item) => item.id === raw?.activeAccountId);
  const activeAccountId = activeExists ? raw.activeAccountId : accounts[0].id;
  return { accounts, activeAccountId };
}

function sanitizeName(name) {
  return (name || "").toString().trim().replace(/\s+/g, " ").slice(0, 60);
}

function makeId(name) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "account";
}

function ensureUniqueId(baseId, existing) {
  if (!existing.has(baseId)) return baseId;
  let index = 2;
  while (existing.has(`${baseId}-${index}`)) {
    index += 1;
  }
  return `${baseId}-${index}`;
}

async function saveState() {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

async function ensureLoaded() {
  if (loaded) return;
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    state = normalizeState(JSON.parse(raw));
  } catch {
    state = normalizeState(state);
    await saveState();
  }
  loaded = true;
}

async function getState() {
  await ensureLoaded();
  return clone(state);
}

// Queue directory helpers

const PLATFORMS = ["tiktok", "instagram", "youtube"];
const SUBDIRS = ["pending", "posted", "failed"];

function getAccountQueueDirs(accountId) {
  const base = path.resolve(config.projectRoot, "queue", accountId);
  const dirs = {};
  for (const platform of PLATFORMS) {
    dirs[platform] = {};
    for (const sub of SUBDIRS) {
      dirs[platform][sub] = path.resolve(base, platform, sub);
    }
  }
  return dirs;
}

async function ensureAccountDirs(accountId) {
  const dirs = getAccountQueueDirs(accountId);
  const allPaths = [];
  for (const platform of PLATFORMS) {
    for (const sub of SUBDIRS) {
      allPaths.push(dirs[platform][sub]);
    }
  }
  // Also ensure browser profile dirs
  const profileBase = path.resolve(config.projectRoot, ".profiles", accountId);
  for (const platform of PLATFORMS) {
    allPaths.push(path.resolve(profileBase, platform));
  }
  await Promise.all(allPaths.map((d) => fs.mkdir(d, { recursive: true })));
  return dirs;
}

// Account CRUD

async function addAccount(name, options = {}) {
  await ensureLoaded();
  const cleanName = sanitizeName(name);
  if (!cleanName) {
    throw new Error("Account name is required.");
  }

  const existingIds = new Set(state.accounts.map((item) => item.id));
  const id = ensureUniqueId(makeId(cleanName), existingIds);
  const proxy = options.proxy ? String(options.proxy).trim() : "";
  if (proxy) {
    parseProxy(proxy);
  }
  const account = { id, name: cleanName, ...(proxy ? { proxy } : {}) };
  state.accounts.push(account);
  state.activeAccountId = account.id;
  await saveState();

  // Create queue and profile directories for the new account
  await ensureAccountDirs(id);

  return clone(account);
}

async function selectAccount(accountId) {
  await ensureLoaded();
  const target = state.accounts.find((item) => item.id === accountId);
  if (!target) {
    throw new Error("Account not found.");
  }
  state.activeAccountId = target.id;
  await saveState();
  return clone(target);
}

async function getActiveAccount() {
  await ensureLoaded();
  return clone(
    state.accounts.find((item) => item.id === state.activeAccountId) || state.accounts[0]
  );
}

async function getAllAccounts() {
  await ensureLoaded();
  return clone(state.accounts);
}

async function getAccountProxy(accountId) {
  await ensureLoaded();
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account?.proxy) {
    return undefined;
  }

  const proxy = parseProxy(account.proxy);
  const warning = getProxyGeographyWarning(account.proxy);
  if (warning) {
    console.warn(`[${new Date().toISOString()}] [account:${account.id}] WARNING ${warning}`);
  }
  return proxy;
}

async function getPlatformProfileDir(platform, accountId) {
  const acctId = accountId || (await getActiveAccount()).id;
  if (acctId === DEFAULT_ACCOUNT.id && LEGACY_PROFILE_DIRS[platform]) {
    try {
      await fs.stat(LEGACY_PROFILE_DIRS[platform]);
      return LEGACY_PROFILE_DIRS[platform];
    } catch {
      // Fall through to new path
    }
  }
  return path.resolve(config.projectRoot, ".profiles", acctId, platform);
}

async function hasSavedPlatformSession(platform, accountId) {
  const profileDir = await getPlatformProfileDir(platform, accountId);
  const cookieCandidates = [
    path.resolve(profileDir, "Default", "Cookies"),
    path.resolve(profileDir, "Cookies"),
    path.resolve(profileDir, "Network", "Cookies"),
  ];

  for (const filePath of cookieCandidates) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile() && stat.size > 0) {
        return true;
      }
    } catch {
      // continue
    }
  }

  return false;
}

module.exports = {
  getState,
  addAccount,
  selectAccount,
  getActiveAccount,
  getAllAccounts,
  getAccountQueueDirs,
  ensureAccountDirs,
  getPlatformProfileDir,
  getAccountProxy,
  getProxyGeographyWarning,
  inferCountryFromProxy,
  parseProxy,
  hasSavedPlatformSession,
  PLATFORMS,
};
