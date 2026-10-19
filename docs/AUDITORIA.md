# Auditoría de AutoSocial+

**Fecha:** 2026-10-19  
**Alcance:** fases 1–8, rama `feature/autosocial-plus`, commit base `6deb560ee58ea1e6a040e1ee8e6ca269bd1576b5`  
**Rol:** auditoría de seguridad, automatización de navegador, integridad de colas y operación.

La auditoría fue solo de lectura. No se modificó código existente ni se ejecutaron logins, captchas o publicaciones adicionales.

## Resumen de severidad

- 🔴 **CRÍTICO:** 6 hallazgos.
- 🟠 **ALTO:** 7 hallazgos.
- 🟡 **MEDIO:** 6 hallazgos.
- 🔵 **BAJO:** 6 observaciones.

El recuento anterior era inconsistente con el contenido. Esta versión identifica cada observación por su severidad y cubre explícitamente todos los puntos D/E solicitados.

## A. Seguridad de secretos y datos

### 🔴 CRÍTICO — Dashboard remoto puede exponer credenciales de proxy

- **Archivo:línea:** `src/config.js:105-108`, `src/dashboard-server.js:109-117,393-397`, `src/account-manager.js:112,212-216`.
- **Evidencia:** el dashboard escucha en `127.0.0.1` por defecto, pero `DASHBOARD_ALLOW_REMOTE=true` permite cualquier host no loopback. `/api/accounts` devuelve el estado completo; el estado de cuenta conserva `proxy`, que puede contener `user:pass@host:puerto`.
- **Riesgo real:** un proceso o usuario remoto puede obtener credenciales de proxy y datos operativos si se habilita esa variable. La ruta GET no requiere `DASHBOARD_TOKEN`.
- **Corrección sugerida:** eliminar el bypass remoto o exigir autenticación fuerte antes de permitirlo; devolver siempre un estado de cuentas redactado, sin password/token/proxy completo. Mantener el bind loopback como única configuración de producción local.

### 🟠 ALTO — URLs sensibles en logs

- **Archivo:línea:** `src/tiktok-uploader.js:981-987`, `src/profile-download-controller.js:70`, `src/autodownload-controller.js:159,240`.
- **Evidencia:** se registran URLs completas de respuestas o canales proporcionados por el usuario.
- **Riesgo real:** una URL puede incluir query strings firmadas, credenciales embebidas o identificadores de sesión; esos valores quedarían en logs persistentes.
- **Corrección sugerida:** registrar únicamente origen, pathname y un identificador redactado; eliminar query/hash y sanitizar URLs antes de loguearlas.

### 🔵 BAJO — Exclusión de secretos correcta, pero sin protección de historial futuro

- **Archivo:línea:** `.gitignore:5,11,14-15`.
- **Evidencia:** `.env`, `.profiles/`, `.scheduler-state/`, `*-state.json` y `accounts-state.json` están ignorados. `git ls-files` no encontró `.env`, perfiles, cookies, `accounts-state.json`, claves privadas ni tokens. `git log --all --diff-filter=A --oneline -- .env .profiles '*accounts-state*'` no produjo salida.
- **Riesgo real:** bajo actualmente; una inclusión forzada (`git add -f`) o un cambio de patrón puede volver a exponer cookies y sesiones.
- **Corrección sugerida:** añadir un pre-commit/CI secret scan y revisar que los backups/exportaciones tampoco se incorporen al repositorio.

## B. Superficie de red

### 🔴 CRÍTICO — Descargas con destino de red controlado por entrada externa

- **Archivo:línea:** `src/profile-download-controller.js:47-51,65,115`, `src/autodownload-controller.js:186-188,238-242`.
- **Evidencia:** cualquier cadena que empiece por `http` se acepta como canal y se pasa a `yt-dlp`; no se valida que el host sea TikTok.
- **Riesgo real:** el proceso puede realizar llamadas salientes a dominios arbitrarios, descargar contenido no previsto o alcanzar servicios internos mediante URLs controladas por el usuario. Incumple la política de dominios permitidos.
- **Corrección sugerida:** parsear con `URL`, permitir únicamente `www.tiktok.com` y subdominios explícitos necesarios, rechazar IPs privadas/loopback y validar redirecciones antes de continuar.

### 🔴 CRÍTICO — `tiktok-slideshow-downloader` sigue redirecciones hacia hosts no permitidos

