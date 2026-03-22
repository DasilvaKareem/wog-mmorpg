#!/usr/bin/env bash
# Upload audio assets from client/public/audio to Cloudflare R2.
# Usage:
#   ./scripts/upload-audio-assets.sh
#   ./scripts/upload-audio-assets.sh sfx/ui/ui_dialog_open.ogg

set -euo pipefail

BUCKET="wog-assets"
LOCAL_DIR="client/public/audio"
R2_PREFIX="audio"

if [ ! -d "$LOCAL_DIR" ]; then
  echo "Error: $LOCAL_DIR not found. Run from repo root."
  exit 1
fi

TARGET="${1:-}"

content_type_for() {
  case "$1" in
    *.ogg) echo "audio/ogg" ;;
    *.mp3) echo "audio/mpeg" ;;
    *.wav) echo "audio/wav" ;;
    *) echo "application/octet-stream" ;;
  esac
}

upload_file() {
  local file="$1"
  local relative="${file#${LOCAL_DIR}/}"
  local r2_key="${R2_PREFIX}/${relative}"
  local content_type
  content_type="$(content_type_for "$file")"

  echo "  ↑ $r2_key"
  npx wrangler r2 object put "$BUCKET/$r2_key" --file="$file" --content-type="$content_type" --remote
}

echo "Uploading audio assets from $LOCAL_DIR → r2://$BUCKET/$R2_PREFIX"

if [ -n "$TARGET" ]; then
  file="$LOCAL_DIR/$TARGET"
  if [ ! -f "$file" ]; then
    echo "Error: $file not found."
    exit 1
  fi
  upload_file "$file"
  exit 0
fi

find "$LOCAL_DIR" -type f \( -name "*.ogg" -o -name "*.mp3" -o -name "*.wav" \) | while read -r file; do
  upload_file "$file"
done
