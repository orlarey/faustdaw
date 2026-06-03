#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/deploy-to-nas.sh <target> [--no-build]

Examples:
  ./scripts/deploy-to-nas.sh /Volumes/web/webdaw
  ./scripts/deploy-to-nas.sh admin@nas:/volume1/web/webdaw

Behavior:
  - builds the project by default
  - stages only the runtime files needed by Web Station
  - syncs them to the target with rsync

Expected target layout after deploy:
  demo/
  dist/
  node_modules/@ffmpeg/core/dist/
  node_modules/@ffmpeg/ffmpeg/dist/
EOF
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
  exit 1
fi

TARGET="$1"
BUILD=1

if [[ $# -eq 2 ]]; then
  if [[ "$2" == "--no-build" ]]; then
    BUILD=0
  else
    usage
    exit 1
  fi
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$ROOT_DIR"

if [[ $BUILD -eq 1 ]]; then
  npm run build
fi

if [[ ! -d dist || ! -f demo/index.html ]]; then
  echo "Expected build output or demo files are missing." >&2
  exit 1
fi

if [[ ! -d node_modules/@ffmpeg/core/dist || ! -d node_modules/@ffmpeg/ffmpeg/dist ]]; then
  echo "ffmpeg runtime assets are missing. Run 'npm install' first." >&2
  exit 1
fi

STAGING_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGING_DIR"' EXIT

mkdir -p \
  "$STAGING_DIR/demo" \
  "$STAGING_DIR/dist" \
  "$STAGING_DIR/node_modules/@ffmpeg/core" \
  "$STAGING_DIR/node_modules/@ffmpeg/ffmpeg"

rsync -a demo/ "$STAGING_DIR/demo/"
rsync -a dist/ "$STAGING_DIR/dist/"
rsync -a node_modules/@ffmpeg/core/dist/ "$STAGING_DIR/node_modules/@ffmpeg/core/dist/"
rsync -a node_modules/@ffmpeg/ffmpeg/dist/ "$STAGING_DIR/node_modules/@ffmpeg/ffmpeg/dist/"

if [[ "$TARGET" == *:* ]]; then
  REMOTE_HOST="${TARGET%%:*}"
  REMOTE_PATH="${TARGET#*:}"
  REMOTE_PATH_ESCAPED="${REMOTE_PATH//\'/\'\\\'\'}"
  ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_PATH_ESCAPED'"
else
  mkdir -p "$TARGET"
fi

rsync -a --delete "$STAGING_DIR"/ "$TARGET"/

echo "Deployed WebDAW to $TARGET"