- **Archivo:línea:** `src/tiktok-slideshow-downloader.js:263-265,317-329,366-377`.
- **Evidencia:** la validación solo busca la subcadena `tiktok.com`; `fetchText` y `downloadImage` usan `redirect: "follow"` y descargan URLs extraídas del JSON.
- **Riesgo real:** `evil-tiktok.com`, un CDN no aprobado o una redirección pueden producir llamadas a dominios desconocidos y potencialmente a una red privada.
- **Corrección sugerida:** usar una allowlist exacta de hosts TikTok/CDN aprobados, bloquear IPs privadas, desactivar redirecciones automáticas o validar cada salto y limitar tamaño/tipo de respuesta.

### 🔴 CRÍTICO — Herramienta de stealth navega a un dominio de terceros no permitido

- **Archivo:línea:** `scripts/stealth-check.js:60`.
- **Evidencia:** navega a `https://bot.sannysoft.com`, que no pertenece a TikTok, Instagram, YouTube ni a los notificadores configurados.
- **Riesgo real:** fuga de metadatos del perfil/navegador a un tercero; además incumple la allowlist de red para el sistema.
- **Corrección sugerida:** eliminarlo del flujo operativo o aislarlo como diagnóstico manual explícito, con consentimiento, documentación y allowlist separada de producción.

### 🔴 CRÍTICO — `unpkg.com` ejecuta JavaScript externo dentro del dashboard

- **Archivo:línea:** `web/index.html:13`.
- **Evidencia:** el dashboard carga `https://unpkg.com/@phosphor-icons/web` como script ejecutable. No es un dominio de una plataforma ni un notificador configurado.
- **Riesgo real:** el script corre con el mismo origen del dashboard y puede leer el token guardado en `localStorage`, llamar rutas mutadoras y extraer estado operativo.
- **Corrección sugerida:** servir el paquete localmente o eliminarlo; añadir CSP con nonce/hash y no guardar el token en `localStorage`.

### 🟠 ALTO — `stealth-check` usa el perfil persistente de producción

- **Archivo:línea:** `scripts/stealth-check.js:29-35,46-54`.
- **Evidencia:** obtiene la cuenta activa, calcula `getPlatformProfileDir(platform, accountId)` y llama `chromium.launchPersistentContext(profileDir, ...)`; no crea un directorio temporal. El proxy de la cuenta también se reutiliza.
- **Riesgo real:** una verificación diagnóstica puede modificar cookies/local storage del perfil de producción y expone la huella operativa a `bot.sannysoft.com`. En una cuenta remota, el diagnóstico puede afectar la sesión real.
- **Corrección sugerida:** usar un perfil desechable clonado sin cookies o exigir un flag de consentimiento inequívoco; nunca reutilizar el perfil productivo para diagnósticos externos.

### 🟠 ALTO — Hoja de estilos externa en el dashboard

- **Archivo:línea:** `web/index.html:10`, `web/app.js:1-26`.
- **Evidencia:** Google Fonts se carga desde `fonts.googleapis.com`; el token se conserva en `localStorage` y se usa para llamadas mutadoras.
- **Riesgo real:** el tercero recibe metadatos de navegación y el recurso externo añade una dependencia fuera de la allowlist. El riesgo directo de leer el token corresponde al script `unpkg.com`, reportado por separado como 🔴.
- **Corrección sugerida:** servir estilos localmente, no guardar el token en `localStorage` y añadir CSP estricta.

### 🟡 MEDIO — Apertura de carpetas acepta rutas arbitrarias

- **Archivo:línea:** `src/dashboard-server.js:49-62` y endpoint `POST /api/uniquifier/open-folder`.
- **Evidencia:** se usan argumentos separados con `spawn`, por lo que no se observó shell injection, pero el path recibido puede abrir una ubicación local arbitraria.
- **Riesgo real:** exposición de rutas, documentos o recursos montados al usuario que controla el dashboard.
- **Corrección sugerida:** restringir la ruta a directorios de trabajo permitidos y rechazar rutas absolutas externas, enlaces simbólicos y recursos remotos.

### 🔵 BAJO — No se encontró `eval` ni `new Function`

- **Archivo:línea:** búsqueda global del repositorio.
- **Evidencia:** no hay usos de `eval(` ni `new Function(`. Los usos de `execFile` pasan argumentos en arrays y no usan `shell: true`.
- **Riesgo real:** bajo en esta categoría; permanecen los riesgos de validación de URL descritos arriba.
- **Corrección sugerida:** mantener `execFile` sin shell y añadir tests de allowlist para toda entrada que llegue a procesos externos.

