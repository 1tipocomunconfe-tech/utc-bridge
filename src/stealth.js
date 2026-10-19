const crypto = require("crypto");
const { config } = require("./config");

function getStealthSeed(accountId) {
  return crypto
    .createHash("sha256")
    .update(String(accountId || "default"))
    .digest()
    .readUInt32BE(0);
}

function normalizeLocaleLanguages(locale) {
  const normalized = String(locale || "en-US").replace("_", "-");
  const base = normalized.split("-")[0];
  return Array.from(new Set([normalized, base]));
}

async function initStealth(context, options = {}) {
  const accountId = options.accountId || "default";
  const locale = options.locale || config.browserLocale;
  const timezone = options.timezone || config.timezone;
  const seed = options.seed ?? getStealthSeed(accountId);
  const languages = normalizeLocaleLanguages(locale);

  await context.addInitScript(
    ({ seed: initSeed, locale: initLocale, timezone: initTimezone, languages: initLanguages }) => {
      const noise = (initSeed % 3) + 1;
      const navigatorPrototype = Object.getPrototypeOf(navigator);

      try {
        Object.defineProperty(navigatorPrototype, "webdriver", {
          configurable: true,
          get: () => undefined,
        });
      } catch {
        // Some browser versions expose this property as non-configurable.
      }

      try {
        Object.defineProperty(navigatorPrototype, "language", {
          configurable: true,
          get: () => initLocale,
        });
        Object.defineProperty(navigatorPrototype, "languages", {
          configurable: true,
          get: () => [...initLanguages],
        });
      } catch {
        // Keep the browser defaults if the property cannot be patched safely.
      }

      try {
        const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
        Intl.DateTimeFormat.prototype.resolvedOptions = function resolvedOptions() {
          return { ...originalResolvedOptions.call(this), timeZone: initTimezone };
        };
      } catch {
        // The context timezoneId remains the source of truth.
      }

      try {
        if (!navigator.plugins || navigator.plugins.length === 0) {
          const fallbackPlugins = {
            0: {
              description: "Portable Document Format",
              filename: "internal-pdf-viewer",
              name: "Chrome PDF Plugin",
            },
            length: 1,
            item(index) {
              return index === 0 ? this[0] : null;
            },
            namedItem(name) {
              return name === this[0].name ? this[0] : null;
            },
          };
          Object.defineProperty(navigatorPrototype, "plugins", {
            configurable: true,
            get: () => fallbackPlugins,
          });
        }
      } catch {
        // Do not interfere with a native PluginArray implementation.
      }

      try {
        const canvasPrototype = HTMLCanvasElement.prototype;
        const originalToDataURL = canvasPrototype.toDataURL;
        canvasPrototype.toDataURL = function toDataURL(...args) {
          try {
            if (this.width > 0 && this.height > 0) {
              const context2d = this.getContext("2d");
              if (context2d) {
                const pixel = context2d.getImageData(0, 0, 1, 1);
                pixel.data[0] = (pixel.data[0] + noise) % 256;
                context2d.putImageData(pixel, 0, 0);
              }
            }
          } catch {
            // Keep the native canvas behavior if the page disallows pixel access.
          }
          return originalToDataURL.apply(this, args);
        };
      } catch {
        // Canvas is not available in every document context.
      }

      for (const webglPrototype of [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype]) {
        if (!webglPrototype) {
          continue;
        }
        try {
          const originalReadPixels = webglPrototype.readPixels;
          webglPrototype.readPixels = function readPixels(...args) {
            const result = originalReadPixels.apply(this, args);
            const pixels = args[6];
            if (pixels && typeof pixels.length === "number" && pixels.length > 0) {
              pixels[0] = (pixels[0] + noise) % 256;
            }
            return result;
          };
        } catch {
          // Keep the native WebGL implementation if it cannot be patched.
        }
      }
    },
    { seed, locale, timezone, languages }
  );
}

module.exports = {
  getStealthSeed,
  initStealth,
  normalizeLocaleLanguages,
};
