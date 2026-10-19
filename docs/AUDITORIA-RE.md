# Auditoría de cierre — AutoSocial+

**Fecha:** 2026-10-19 (America/New_York)  
**Alcance:** segunda ronda de verificación de `docs/AUDITORIA.md`. Auditoría de solo lectura; no se modificó código de producto.  
**Criterio:** un ítem solo se considera `CERRADO` cuando el criterio objetivo y el intento de evasión pasan.

## R1. Seguridad

| ÍTEM | ESTADO | EVIDENCIA (archivo:línea + salida de comando) | OBSERVACIONES |
|---|---|---|---|
| 1. Allowlist en descargadores | **CERRADO** | `src/net-policy.js:69-89` usa `new URL()`, protocolo restringido, credenciales prohibidas, `net.isIP()` y coincidencia exacta de `www.tiktok.com` más sufijos CDN explícitos. `src/profile-download-controller.js:49-53,88-89`, `src/autodownload-controller.js:190-195,226-228` y `src/tiktok-slideshow-downloader.js:264-269` aplican la política. | Evasiones ejecutadas: `https://www.tiktok.com.evil.io/@x`, `https://evil-tiktok.com/@x` y las IP `2130706433`, `0x7f000001`, `017700000001`; también `localhost`, loopback, RFC1918, link-local y `::1`. Todas fueron bloqueadas. La salida real incluyó: `BLOCKED https://www.tiktok.com.evil.io/@x :: ... host www.tiktok.com.evil.io is not allowlisted.`, `BLOCKED http://2130706433/ :: ... private or loopback address 127.0.0.1.` y `BLOCKED http://169.254.169.254/ :: ... private or loopback address 169.254.169.254.` |
| 2. Redirecciones validadas | **CERRADO** | `src/net-policy.js:98-128` fuerza `redirect: "manual"`, valida el destino con `validateAllowedUrl()` en cada salto y limita a cinco. `src/tiktok-slideshow-downloader.js:320-329,364-370` usa `fetchWithRedirectPolicy()`. | La cadena simulada `www.tiktok.com/start → cdn.tiktokcdn.com/legit → evil-tiktok.com/final` terminó en `REDIRECT_BLOCKED calls=["https://www.tiktok.com/start","https://cdn.tiktokcdn.com/legit"] :: Blocked network URL: host evil-tiktok.com is not allowlisted.` No existe `redirect: "follow"` en el código de descarga. |
| 3. Dashboard sin recursos externos | **CERRADO** | `src/dashboard-server.js:238-244` sirve CSP con `default-src 'self'`, `script-src 'self'`, `font-src 'self'` y `connect-src 'self'`. `web/assets/` contiene `Phosphor.woff2`, `phosphor.css`, `fonts.css` y fuentes locales. | `rg -n -i 'unpkg|googleapis|https?://|localStorage|sessionStorage' web` no devolvió coincidencias. Los scripts se cargan como archivos locales; por tanto, un `<script>` inline inyectado queda bloqueado por `script-src 'self'` (aunque `style-src 'unsafe-inline'` sigue permitiendo estilos inline). |
| 4. Dashboard no filtra credenciales | **CERRADO** | `src/dashboard-server.js:184-201` protege todos los paths `/api/`, incluidos GET/HEAD/OPTIONS, con `DASHBOARD_TOKEN`; `:126-163` redacta proxies como `user:***@host:puerto`; `:447-476` usa `serializeAccountsResponse()` en cuentas. `/api/status`, `/api/sessions/health`, `/api/overview`, `/api/setup/health`, `/api/uniquifier/status`, `/api/autodownload/status` y `/api/profile-download/status` están bajo el mismo middleware (`:256-273,693-706,730-806`). | La revisión de todas las rutas `app.get/post` no encontró una serialización directa de `accounts-state.json` sin pasar por la redacción. La evasión con `http://user:secret-pass@proxy.us.example:8080` devolvió `http://user:***@proxy.us.example:8080`; el test también comprobó que no aparece `pass`. `src/dashboard-server.js:109-123` exige `CONFIRM_REMOTE_RISK=true` si se habilita `DASHBOARD_ALLOW_REMOTE`. |
| 5. `stealth-check` aislado | **NO CERRADO** | `scripts/stealth-check.js:29-35` obtiene la cuenta activa, `getAccountProxy()` y `getPlatformProfileDir()`; `:46-54` lanza `chromium.launchPersistentContext(profileDir, { proxy })`; `:60` navega a `https://bot.sannysoft.com`. | El script no se importa desde el runtime principal, pero el criterio exige que use un perfil temporal desechable y no reutilice proxy de cuenta. Actualmente puede abrir cookies/sesión de producción y usar su proxy. |
| 6. Dependencias | **CERRADO** | `npm audit` terminó con `found 0 vulnerabilities`. El `git diff origin/main -- package-lock.json` muestra únicamente actualizaciones transitivas, incluyendo `proxy-addr 2.0.7 → 2.0.8`, `body-parser 2.2.2 → 2.3.0`, `qs 6.15.2 → 6.16.1` y dependencias relacionadas. `package.json` no añadió dependencias, solo scripts de fases. | No existe `upstream`; `origin/main` es la referencia disponible. El árbol está limpio para audit y no se introdujeron dependencias nuevas no relacionadas. |