## C. Seguridad de cuenta

### 🔵 BAJO — No se observó login automatizado

- **Archivo:línea:** `src/tiktok-uploader.js:1142-1167,1190-1197`, `src/instagram-uploader.js:81-106`, `src/youtube-uploader.js:373-398`.
- **Evidencia:** los flujos abren contextos persistentes y esperan intervención humana; no rellenan password, no resuelven captchas y no automatizan 2FA.
- **Riesgo real:** no se identificó una violación en esta revisión.
- **Corrección sugerida:** conservar el contrato de login manual y añadir una prueba estática que rechace selectores de password/captcha en los uploaders.

### 🔵 BAJO — Headless y timings conservan el comportamiento esperado

- **Archivo:línea:** `src/config.js:84-88`; uploaders persistentes; pruebas de uploader existentes.
- **Evidencia:** `HEADLESS` por defecto es `false`; permanecen pausas, `waitForTimeout` y typing delays en los tres uploaders.
- **Riesgo real:** no se observó regresión en esta categoría.
- **Corrección sugerida:** documentar explícitamente que `HEADLESS=true` es una decisión operativa y mantener pruebas de configuración.

### 🔵 BAJO — Los errores de login/captcha no entran en reintentos transitorios

- **Archivo:línea:** `src/errors.js:15-19,63-72,87-105`.
- **Evidencia:** login, 2FA, captcha y selectores faltantes se clasifican como `FATAL`; `withTransientRetries` solo reintenta `TRANSIENTE`.
- **Riesgo real:** no se observó reintento indebido en el código revisado.
- **Corrección sugerida:** conservar esta precedencia y añadir una prueba de integración que compruebe que un error de login no llama dos veces a `uploadVideo`.

### 🟡 MEDIO — El kill-switch se lee al arrancar, no dinámicamente

- **Archivo:línea:** `src/kill-switch.js:3-5`, `src/config.js` (carga de configuración al inicio), `src/scheduler.js:232-236,293-301`, `src/orchestrator.js:218-225`.
- **Evidencia:** `isKillSwitchEnabled()` usa `config.killSwitch` cuando no recibe un valor explícito. Scheduler y orquestador sí se detienen en el siguiente tick si el proceso arrancó con `KILL_SWITCH=true`.
- **Riesgo real:** cambiar `.env` a `KILL_SWITCH=true` mientras el daemon está vivo no tiene efecto hasta reiniciar; puede dar una falsa sensación de parada inmediata.
- **Corrección sugerida:** releer una fuente de estado segura en cada tick o documentar/requerir reinicio como parte del procedimiento de emergencia. Añadir una prueba de integración contra los controladores reales.

## D. Correctitud de lógica

### Traza solicitada

#### 1. Idempotencia: hash, lock, Publish y move

El flujo observado es:

1. `src/post-finalizer.js:57-58` calcula `sha256` del archivo mediante `src/idempotency.js:31-34` y llama `seen.claim(accountId, platform, hash, videoPath)`.
2. `src/idempotency.js:36-46` intenta crear `.scheduler-state/seen.json.lock` con apertura exclusiva:

```js
lockHandle = await fs.open(this.lockPath, "wx");
```

3. Bajo ese lock, `src/idempotency.js:53-63` consulta el hash y escribe `status: "in-progress"` antes de devolver `claimed: true`.
4. El uploader realiza el clic Publish. Después, `src/post-finalizer.js:78-80` mueve el video/sidecar a `posted/` y marca el hash `confirmed`.
5. Si la UI no confirma, `src/post-finalizer.js:114-125` mueve a `posted-uncertain/` y marca `uncertain`; un fatal libera el hash.

Si el proceso muere **entre el clic Publish y el move**, el registro persistente queda `in-progress`. En el siguiente arranque el mismo hash no puede reclamarse, así que se evita un duplicado, pero no se sabe si la plataforma publicó. Si muere durante `claim`, el archivo `.lock` puede quedar en disco; el siguiente proceso recibe `lock-held` indefinidamente. Por tanto, la seguridad contra doble publicación es conservadora, pero la recuperación no es automática y puede bloquear la cola.

#### 2. Cuotas y cambio de día

