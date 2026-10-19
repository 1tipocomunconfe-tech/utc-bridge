#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PILOT_PLATFORM="${PILOT_PLATFORM:-tiktok}"
PILOT_ACCOUNT_ID="${PILOT_ACCOUNT_ID:-default}"
PILOT_VIDEO="${PILOT_VIDEO:-}"
PILOT_CONFIRM_REAL="${PILOT_CONFIRM_REAL:-false}"
PILOT_QUEUE_ROOT="${PILOT_QUEUE_ROOT:-$ROOT/queue}"
REPORT_TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT_PATH="$ROOT/docs/pilot-report-${REPORT_TIMESTAMP}.log"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/autosocial-pilot.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT
exec > >(tee "$REPORT_PATH") 2>&1

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

case "$PILOT_PLATFORM" in
  tiktok|instagram|youtube) ;;
  *) log "Invalid PILOT_PLATFORM: $PILOT_PLATFORM"; exit 2 ;;
esac

log "AutoSocial+ safe pilot started. Platform=$PILOT_PLATFORM account=$PILOT_ACCOUNT_ID"
log "Phase 1/3: complete dry-run with three test videos"

DRY_INBOX="$TEMP_ROOT/inbox"
DRY_QUEUE="$TEMP_ROOT/queues"
mkdir -p "$DRY_INBOX"
for index in 1 2 3; do
  video_name="pilot-test-${index}.mp4"
  printf 'synthetic pilot fixture %s\n' "$index" > "$DRY_INBOX/$video_name"
  cat > "$DRY_INBOX/pilot-test-${index}.meta.json" <<EOF
{
  "caption": {
    "tiktok": "AutoSocial pilot test ${index}",
    "instagram": "AutoSocial pilot test ${index}",
    "youtube": {
      "title": "AutoSocial pilot test ${index}",
      "description": "Dry-run fixture ${index}"
    }
  },
  "tags": ["#pilot"]
}
EOF
done

ORCHESTRATOR_ENABLED=true \
KILL_SWITCH=false \
DRY_RUN=true \
INBOX_DIR="$DRY_INBOX" \
QUEUE_DIR="$DRY_QUEUE/tiktok/pending" \
INSTAGRAM_QUEUE_DIR="$DRY_QUEUE/instagram/pending" \
YOUTUBE_QUEUE_DIR="$DRY_QUEUE/youtube/pending" \
npm run orchestrator -- --once

log "Dry-run completed. No test fixture was copied or published."

if [[ "$PILOT_CONFIRM_REAL" != "true" ]]; then
  log "Real publication was not requested. Set PILOT_VIDEO and PILOT_CONFIRM_REAL=true to continue."
  log "Final report: $REPORT_PATH"
  exit 3
fi

if [[ -z "$PILOT_VIDEO" || ! -f "$PILOT_VIDEO" ]]; then
  log "PILOT_VIDEO must point to an existing local video file."
  exit 2
fi
if [[ "${KILL_SWITCH:-false}" == "true" ]]; then
  log "KILL_SWITCH=true: real publication aborted before queue mutation."
  exit 4
fi

log "Phase 2/3: verifying the existing human session"
node - "$PILOT_PLATFORM" "$PILOT_ACCOUNT_ID" <<'NODE'
const { hasSavedPlatformSession } = require("./src/account-manager");

(async () => {
  const [platform, accountId] = process.argv.slice(2);
  const saved = await hasSavedPlatformSession(platform, accountId);
  if (!saved) {
    throw new Error(`No saved human session for ${accountId}/${platform}. Run the manual login flow first.`);
  }
  console.log(`[${new Date().toISOString()}] Human session detected for ${accountId}/${platform}.`);
})().catch((error) => {
  console.error(`[${new Date().toISOString()}] ${error.message}`);
  process.exit(2);
});
NODE

PENDING_DIR="$PILOT_QUEUE_ROOT/$PILOT_ACCOUNT_ID/$PILOT_PLATFORM/pending"
POSTED_DIR="$PILOT_QUEUE_ROOT/$PILOT_ACCOUNT_ID/$PILOT_PLATFORM/posted"
FAILED_DIR="$PILOT_QUEUE_ROOT/$PILOT_ACCOUNT_ID/$PILOT_PLATFORM/failed"
VIDEO_NAME="$(basename "$PILOT_VIDEO")"
mkdir -p "$PENDING_DIR" "$POSTED_DIR" "$FAILED_DIR"
if [[ -e "$PENDING_DIR/$VIDEO_NAME" ]]; then
  log "Refusing to overwrite an existing pending file: $PENDING_DIR/$VIDEO_NAME"
  exit 2
fi
cp "$PILOT_VIDEO" "$PENDING_DIR/$VIDEO_NAME"
for suffix in .meta.json .description .txt; do
  if [[ -f "${PILOT_VIDEO%.*}$suffix" ]]; then
    cp "${PILOT_VIDEO%.*}$suffix" "$PENDING_DIR/${VIDEO_NAME%.*}$suffix"
  fi
done

log "Phase 3/3: publishing exactly one real video and waiting for verified UI confirmation"
set +e
node - "$PILOT_PLATFORM" "$PENDING_DIR/$VIDEO_NAME" "$POSTED_DIR" "$FAILED_DIR" "$PILOT_ACCOUNT_ID" <<'NODE'
const path = require("path");
const { loadVideoMetadata } = require("./src/meta-loader");

const services = {
  tiktok: require("./src/post-service"),
  instagram: require("./src/instagram-post-service"),
  youtube: require("./src/youtube-post-service"),
};

(async () => {
  const [platform, videoPath, postedDir, failedDir, accountId] = process.argv.slice(2);
  const metadata = await loadVideoMetadata(videoPath);
  const caption = platform === "youtube"
    ? metadata.caption.youtube
    : metadata.caption[platform];
  const result = await services[platform].postSingleVideo({
    videoPath,
    caption,
    metadata,
    source: "safe-pilot",
    postedDir,
    failedDir,
    accountId,
  });
  console.log(`[${new Date().toISOString()}] PILOT_RESULT ${JSON.stringify(result, null, 2)}`);
  if (result.screenshotPath) {
    console.log(`[${new Date().toISOString()}] Screenshot: ${result.screenshotPath}`);
  }
  if (result.errorReport) {
    console.log(`[${new Date().toISOString()}] Error report: ${result.errorReport}`);
  }
  if (!(result.ok && result.status === "confirmed")) {
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(`[${new Date().toISOString()}] PILOT_FATAL ${error.stack || error.message}`);
  process.exitCode = 1;
});
NODE
RESULT_CODE=$?
set -e

if [[ "$RESULT_CODE" -eq 0 ]]; then
  log "FINAL: verified publication confirmed by platform UI."
else
  log "FINAL: publication did not reach confirmed status (code $RESULT_CODE). Review failed/ or posted-uncertain/."
fi
log "Screenshots and reports are printed above; repository report: $REPORT_PATH"
exit "$RESULT_CODE"