## B. Inventario completo de red

Se inspeccionaron `fetch`, `page.goto`, `http/https`, notificadores y configuración. Los dominios o destinos contactables encontrados son:

- `www.tiktok.com`: URLs de subida y entrada; también destino inicial de descargadores.
- `*.tiktokcdn.com`, `*.ibytedtos.com`, `*.muscdn.com`: sufijos permitidos por `src/net-policy.js:8-12` para redirecciones/CDN.
- `www.instagram.com`: subida de Reels en `src/instagram-uploader.js:106` y URL configurable en `src/config.js:102-103`.
- `studio.youtube.com`: subida/Studio en `src/youtube-uploader.js:39,74` y `src/config.js:104-105`.
- `api.telegram.org`: API Telegram en `src/notifier.js:182-200`; se construye con el token configurado.
- Host arbitrario de `NOTIFY_DISCORD_WEBHOOK_URL`: webhook Discord en `src/notifier.js:211-235`; no hay dominio fijo porque lo aporta el operador.
- Hosts arbitrarios de `TIKTOK_UPLOAD_URL`, `INSTAGRAM_UPLOAD_URL` y `YOUTUBE_UPLOAD_URL`: son overrides de configuración en `src/config.js:100-105` y pueden apuntar fuera de los defaults.
- `bot.sannysoft.com`: solo `scripts/stealth-check.js:60`, herramienta manual de verificación; no es una dependencia del flujo de publicación.
- `127.0.0.1`/`localhost` y `http://${config.dashboardHost}:${config.dashboardPort}`: superficie local del dashboard en `src/dashboard-server.js:834`; no es salida externa.
- `github.com`, `registry.npmjs.org`, `ffmpeg.org` y `opencollective.com`: referencias de metadata/documentación/lockfile o mensaje de ayuda, no llamadas de publicación en runtime.
- `discord.test` y URLs de prueba similares: aparecen únicamente en tests.

No quedan referencias a `unpkg.com` ni `fonts.googleapis.com` en `web/`. `bot.sannysoft.com` sigue existiendo deliberadamente en la herramienta manual, por lo que la condición de regresión D no queda limpia bajo el criterio literal “mismo inventario menos ... sannysoft”.

## R2. Robustez operativa

