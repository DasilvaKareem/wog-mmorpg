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
rm -rf dist
pnpm build

echo "==> Writing chunk compatibility aliases..."
# Detect the real Vite-produced chunk (there should be exactly one after a clean build)
LANDING_CHUNK="$(basename "$(ls dist/assets/LandingPage-*.js)")"
ONBOARDING_CHUNK="$(basename "$(ls dist/assets/OnboardingFlow-*.js)")"
echo "    LandingPage chunk:    $LANDING_CHUNK"
echo "    OnboardingFlow chunk: $ONBOARDING_CHUNK"

# Create re-export aliases for old chunk names so stale cached HTML still works
if [ "$LANDING_CHUNK" != "LandingPage-BPizwrpr.js" ]; then
  cat > "dist/assets/LandingPage-BPizwrpr.js" <<EOFALIAS
export { LandingPage } from "./${LANDING_CHUNK}";
EOFALIAS
fi

if [ "$ONBOARDING_CHUNK" != "OnboardingFlow-CMIjPleW.js" ]; then
  cat > "dist/assets/OnboardingFlow-CMIjPleW.js" <<EOFALIAS
export { OnboardingFlow } from "./${ONBOARDING_CHUNK}";
EOFALIAS
fi

echo "==> Uploading to $BUCKET..."
# Upload new assets first and keep old hashed chunks around temporarily.
# Deleting old assets immediately can break clients still holding a cached HTML shell.
gcloud storage rsync --recursive dist/ "$BUCKET"

echo "==> Setting cache headers..."
# HTML / SW / manifest — no cache (always fetch latest)
gcloud storage objects update "$BUCKET/index.html" --cache-control="no-cache, no-store"
gcloud storage objects update "$BUCKET/sw.js" --cache-control="no-cache, no-store"
gcloud storage objects update "$BUCKET/manifest.json" --cache-control="no-cache, no-store"

# Hashed assets — cache aggressively (Vite adds content hashes)
gsutil -m setmeta -r -h "Cache-Control:public, max-age=31536000, immutable" "$BUCKET/assets/" 2>/dev/null || true

echo "==> Done!"
echo "    https://storage.googleapis.com/wog-client/index.html"
