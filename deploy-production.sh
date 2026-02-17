#!/bin/bash
set -e

INSTANCE="instance-20260213-193154"
ZONE="us-central1-f"
REMOTE_DIR="/opt/wog-mmorpg"

echo "=== WoG MMORPG Deploy to GCE ==="

# Build TypeScript locally (ignore type errors, JS still emits)
echo "[1/4] Building TypeScript..."
cd shard
npx tsc 2>/dev/null || true
cd ..

# Create tarball (fast transfer)
echo "[2/4] Packing and uploading..."
cd shard
tar czf /tmp/wog-deploy.tar.gz --exclude='node_modules' --exclude='.env' --exclude='.git' \
  dist src data package.json pnpm-lock.yaml tsconfig.json
cd ..

gcloud compute scp --zone=$ZONE /tmp/wog-deploy.tar.gz $INSTANCE:/tmp/wog-deploy.tar.gz

# Extract and install on VM
echo "[3/4] Extracting and installing deps..."
gcloud compute ssh $INSTANCE --zone=$ZONE --command="\
  cd $REMOTE_DIR && \
  sudo tar xzf /tmp/wog-deploy.tar.gz 2>/dev/null && \
  sudo chown -R \$(whoami):\$(whoami) . && \
  rm /tmp/wog-deploy.tar.gz && \
  pnpm install --frozen-lockfile --prod"

# Restart PM2
echo "[4/4] Restarting PM2..."
gcloud compute ssh $INSTANCE --zone=$ZONE --command="\
  cd $REMOTE_DIR && \
  pm2 restart wog-mmorpg && \
  sleep 3 && \
  curl -sf http://localhost:3000/health && echo '' && \
  echo 'Server is healthy!'"

rm /tmp/wog-deploy.tar.gz 2>/dev/null || true

echo ""
echo "=== Deploy complete ==="