`src/limits.js:11-19` decide el día con `Intl.DateTimeFormat(..., { timeZone: timezone })`. `src/limits.js:84-98` obtiene esa fecha, llama `_getEntry`, y `_getEntry` (`src/limits.js:65-72`) reemplaza la entrada cuando `existing.date !== date`.

La fecha viene de `options.timezone || config.timezone` (`src/limits.js:39-42`), y `config.timezone` viene de `process.env.TZ` (`src/config.js:84`). No usa la TZ del servidor para el reset. A las 23:59 en `America/New_York` conserva el contador de ese día; a las 00:01 crea el contador del nuevo día. La carrera read-modify-write entre procesos sí permanece documentada como hallazgo 🟠.

#### 3. `scheduledAt` con offset

`src/scheduler.js:151-156` hace `new Date(item.metadata.scheduledAt)` y compara `scheduledAt.getTime() > at.getTime()`. No compara strings. Para `2026-10-21T09:30:00-04:00`, JavaScript representa `2026-10-21T13:30:00.000Z`; con `TZ=America/New_York` la comparación sigue siendo el mismo instante absoluto. La ventana y cuotas usan la TZ local configurada, pero `scheduledAt` conserva su offset.

#### 4. Orquestador y fallo de una plataforma

`src/orchestrator.js:241-255` procesa cada video dentro de un `try/catch`; `src/orchestrator.js:155-215` genera los tres planes y copia secuencialmente. Si falla una plataforma, las copias ya completadas permanecen, el original no se mueve a `processed/`, y el siguiente procesamiento vuelve a evaluar las tres.

No genera duplicados nominales porque el nombre es determinista por timestamp/hash y `copyIfMissing` (`src/orchestrator.js:127-133`) no copia si el destino existe. Sí existe el riesgo de aceptar una copia parcial existente, porque no se verifica hash/tamaño; por eso la copia no atómica es 🟡.

#### 5. Sidecar corrupto

`src/meta-loader.js:123-136` hace `JSON.parse` dentro de un `try`. Solo `ENOENT` cae a `{}`; `SyntaxError` se transforma en `Error("Invalid metadata JSON...")` y se lanza. `src/queue.js` no convierte ese error en fallback al `.txt`; el controlador/scheduler lo recibe y el video queda pendiente. No hay `.error.json` ni fallback de caption para JSON corrupto. Este comportamiento es 🟠 y contradice el requisito de tolerancia.

#### 6. Kill-switch

El scheduler evalúa explícitamente `isKillSwitchEnabled()` en `src/scheduler.js:232-236` antes de publicar y en `src/scheduler.js:293-301` dentro de cada callback cron; en el segundo caso hace `task.stop()`. El orquestador evalúa `isKillSwitchEnabled(options.killSwitch)` en `src/orchestrator.js:218-225` antes de leer/copiar el inbox. Los controladores de plataforma también detienen su siguiente tick. La cobertura funcional existe, pero `config.killSwitch` se carga una sola vez; cambiar `.env` con el proceso vivo no activa el switch.

#### 7. Reintentos y login/captcha

`src/errors.js:15-19` clasifica `login`, `sign in`, `session expired`, `2fa`, `verification code`, rechazo y selector faltante como fatal. `classifyError` (`src/errors.js:74-84`) aplica esa lista antes de transitorios; `withTransientRetries` (`src/errors.js:87-105`) solo repite cuando `normalized.type === TRANSIENTE`. Un error de login/captcha no entra en los dos reintentos. Esto está correcto; falta una prueba de integración con el uploader real.

### 🟠 ALTO — Idempotencia segura contra duplicados, pero puede quedar bloqueada después de un crash

- **Archivo:línea:** `src/idempotency.js:36-69,72-89`, `src/post-finalizer.js:57-80,114-125`.
- **Evidencia:** se registra `status: "in-progress"` antes de subir y se evita reutilizar el hash. Un crash entre el clic de Publish y `complete()` deja el hash en progreso; un crash durante `claim()` puede dejar `.scheduler-state/seen.json.lock`.
- **Riesgo real:** evita el duplicado, pero puede bloquear permanentemente la publicación o dejar un video sin reconciliar. La cola no distingue automáticamente “publicado pero no archivado” de “nunca iniciado”.
- **Corrección sugerida:** añadir propietario/TTL al lock, recuperación manual explícita y estado `uncertain` al reiniciar; reconciliar UI/perfil antes de liberar o reintentar un hash en progreso. No borrar un lock activo sin comprobar proceso/edad.

### 🟠 ALTO — Cuotas con carrera entre procesos

