#!/usr/bin/env bash
# Upload sprite layer assets to Cloudflare R2
# Usage: ./scripts/upload-assets.sh [specific-dir]
#
# Examples:
#   ./scripts/upload-assets.sh                    # upload all layers
#   ./scripts/upload-assets.sh body               # upload only body layers
#   ./scripts/upload-assets.sh weapons             # upload only weapon layers

set -euo pipefail

BUCKET="wog-assets"
LOCAL_DIR="client/public/sprites/layers"
R2_PREFIX="sprites/layers"

if [ ! -d "$LOCAL_DIR" ]; then
  echo "Error: $LOCAL_DIR not found. Run from repo root."
  exit 1
fi

# Optional: upload only a subdirectory
SUBDIR="${1:-}"
if [ -n "$SUBDIR" ]; then
  LOCAL_DIR="$LOCAL_DIR/$SUBDIR"
  R2_PREFIX="$R2_PREFIX/$SUBDIR"
fi

echo "Uploading $LOCAL_DIR → r2://$BUCKET/$R2_PREFIX"

uploaded=0
skipped=0

find "$LOCAL_DIR" -type f -name "*.png" | while read -r file; do
  # Compute the R2 key relative to the layers root
  relative="${file#client/public/sprites/layers/}"
  r2_key="sprites/layers/$relative"

  echo "  ↑ $r2_key"
  npx wrangler r2 object put "$BUCKET/$r2_key" --file="$file" --content-type="image/png" --remote 2>/dev/null
  uploaded=$((uploaded + 1))
done

echo "Done. Uploaded files to r2://$BUCKET/$R2_PREFIX"
