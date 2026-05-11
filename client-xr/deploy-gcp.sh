#!/usr/bin/env bash
set -euo pipefail

# Deploy XR client to worldofgeneva.com (bucket root)
BUCKET="gs://wog-client"
CLIENT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Building XR client (prod)..."
cd "$CLIENT_DIR"
rm -rf dist
NODE_ENV=production VITE_API_URL="https://wog.preyanshu.me" pnpm build

echo "==> Uploading to $BUCKET/ ..."
gcloud storage rsync --recursive dist/ "$BUCKET"

if [ -d "dist/models" ]; then
  echo "==> Force-updating unversioned model files..."
  gcloud storage cp --recursive dist/models "$BUCKET/"
fi

echo "==> Setting cache headers..."
# HTML / SW — no cache (always fetch latest)
gcloud storage objects update "$BUCKET/index.html" --cache-control="no-cache, no-store"
gcloud storage objects update "$BUCKET/sw.js" --cache-control="no-cache, no-store" 2>/dev/null || true
gcloud storage objects update "$BUCKET/display.html" --cache-control="no-cache, no-store" 2>/dev/null || true
gcloud storage objects update "$BUCKET/controller.html" --cache-control="no-cache, no-store" 2>/dev/null || true

# Unversioned public models can change in-place, so keep them revalidating.
gsutil -m setmeta -r -h "Cache-Control:no-cache, no-store" "$BUCKET/models/" 2>/dev/null || true

# Hashed assets — cache aggressively
gsutil -m setmeta -r -h "Cache-Control:public, max-age=31536000, immutable" "$BUCKET/assets/" 2>/dev/null || true

echo "==> Done!"
echo "    https://worldofgeneva.com/"
