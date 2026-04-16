#!/bin/bash
set -e

export COPYFILE_DISABLE=1

INSTANCE="instance-20260213-193154"
ZONE="us-central1-f"
REMOTE_DIR="/opt/wog-mmorpg"

echo "=== WoG MMORPG Deploy to GCE ==="

# Preserve live terrain edits: pull VM's terrain JSONs into local repo
# before tarring, so "Save to Shard" edits from worldofgeneva.com/map/
# aren't clobbered by the local world/ folder. Set SKIP_TERRAIN_PULL=1
# to skip (e.g. when intentionally replacing VM state with local).
if [ "${SKIP_TERRAIN_PULL:-0}" != "1" ]; then
  echo "[0/5] Pulling live terrain from VM to preserve in-browser edits..."
  mkdir -p world/content/terrain
  gcloud compute scp --zone=$ZONE --recurse \
    "$INSTANCE:$REMOTE_DIR/world/content/terrain/*.json" \
    world/content/terrain/ 2>/dev/null || \
    echo "    (no remote terrain files found — continuing)"
fi

# Build TypeScript locally (ignore type errors, JS still emits)
echo "[1/5] Building TypeScript..."
cd shard
npx tsc 2>/dev/null || true
cd ../mcp
npx tsc 2>/dev/null || true
cd ..

# Strip macOS AppleDouble resource-fork files before tarring.
# `--exclude='._*'` on BSD tar doesn't always catch them after a `-C` directory change,
# so we delete them up-front from every path we're about to archive.
echo "[2/5] Stripping macOS metadata..."
find shard/dist shard/src shard/data world src/data mcp/dist mcp/src \
  \( -name '._*' -o -name '.DS_Store' \) -type f -delete 2>/dev/null || true

# Create shard tarball
echo "[2/5] Packing shard..."
tar czf /tmp/wog-shard.tar.gz --exclude='node_modules' --exclude='.env' --exclude='.env.production' --exclude='.git' --exclude='._*' --exclude='.DS_Store' \
  -C shard dist src data package.json pnpm-lock.yaml tsconfig.json \
  -C .. world src/data

# Create MCP tarball (separate so it installs into mcp/ subdir on VM)
echo "[2/5] Packing MCP server..."
tar czf /tmp/wog-mcp.tar.gz --exclude='node_modules' --exclude='.env' --exclude='.env.production' --exclude='.git' --exclude='._*' --exclude='.DS_Store' \
  -C mcp dist src package.json pnpm-lock.yaml tsconfig.json

echo "[3/5] Uploading..."
gcloud compute scp --zone=$ZONE /tmp/wog-shard.tar.gz $INSTANCE:/tmp/wog-shard.tar.gz
gcloud compute scp --zone=$ZONE /tmp/wog-mcp.tar.gz $INSTANCE:/tmp/wog-mcp.tar.gz

# Extract and install on VM
echo "[4/5] Extracting and installing deps..."
gcloud compute ssh $INSTANCE --zone=$ZONE --command="\
  cd $REMOTE_DIR && \
  sudo tar xzf /tmp/wog-shard.tar.gz -C $REMOTE_DIR --no-same-owner --no-same-permissions 2>/dev/null && \
  sudo mkdir -p $REMOTE_DIR/mcp && sudo tar xzf /tmp/wog-mcp.tar.gz -C $REMOTE_DIR/mcp --no-same-owner --no-same-permissions 2>/dev/null && \
  sudo find $REMOTE_DIR -name '._*' -delete 2>/dev/null || true && \
  sudo chown -R \$USER:\$USER $REMOTE_DIR/dist $REMOTE_DIR/src $REMOTE_DIR/world $REMOTE_DIR/mcp 2>/dev/null || true && \
  rm /tmp/wog-shard.tar.gz /tmp/wog-mcp.tar.gz && \
  pnpm install --frozen-lockfile --prod && \
  cd mcp && pnpm install --frozen-lockfile --prod && cd .."

# Restart PM2
echo "[5/5] Restarting PM2..."
gcloud compute ssh $INSTANCE --zone=$ZONE --command="\
  cd $REMOTE_DIR && \
  (pm2 restart wog-shard 2>/dev/null || pm2 restart wog-mmorpg 2>/dev/null || pm2 start $REMOTE_DIR/dist/server.js --name wog-shard --cwd $REMOTE_DIR) && \
  (pm2 restart wog-mcp 2>/dev/null || pm2 start $REMOTE_DIR/mcp/dist/index.js --name wog-mcp --cwd $REMOTE_DIR/mcp) && \
  sleep 10 && \
  curl -sf http://localhost:3000/health && echo ' <- shard OK' && \
  curl -sf http://localhost:3001/health && echo ' <- MCP OK' && \
  echo 'Both servers healthy!' && \
  echo '--- Port 3000 sanity check ---' && \
  SHARD_PM2_PID=\$(pm2 jlist 2>/dev/null | node -e 'let d=\"\";process.stdin.on(\"data\",c=>d+=c).on(\"end\",()=>{const a=JSON.parse(d);const p=a.find(x=>x.name===\"wog-shard\"||x.name===\"wog-mmorpg\");process.stdout.write(String(p?.pid||\"\"))})') && \
  PORT_PID=\$(sudo fuser 3000/tcp 2>/dev/null | awk '{print \$1}') && \
  echo \"pm2 shard pid=\$SHARD_PM2_PID  port 3000 owner=\$PORT_PID\" && \
  if [ -n \"\$SHARD_PM2_PID\" ] && [ -n \"\$PORT_PID\" ] && [ \"\$SHARD_PM2_PID\" = \"\$PORT_PID\" ]; then \
    echo '✓ Port 3000 is owned by pm2-managed shard'; \
  else \
    echo '⚠ WARNING: port 3000 is NOT owned by pm2 shard — orphan process detected'; \
    exit 1; \
  fi"

rm /tmp/wog-shard.tar.gz /tmp/wog-mcp.tar.gz 2>/dev/null || true

echo ""
echo "=== Deploy complete ==="