- **Archivo:línea:** `src/limits.js:84-98`.
- **Evidencia:** `reserve()` hace read-modify-write sin lock interprocesos; dos ticks/procesos pueden leer el mismo contador y ambos incrementarlo.
- **Riesgo real:** se puede superar `DAILY_CAP_*` o perder un incremento, especialmente si hay más de un daemon o reinicios concurrentes.
- **Corrección sugerida:** usar un lock atómico para la reserva y escritura, o una operación transaccional con relectura bajo lock. Aplicar el mismo control a `release()`.

### 🟠 ALTO — Confirmación de publicación demasiado amplia, especialmente en YouTube

- **Archivo:línea:** `src/youtube-uploader.js:359-370`, `src/platform-ui-labels.js:25-28`; verificaciones equivalentes en `src/tiktok-uploader.js:1050-1127` y `src/instagram-uploader.js:311-329`.
- **Evidencia:** `youtubePublished` acepta `processing`/`verarbeitet` como confirmación positiva. TikTok e Instagram aceptan términos generales o un cambio de URL; no se observó comprobación posterior del perfil/studio.
- **Riesgo real:** “processing” no prueba que el video se haya publicado; un cambio de pantalla o texto genérico puede marcar `posted` incorrectamente. El requisito de verificación en perfil/studio no queda cubierto.
- **Corrección sugerida:** exigir estado final explícito, URL/ID de video o elemento del perfil/studio; tratar `processing` como `posted-uncertain` y notificar revisión humana.

### 🟠 ALTO — `.meta.json` inválido no hace fallback al `.txt`

- **Archivo:línea:** `src/meta-loader.js:119-136`, integración en `src/queue.js`.
- **Evidencia:** un `SyntaxError` se transforma en `Error("Invalid metadata JSON...")`; no se devuelve el caption legado. La carga ocurre antes de publicar y el error deja el video pendiente en lugar de producir un resultado tolerante.
- **Riesgo real:** un sidecar corrupto puede detener el tick o dejar el video atascado; contradice el fallback requerido y el manejo de fallo de cola.
- **Corrección sugerida:** registrar timestamp y usar `.description/.txt` con defaults cuando el JSON sea inválido; alternativamente mover el video a `failed/` con `.error.json` si la política exige no publicar metadata ambigua.

### 🟡 MEDIO — Copias del orquestador no son atómicas ni verifican hash

- **Archivo:línea:** `src/orchestrator.js:127-133,155-215`.
- **Evidencia:** `copyIfMissing` trata cualquier archivo existente como copia válida; una interrupción durante la copia puede dejar un destino parcial que después se considera completo.
- **Riesgo real:** una plataforma puede recibir un archivo truncado o una copia que no corresponde al hash esperado; el reprocesamiento no lo corrige.
- **Corrección sugerida:** copiar a un temporal, fsync/rename atómico y comparar tamaño/hash antes de considerar la copia completa. Si una plataforma falla, conservar y reintentar solo esa plataforma con validación.

### 🔵 BAJO — Fechas con offset se comparan como instantes absolutos correctamente

- **Archivo:línea:** `src/scheduler.js:151-156`, `src/limits.js:11-19,75-98`, `src/orchestrator.js:160-171`.
- **Evidencia:** `scheduledAt` se parsea con `Date` y se compara por `getTime()`; las cuotas calculan fecha calendario con `Intl.DateTimeFormat` usando `config.timezone`.
- **Riesgo real:** no se observó mezcla incorrecta entre `-04:00` y la TZ del servidor. A las 23:59 se usa el día local anterior y a las 00:01 el nuevo.
- **Corrección sugerida:** conservar pruebas DST y de offsets explícitos; documentar que `scheduledAt` representa un instante absoluto y que la cuota representa día calendario de `TZ`.

### 🟡 MEDIO — Sin verificación de integridad de estado de límites

- **Archivo:línea:** `src/limits.js:45-63`.
- **Evidencia:** JSON corrupto se interpreta como estado vacío; no existe backup/versionado ni alerta.
- **Riesgo real:** una corrupción puede resetear contadores y permitir superar cuotas sin que el operador lo sepa.
- **Corrección sugerida:** validar esquema, conservar backup rotativo y emitir alerta cuando se descarte un estado inválido.

### 🟡 MEDIO — El lock de idempotencia no tiene recuperación tras reinicio

