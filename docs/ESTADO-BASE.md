# Estado base de AutoSocial+

Auditoría realizada el 2026-10-19.

## Entorno

- Node.js: `v24.20.0` (cumple el requisito `>=18`).
- npm: `11.19.0`.
- FFmpeg: `8.0`, disponible en `PATH`.
- ffprobe: `8.0`, disponible en `PATH`.
- Playwright Chromium: instalado correctamente mediante `npx playwright install chromium`.
- Chromium instalado: Playwright `v1208`, Chrome for Testing `145.0.7632.6`.

## Versión del clon

- Rama de trabajo: `feature/autosocial-plus`.
- Commit base exacto: `6deb560ee58ea1e6a040e1ee8e6ca269bd1576b5`.

## Comprobaciones

- `npm run doctor`: OK.
- `npm run check`: OK.
- `npm run check:syntax`: `Syntax OK (43 files)`.
- Tests: `22` pasaron, `0` fallaron.
- Dashboard: `npm run dashboard` respondió `HTTP 200` en `http://127.0.0.1:3000` y fue detenido después de la verificación.

## Rutas detectadas

### Colas

- `queue/default/instagram/pending`
- `queue/default/instagram/posted`
- `queue/default/instagram/failed`
- `queue/default/tiktok/pending`
- `queue/default/tiktok/posted`
- `queue/default/tiktok/failed`
- `queue/default/youtube/pending`
- `queue/default/youtube/posted`
- `queue/default/youtube/failed`
- `queue/uniquify-input`
- `queue/uniquify-output`

### Perfiles persistentes

- `.profiles/default/instagram`
- `.profiles/default/tiktok`
- `.profiles/default/youtube`

## Warnings

- `yt-dlp` es opcional y no está instalado: el doctor recomienda añadir `autodownload/yt-dlp.exe` para habilitar las funciones de descarga automática.
- No se detectaron otros warnings del entorno base.

## Fase 4 - Stealth y proxy

- `npm run stealth-check` ejecuto un contexto persistente de la cuenta `default` sin login y genero `docs/stealth-check.png`.
- El init script aplica webdriver, idiomas, timezone, plugins basicos y ruido determinista leve de canvas/WebGL por cuenta.
- El campo opcional `proxy` de `accounts-state.json` acepta URLs como `http://user:pass@host:port` y se transforma a la configuracion de proxy de Playwright.
- Launch de proxy de prueba verificado el 2026-10-19 con `HEADLESS=true npm run stealth-check -- --proxy http://127.0.0.1:9`: el contexto persistente inicio correctamente; la navegacion devolvio `ERR_PROXY_CONNECTION_FAILED` porque el puerto es intencionalmente ficticio.
- La cuenta local `default` no tiene proxy configurado actualmente.