| ÍTEM | ESTADO | EVIDENCIA (archivo:línea + salida de comando) | OBSERVACIONES |
|---|---|---|---|
| 7. Fallback de metadatos | **CERRADO** | `src/meta-loader.js:119-140` captura `SyntaxError`, emite warning con `new Date().toISOString()` y normaliza `{}` usando el caption legacy leído antes. `src/__tests__/meta-loader.test.js` y `src/__tests__/resilience.test.js:89-113` prueban JSON `{{{{` y caption desde `.txt`. | El caso corrupto conserva el video procesable, usa `Legacy caption used` y no aborta el tick. `npm test` pasó todos los tests. |
| 8. Lock de idempotencia recuperable | **CERRADO** | `src/exclusive-lock.js:46-79` crea con `fs.open(lockPath, "wx")` y persiste `pid`, `host`, `acquiredAt`; `:31-44` considera TTL y `process.kill(pid, 0)`; `src/idempotency.js:111-145` convierte un lock stale a `uncertain`, mueve el lock a revisión y notifica. | Se probaron lock fresco con PID vivo (se conserva), lock antiguo/PID inexistente (se recupera a `uncertain` con alerta) y claims concurrentes. `src/__tests__/resilience.test.js:14-61` cubre los dos primeros; los tests de concurrencia de idempotencia cubren que no haya doble claim. |
| 9. Reconciliación de `in-progress` al arrancar | **PARCIAL** | `src/idempotency.js:149-195` recorre todos los hashes `in-progress`, los cambia a `uncertain` y notifica. `src/post-finalizer.js:17-19,61-63` lo llama antes de publicar; `src/post-service.js:47-54`, `src/instagram-post-service.js:46-53` y `src/youtube-post-service.js:46-53` lo llaman al inicio de cada tick de cola. `src/post-finalizer.js:65-72` impide reclamar un hash ya registrado. | Hay reconciliación antes del siguiente post y `uncertain` no vuelve a publicarse automáticamente, pero no existe un sweep en el constructor/start del proceso antes de cualquier otro trabajo del daemon. No cumple literalmente “al arrancar”; una ventana de arranque entre tareas y el primer tick queda sin garantía explícita. |
| 10. Cuotas serializadas | **PARCIAL** | `src/limits.js:82-105` usa el mismo `acquireExclusiveLock(..., { staleLockMs })` y recuperación TTL que idempotencia; `:119-148` serializa `reserve()` y `release()`. `src/__tests__/resilience.test.js:63-75` ejecuta ocho reservas concurrentes con cap 2 y obtiene exactamente dos éxitos. | El código satisface el lock, pero el criterio pide un test con `DAILY_CAP=1` y exactamente dos reservas simultáneas con un éxito. Ese caso objetivo no está presente; el test existente no cierra la evidencia literal. |
| 11. Confirmación estricta | **PARCIAL** | `src/platform-ui-labels.js:28-29` separa `youtubePublished` de `youtubeProcessing`; `src/youtube-uploader.js:359-378` prioriza processing y `:398-407` devuelve `status: "uncertain"`; `src/post-finalizer.js:121-139` mueve uncertain a `posted-uncertain` y notifica. `src/instagram-uploader.js:311-333` y `src/tiktok-uploader.js:1080-1113` usan texto de UI y navegación. | YouTube queda cerrado para `processing`, como demuestra `src/__tests__/resilience.test.js:77-87`. Persisten dos falsos positivos posibles: un body de TikTok que contenga `Posted` coincide con `tiktokPublished` y se trata como éxito (`src/tiktok-uploader.js:1084-1088`); un body de Instagram que contenga `Shared` o `Posted` coincide con `posted` y se trata como éxito (`src/instagram-uploader.js:315-317`). Un cambio de URL aislado sí se marca `uncertain`, pero esos textos genéricos no. |
| 12. Copias atómicas del orquestador | **CERRADO** | `src/orchestrator.js:132-157` calcula tamaño/hash del origen, copia a `.tmp`, verifica tamaño/hash y hace `fs.rename()` atómico. `:228-245` procesa cada plataforma en su propio `try/catch`, conserva las exitosas y falla solo las pendientes; `:248-258` mueve el original únicamente cuando las tres terminan. | La prueba de truncamiento/copia fallida pasa y el test del orquestador demuestra que las plataformas no fallidas no se repiten como fallo lógico. |
| 13. Kill-switch dinámico | **CERRADO** | `src/kill-switch.js:1-32` relee `.env` cuando cambia su mtime/tamaño. `src/scheduler.js:232-237,293-301`, `src/orchestrator.js:265-271` y los controladores `src/daemon-controller.js:169-170,239`, `src/instagram-daemon-controller.js:161-162,223` y `src/youtube-daemon-controller.js:161-162,223` lo consultan por tick. | `src/__tests__/kill-switch.test.js` cambia el archivo mientras un daemon está vivo y verifica que el siguiente `runOnce()` pausa/detiene. Scheduler y orquestador también tienen guard explícito. |
| 14. Higiene y upstream | **PARCIAL** | `.gitignore:55-61` cubre `docs/*.png`, `docs/pilot-report-*.log`, `queue/` y `*.tmp`. `src/__tests__/resilience.test.js:142-147` rechaza `password|captcha` en los tres uploaders. `git remote -v` solo mostró `origin https://github.com/Katzca/AutoSocial`; `git diff upstream/main --stat` terminó con `fatal: ambiguous argument 'upstream/main'`. | La higiene local y el guardián estático están cerrados. No hay `upstream`, por lo que no se puede ejecutar el diff requerido contra `upstream/main`, ni producir un diff que incluya no-rastreados. |

## E. Salud y regresión

### A. Tests y check

Salida real relevante de `npm run check`:

```text
Syntax OK (70 files).
ℹ tests 69
ℹ suites 0
ℹ pass 69
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2250.520458
```

Salida real de `npm test`:

```text
ℹ tests 69
ℹ suites 0
ℹ pass 69
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1854.743125
```

Los tests de regresión cubren metadata corrupta, lock fresco/huérfano, concurrencia de límites, YouTube `processing`, posted-uncertain, kill-switch dinámico, allowlist/redirects, redacción de proxy, CSP/recursos locales y contrato de login manual. No se observó un test exacto de cuota `cap=1` con dos reservas ni un sweep de arranque independiente; esos huecos corresponden a los ítems 9 y 10.

### B. Categorías previamente limpias