- **Archivo:línea:** `src/idempotency.js:40-43,64-68`.
- **Evidencia:** el lock se crea con `"wx"` y solo se elimina en `finally`; una terminación abrupta no ejecuta `finally`.
- **Riesgo real:** el próximo proceso interpreta cualquier lock antiguo como operación activa y deja de intentar el video, sin alerta ni comprobación de edad/PID.
- **Corrección sugerida:** persistir PID/host/fecha, validar proceso y TTL, y enviar el caso a revisión `uncertain` antes de permitir una recuperación manual.

## E. Salud del proyecto

### Resultados de aceptación

Salida real de `npm run check`:

```text
Syntax OK (65 files).
ℹ tests 54
ℹ pass 54
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
CHECK_EXIT=0
```

Salida real de `npm test`:

```text
ℹ tests 54
ℹ pass 54
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
TEST_EXIT=0
```

`git diff --check` no produjo salida y terminó correctamente.

### Cobertura de tests por fase

- **Fase 1:** `src/__tests__/meta-loader.test.js`; existe, pero no cubre el fallback requerido para JSON corrupto.
- **Fase 2:** `src/__tests__/orchestrator.test.js`; cubre offsets, sidecar e idempotencia básica; falta interrupción durante copia/hash.
- **Fase 3:** `src/__tests__/scheduler-policy.test.js` y `test/scheduler.test.js`; falta un test aislado de concurrencia de `limits.js`.
- **Fase 4:** `src/__tests__/stealth.test.js`, `src/__tests__/account-manager-proxy.test.js` y tests de selectors; falta prueba real de proxy/geo y de todos los contextos.
- **Fase 5:** `src/__tests__/errors.test.js`, `idempotency.test.js`, `post-finalizer.test.js`; falta integración de verificación UI/perfil en los tres uploaders.
- **Fase 6:** `src/__tests__/notifier.test.js`; cubre fetch mockeado, pero falta prueba real con Telegram/Discord configurados.
- **Fase 7:** `src/__tests__/operations-state.test.js`; falta test HTTP de todas las rutas, autenticación, confirmación y bind remoto.
- **Fase 8:** `src/__tests__/kill-switch.test.js`; falta automatizar un piloto real seguro. El piloto ejecutado no confirmó publicación porque la sesión TikTok mostraba login QR.

### Dependencias y comparación con upstream

`npm audit` real:

```text
body-parser  2.0.0 - 2.2.2
body-parser vulnerable to denial of service when invalid limit value silently disables size enforcement

proxy-addr  1.1.0 - 2.0.7
Severity: critical
proxy-addr vulnerable to IP spoofing via IPv4-mapped IPv6 trust subnet

qs  2.2.5 - 6.15.3
Severity: moderate
qs array-limit bypass via bracket-key comma parsing
qs: Denial of Service via Attacker Controlled isBuffer

3 vulnerabilities (1 low, 1 moderate, 1 critical)
```

No se ejecutó `npm audit fix`, porque esta auditoría no modifica dependencias.

`package.json` añade scripts operativos (`orchestrator`, `stealth-check`, `pilot`) y no añade dependencias pesadas nuevas; `package-lock.json` no presenta cambios frente a `origin/main`. La vulnerabilidad crítica transitoria de `proxy-addr` debe resolverse antes del piloto.

### 🔴 CRÍTICO — Vulnerabilidad crítica en dependencia transitiva

- **Archivo:línea:** `package-lock.json:721-734`; dependencia introducida transitivamente por Express.
- **Evidencia:** `npm audit` reporta `proxy-addr 1.1.0 - 2.0.7`, severidad critical, por spoofing de IP mediante subred IPv4-mapped IPv6. También reporta vulnerabilidades low en `body-parser` y moderate en `qs`.
- **Riesgo real:** si el dashboard se expone o se confía en cabeceras/proxies, un atacante puede manipular la identificación de origen; el impacto depende de la configuración de bind y trust proxy.
- **Corrección sugerida:** actualizar Express/árbol transitivo a versiones corregidas, volver a ejecutar `npm audit`, y no confiar en cabeceras de proxy mientras el dashboard sea remoto.

### 🟡 MEDIO — No existe remote `upstream` para verificar la base

