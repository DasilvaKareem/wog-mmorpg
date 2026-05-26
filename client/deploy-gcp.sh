#!/usr/bin/env bash
set -euo pipefail

# Main client now lives under /app/ in the bucket; a Cloudflare Worker
# rewrites app.worldofgeneva.com/<path> -> gs://wog-client/app/<path>.
# Because the worker abstracts the prefix, the client itself stays at "/".
BUCKET="gs://wog-client"
PREFIX="app"
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

echo "==> Uploading to $BUCKET/$PREFIX/..."
# Upload new assets first and keep old hashed chunks around temporarily.
# Deleting old assets immediately can break clients still holding a cached HTML shell.
gcloud storage rsync --recursive dist/ "$BUCKET/$PREFIX/"

echo "==> Setting cache headers..."
# HTML / SW / manifest — no cache (always fetch latest)
gcloud storage objects update "$BUCKET/$PREFIX/index.html" --cache-control="no-cache, no-store"
gcloud storage objects update "$BUCKET/$PREFIX/sw.js" --cache-control="no-cache, no-store"
gcloud storage objects update "$BUCKET/$PREFIX/manifest.json" --cache-control="no-cache, no-store"

# Hashed assets — cache aggressively (Vite adds content hashes)
gsutil -m setmeta -r -h "Cache-Control:public, max-age=31536000, immutable" "$BUCKET/$PREFIX/assets/" 2>/dev/null || true

# SPA fallback: copy index.html to every single-segment React route so deep
# links like /app/pricing return 200. The Classic External LB doesn't support
# customErrorResponsePolicy, so we materialize the fallback in the bucket.
# Routes are auto-extracted from App.tsx — any new <Route path="/foo"> is
# picked up on the next deploy.
echo "==> Materializing SPA route fallbacks..."
ROUTES=$(grep -oE '<Route path="/[a-zA-Z0-9_-]+"' src/App.tsx \
  | sed -E 's|<Route path="/([a-zA-Z0-9_-]+)"|\1|' \
  | sort -u)
for route in $ROUTES; do
  gcloud storage cp "$BUCKET/$PREFIX/index.html" "$BUCKET/$PREFIX/$route" \
    --cache-control="no-cache, no-store" >/dev/null 2>&1 \
    && echo "    /$PREFIX/$route" \
    || echo "    /$PREFIX/$route (failed)"
done

echo "==> Done!"
echo "    https://app.worldofgeneva.com/"
