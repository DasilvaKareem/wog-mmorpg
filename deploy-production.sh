#!/bin/bash
set -e

INSTANCE="instance-20260213-193154"
ZONE="us-central1-f"
REMOTE_DIR="/opt/wog-mmorpg"

echo "=== WoG MMORPG Deploy to GCE ==="

# Build TypeScript locally (ignore type errors, JS still emits)
echo "[1/5] Building TypeScript..."
cd shard
npx tsc 2>/dev/null || true
cd ../mcp
npx tsc 2>/dev/null || true
cd ..

# Create shard tarball
echo "[2/5] Packing shard..."
tar czf /tmp/wog-shard.tar.gz --exclude='node_modules' --exclude='.env' --exclude='.git' --exclude='._*' \
  -C shard dist src data package.json pnpm-lock.yaml tsconfig.json \
  -C .. world src/data

# Create MCP tarball (separate so it installs into mcp/ subdir on VM)
echo "[2/5] Packing MCP server..."
tar czf /tmp/wog-mcp.tar.gz --exclude='node_modules' --exclude='.env' --exclude='.git' --exclude='._*' \
  -C mcp dist src package.json pnpm-lock.yaml tsconfig.json

echo "[3/5] Uploading..."
gcloud compute scp --zone=$ZONE /tmp/wog-shard.tar.gz $INSTANCE:/tmp/wog-shard.tar.gz
gcloud compute scp --zone=$ZONE /tmp/wog-mcp.tar.gz $INSTANCE:/tmp/wog-mcp.tar.gz

# Extract and install on VM
echo "[4/5] Extracting and installing deps..."
gcloud compute ssh $INSTANCE --zone=$ZONE --command="\
  cd $REMOTE_DIR && \
  sudo tar xzf /tmp/wog-shard.tar.gz 2>/dev/null && \
  mkdir -p mcp && cd mcp && sudo tar xzf /tmp/wog-mcp.tar.gz 2>/dev/null && cd .. && \
  sudo chown -R \$(whoami):\$(whoami) . && \
  rm /tmp/wog-shard.tar.gz /tmp/wog-mcp.tar.gz && \
  pnpm install --frozen-lockfile --prod && \
  cd mcp && pnpm install --frozen-lockfile --prod && cd .."

# Restart PM2
echo "[5/5] Restarting PM2..."
gcloud compute ssh $INSTANCE --zone=$ZONE --command="\
  cd $REMOTE_DIR && \
  pm2 restart wog-mmorpg && \
  (pm2 restart wog-mcp 2>/dev/null || pm2 start $REMOTE_DIR/mcp/dist/index.js --name wog-mcp --cwd $REMOTE_DIR/mcp) && \
  sleep 10 && \
  curl -sf http://localhost:3000/health && echo ' <- shard OK' && \
  curl -sf http://localhost:3001/health && echo ' <- MCP OK' && \
  echo 'Both servers healthy!'"

rm /tmp/wog-shard.tar.gz /tmp/wog-mcp.tar.gz 2>/dev/null || true

echo ""
echo "=== Deploy complete ==="