- **Archivo:línea:** configuración Git del repositorio; no hay archivo de código.
- **Evidencia:** `git diff upstream/main --stat` devuelve `fatal: bad revision 'upstream/main'`; solo existe `origin` apuntando al repositorio base.
- **Riesgo real:** no se puede demostrar que el conjunto final esté alineado con la base upstream ni detectar cambios fuera de alcance contra la referencia solicitada.
- **Corrección sugerida:** configurar el remote upstream correcto y repetir el diff antes de integrar o pilotar.

No existe remote `upstream`; por ello `git diff upstream/main --stat` no es ejecutable y devuelve:

```text
fatal: bad revision 'upstream/main'
```

Como comparación disponible, `git diff origin/main --stat` mostró estos 19 archivos rastreados:

```text
.env.example
package.json
src/account-manager.js
src/config.js
src/daemon-controller.js
src/dashboard-server.js
src/instagram-daemon-controller.js
src/instagram-post-service.js
src/instagram-queue.js
src/instagram-uploader.js
src/post-service.js
src/queue.js
src/scheduler.js
src/tiktok-uploader.js
src/youtube-daemon-controller.js
src/youtube-post-service.js
src/youtube-queue.js
src/youtube-uploader.js
web/app.js
```

`web/operations.html` y los módulos nuevos son no rastreados en esta comparación, por lo que `git diff --stat` no los muestra. Los artefactos no rastreados detectados son `docs/operations-dashboard.png`, `docs/pilot-report-*.log`, `docs/stealth-check.png`, `queue/`, `scripts/pilot.sh`, `scripts/stealth-check.js`, `web/operations.html`, `src/__tests__/`, y los nuevos módulos de `src/`; los screenshots/logs generados no forman parte del alcance funcional documentado y deben excluirse o archivarse fuera del cambio.

Esto impide afirmar un diff completo frente a upstream hasta configurar `upstream` y comparar también el árbol no rastreado.

### Inventario completo de dominios contactables

**Runtime de aplicación/navegador:**

- `www.tiktok.com`: upload, perfiles/canales y autodownload.
- `www.instagram.com`: login/navegación/upload.
- `studio.youtube.com`: upload de YouTube Studio.
- `api.telegram.org`: Bot API, solo si se configura Telegram.
- Host dinámico de `NOTIFY_DISCORD_WEBHOOK_URL`: cualquier host indicado por el operador.
- Host dinámico de `TIKTOK_UPLOAD_URL`, `INSTAGRAM_UPLOAD_URL` y `YOUTUBE_UPLOAD_URL`: las variables pueden sustituir los defaults y no están restringidas por código.
- Host dinámico de `proxy` por cuenta: el proxy puede contactar cualquier servidor configurado.
- Host dinámico de `channel`, `webpage_url`, `original_url` e imágenes del JSON de TikTok: actualmente no hay allowlist completa.
- `bot.sannysoft.com`: diagnóstico de `scripts/stealth-check.js`.
- `fonts.googleapis.com`: hoja de estilos externa de `web/index.html`.
- `unpkg.com`: script externo de `web/index.html`.

**Contactables por instalación/metadata, no por el flujo de publicación:**

- `registry.npmjs.org`: URLs `resolved` de `package-lock.json`.
- `github.com`: repository, issues, sponsors y URLs de metadata de paquetes.
- `opencollective.com`: metadata de Express.
- `dotenvx.com`: metadata de dotenv.
- `ffmpeg.org`: URL mostrada como instrucción de instalación en `src/cli.js`, no una llamada automática.

**Solo fixtures/tests, no llamadas productivas:** `discord.test`, `proxy.us.example`, `proxy.mx.example` y `example.com`.

Los tres dominios de plataforma y `api.telegram.org` son esperados. El webhook Discord, proxy y URLs de contenido son configurables, pero deben validarse si la política exige una allowlist estricta. Los demás dominios de runtime son hallazgos de superficie de red.

### Severidad bajo dos modelos de amenaza

| Hallazgo 🔴 | Máquina local de un solo operador | VPS expuesto | Motivo |
|---|---|---|---|
| URLs arbitrarias en `yt-dlp` | 🟠 Alto | 🔴 Crítico | En local requiere operador malicioso o entrada comprometida; en VPS es SSRF/egress directo. |
| Redirecciones/imagenes de slideshow | 🟠 Alto | 🔴 Crítico | El riesgo aumenta si el servicio recibe input remoto o contenido no confiable. |
| `bot.sannysoft.com` | 🟡 Medio | 🔴 Crítico | En local es fuga de huella de un diagnóstico manual; en VPS expone perfiles/proxy desde un daemon. |
| Script externo `unpkg.com` | 🟠 Alto | 🔴 Crítico | En ambos modelos puede leer el token; en VPS además amplía la superficie remota. |
| Dashboard remoto + proxy en `/api/accounts` | 🟡 Medio si nunca se habilita | 🔴 Crítico si se habilita | El default loopback reduce exposición, pero el bypass permite publicar credenciales al exterior. |
| `proxy-addr` vulnerable | 🟡 Medio sin bind remoto/proxy trust | 🔴 Crítico en exposición | El impacto depende de rutas confiadas y de que el dashboard sea alcanzable desde red. |

