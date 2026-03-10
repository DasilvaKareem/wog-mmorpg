#!/usr/bin/env bash
set -euo pipefail

BUCKET="gs://wog-client"
CLIENT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Building client..."
cd "$CLIENT_DIR"
pnpm build

echo "==> Uploading to $BUCKET..."
gsutil -m rsync -r -d dist/ "$BUCKET"

echo "==> Setting cache headers..."
# HTML — no cache (always fetch latest)
gsutil -m setmeta -h "Cache-Control:no-cache, no-store" "$BUCKET/index.html"

# Hashed assets — cache aggressively (Vite adds content hashes)
gsutil -m setmeta -r -h "Cache-Control:public, max-age=31536000, immutable" "$BUCKET/assets/" 2>/dev/null || true

echo "==> Done!"
echo "    https://storage.googleapis.com/wog-client/index.html"