- `src/config.js:87` mantiene `HEADLESS` por defecto en `false`.
- Los tres uploaders conservan `waitForTimeout` y retardos de tipeo; la búsqueda mostró esperas y `delay` existentes.
- `rg -n -i 'password|captcha' src/tiktok-uploader.js src/instagram-uploader.js src/youtube-uploader.js` devolvió `clean`/sin coincidencias.
- `rg -n 'eval\\(|new Function|child_process|execFile|spawn\\(' src scripts web` solo encontró `spawnSync` de herramientas, `execFile` con argumentos construidos internamente para `yt-dlp`/`ffmpeg` y apertura de carpetas con rutas locales; no hay `eval`, `new Function` ni input de usuario pasado como código.

**Resultado B:** limpio.

### C. Commits entre auditorías y alcance

`git log --oneline --decorate -8` terminó en:

```text
6deb560 (HEAD -> feature/autosocial-plus, origin/main, origin/HEAD, main) Ignore QA screenshot artifacts
d4f5b41 Add first-run setup health dashboard
e084ec2 Add debug artifact cleanup command
623791a Improve TikTok publish confirmation tracking
40424b1 Guard TikTok secondary publish confirmation
fa70dab Fix TikTok publish button targeting
4771789 Prepare AutoSocial for open source
```

No hay commits de fix posteriores a la primera auditoría: los cambios de remediación están sin commit. Por ello no existe un conjunto de diffs de commits de fix que revisar ni puede demostrarse por historial que cada fix respete el alcance. El estado de trabajo ya contenía cambios de las fases previas; no atribuyo esos archivos a un commit nuevo.

**Resultado C:** parcial/no concluyente por ausencia de commits de remediación, no por un archivo nuevo atribuido fuera de alcance.

### D. Superficie de red tras los fixes

El inventario de producción conserva TikTok, Instagram, YouTube y los adaptadores configurados. No aparecen `unpkg.com` ni `fonts.googleapis.com` en `web/`. Sin embargo, `scripts/stealth-check.js:60` todavía contacta `bot.sannysoft.com`; aunque es una herramienta manual y conocida, el criterio literal de regresión exige el inventario anterior “menos ... sannysoft”.

**Resultado D:** no limpio.

## Revisión de severidad por modelo de amenaza

### Máquina local de un solo operador

- Ítems 1, 2, 3, 4, 6, 7, 8, 12 y 13 tienen controles efectivos y el riesgo residual es bajo en la evidencia ejecutada.
- Ítem 5 es **MEDIO/ALTO operativo**: ejecutar `stealth-check` por error puede reutilizar cookies y proxy de producción, aunque requiere acceso local del operador.
- Ítems 9 y 10 son **ALTOS operativos** por posibles colas bloqueadas o falta de una prueba exacta de serialización en cap 1.
- Ítem 11 es **ALTO**: un texto genérico puede marcar publicado algo que no quedó confirmado.
- Ítem 14 es **MEDIO de proceso** por falta de remote `upstream` y de trazabilidad por commit.

### VPS expuesto

- Ítem 5 sube a **CRÍTICO**: una herramienta manual con perfil persistente y proxy de cuenta aumenta el impacto de una exposición del host.
- Ítems 4, 9, 10 y 11 son **ALTOS/CRÍTICOS** según exposición del token y valor de las cuentas: estado incompleto, carrera o falso positivo puede causar publicación duplicada/fantasma.
- La política de dashboard remoto requiere dos flags, pero no elimina el riesgo de configurar ambos en un VPS; la superficie no debe considerarse segura solo por ser local por defecto.

## Veredicto

# NO LISTO

No se cumplen las condiciones de `LISTO PARA PILOTO` ni de `LISTO CON CONDICIONES`.

Bloqueos que impiden el piloto:

1. **Ítem 9 — PARCIAL:** la reconciliación ocurre al inicio de cada tick de publicación, no como sweep garantizado de arranque.
2. **Ítem 10 — PARCIAL:** falta la prueba exigida de `DAILY_CAP=1` con dos reservas simultáneas y exactamente un éxito.
3. **Ítem 11 — PARCIAL:** TikTok e Instagram aún aceptan textos genéricos (`Posted`/`Shared`) como confirmación positiva.
4. **Ítem 5 — NO CERRADO:** `stealth-check` usa perfil persistente y proxy de cuenta, además de contactar `bot.sannysoft.com`.
5. **Ítem 14 — PARCIAL:** no existe `upstream`, por lo que no puede verificarse el diff requerido con no-rastreados.
6. **Regresión D — no limpia:** permanece `bot.sannysoft.com` en el inventario.

Hasta cerrar 9, 10 y 11 —y aislar 5— no debe ejecutarse un piloto con cuentas reales.