Las etiquetas principales del informe usan el modelo conservador de **VPS expuesto o configuración remota accidental**, porque el código permite esas configuraciones. Bajo el modelo estrictamente local, los seis críticos bajarían como indica la tabla, pero no desaparecen.

## Observaciones operativas

- El piloto dry-run de las tres plataformas generó correctamente 9 planes con offsets 0/45/90.
- El piloto real de TikTok terminó `FATAL` con la UI de login QR y movió el video a `queue/default/tiktok/failed/`, generando screenshot y `.error.json`. Esto confirma que la cuenta necesita re-login humano antes de cualquier piloto real; no se intentó automatizarlo.
- El kill-switch fue verificado en modo `KILL_SWITCH=true`: el orquestador devuelve `skipped/paused` y los controladores detienen el siguiente tick. La limitación de lectura al arrancar está descrita arriba.

## Veredicto

# NO LISTO

Críticos que deben cerrarse antes de un piloto:

1. Restringir todas las descargas/redirecciones a una allowlist de hosts y eliminar el uso operativo de dominios desconocidos.
2. Retirar `bot.sannysoft.com`, `unpkg.com` y los recursos externos no esenciales del dashboard, o aislarlos fuera de producción con política explícita.
3. Impedir el bind remoto del dashboard o protegerlo sin exponer `accounts-state.json` ni credenciales de proxy.
4. Resolver la vulnerabilidad crítica de `proxy-addr` y volver a ejecutar `npm audit`.

Condiciones adicionales antes de publicar con cuentas reales: corregir el fallback de metadata inválida, implementar recuperación de locks/estados `in-progress`, serializar las cuotas, endurecer la confirmación post-publicación de YouTube y configurar/revisar el remote `upstream`.

# Riesgo residual aceptado (2026-10-20)
Hallazgo: docs/assets/dashboard-overview.png en commit base 4771789 (heredado del upstream público Katzca/AutoSocial).
Escáner de secretos: 1 hit. Naturaleza: contenido heredado, exposición preexistente y pública.
Decisión: NO reescritura de historial (costo > beneficio). Push a repo privado autorizado.
Disparador de reevaluación: si este fork se hiciera público algún día → clean-room(rama orphan o squash a 1 commit nuevo), NUNCA force-push sobre la cadena auditada.

## Cierre R3 — Fix A

- **Ítem 11 — CERRADO:** `src/tiktok-uploader.js:1109-1124` y `src/instagram-uploader.js:338-347` solo aceptan permalink o texto dentro de contenedor de confirmación; el texto genérico del `body` produce `status: "uncertain"`.
- **Ítem 9 — CERRADO para reintento seguro:** `src/post-finalizer.js:65-80` y `src/idempotency.js:130-136` dejan un hash `uncertain` en revisión humana, emiten log y no vuelven a invocar el uploader.
- **Tests:** `src/__tests__/confirmation.test.js` cubre body genérico, confirmación específica/permalink y archivo `posted-uncertain` con `.error.json` y notificación.

## Cierre R3 — Fix B

- **Ítem 9 — CERRADO:** `src/startup-reconcile.js:91-151` ejecuta `reconcileInProgress()` y reconcilia `pending/` y `posted-uncertain/` contra `.scheduler-state/seen.json`; `src/scheduler.js:285-310`, `src/orchestrator.js:341-354` y `src/dashboard-server.js:211-215` lo ejecutan antes de registrar/aceptar trabajos.
- **Evidencia:** cada movimiento registra timestamp, cuenta, plataforma, archivo y transición; estados `confirmed` van a `posted/`, estados inciertos permanecen en `posted-uncertain/` y los `in-progress` se convierten en `uncertain` antes de moverlos.
- **Test:** `src/__tests__/startup-reconciliation.test.js` verifica el barrido antes del primer tick y tres movimientos de archivos inconsistentes.
