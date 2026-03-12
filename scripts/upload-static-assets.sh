#!/usr/bin/env bash
# Upload static assets from client/public/assets to Cloudflare R2.
# Usage:
#   ./scripts/upload-static-assets.sh
#   ./scripts/upload-static-assets.sh npcs/tutorial-master.png

set -euo pipefail

BUCKET="wog-assets"
LOCAL_DIR="client/public/assets"
R2_PREFIX="assets"

if [ ! -d "$LOCAL_DIR" ]; then
  echo "Error: $LOCAL_DIR not found. Run from repo root."
  exit 1
fi

TARGET="${1:-}"

upload_file() {
  local file="$1"
  local relative="${file#${LOCAL_DIR}/}"
  local r2_key="${R2_PREFIX}/${relative}"

  echo "  ↑ $r2_key"
  npx wrangler r2 object put "$BUCKET/$r2_key" --file="$file" --content-type="image/png" --remote
}

echo "Uploading static assets from $LOCAL_DIR → r2://$BUCKET/$R2_PREFIX"

if [ -n "$TARGET" ]; then
  file="$LOCAL_DIR/$TARGET"
  if [ ! -f "$file" ]; then
    echo "Error: $file not found."
    exit 1
  fi
  upload_file "$file"
  exit 0
fi

find "$LOCAL_DIR" -type f -name "*.png" | while read -r file; do
  upload_file "$file"
done
