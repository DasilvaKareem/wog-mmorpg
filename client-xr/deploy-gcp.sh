#!/usr/bin/env bash
set -euo pipefail

# Deploy XR client to worldofgeneva.com/xr (same bucket as main client)
BUCKET="gs://wog-client"
PREFIX="xr"
CLIENT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Building XR client (prod)..."
cd "$CLIENT_DIR"
rm -rf dist
NODE_ENV=production VITE_API_URL="https://wog.urbantech.dev" pnpm build

echo "==> Uploading to $BUCKET/$PREFIX/..."
gcloud storage rsync --recursive dist/ "$BUCKET/$PREFIX/"

echo "==> Setting cache headers..."
# HTML — no cache (always fetch latest)
gcloud storage objects update "$BUCKET/$PREFIX/index.html" --cache-control="no-cache, no-store"

# Hashed assets — cache aggressively
gsutil -m setmeta -r -h "Cache-Control:public, max-age=31536000, immutable" "$BUCKET/$PREFIX/assets/" 2>/dev/null || true

echo "==> Done!"
echo "    https://worldofgeneva.com/xr/"
