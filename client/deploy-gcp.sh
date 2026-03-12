#!/usr/bin/env bash
set -euo pipefail

BUCKET="gs://wog-client"
CLIENT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Stamping service worker cache version..."
# Auto-bump the SW cache name on every deploy so installed PWAs pick up changes
DEPLOY_TS=$(date +%s)
sed -i '' "s/const CACHE_NAME = \"wog-[^\"]*\"/const CACHE_NAME = \"wog-${DEPLOY_TS}\"/" "$CLIENT_DIR/public/sw.js"
echo "    CACHE_NAME = wog-${DEPLOY_TS}"

echo "==> Building client..."
cd "$CLIENT_DIR"
pnpm build

echo "==> Uploading to $BUCKET..."
gsutil -m rsync -r -d dist/ "$BUCKET"

echo "==> Setting cache headers..."
# HTML — no cache (always fetch latest)
gsutil -m setmeta -h "Cache-Control:no-cache, no-store" "$BUCKET/index.html"
gsutil -m setmeta -h "Cache-Control:no-cache, no-store" "$BUCKET/sw.js"

# Hashed assets — cache aggressively (Vite adds content hashes)
gsutil -m setmeta -r -h "Cache-Control:public, max-age=31536000, immutable" "$BUCKET/assets/" 2>/dev/null || true

echo "==> Done!"
echo "    https://storage.googleapis.com/wog-client/index.html"
