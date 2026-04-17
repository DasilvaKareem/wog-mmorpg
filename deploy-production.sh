#!/bin/bash
set -e

export COPYFILE_DISABLE=1

INSTANCE="instance-20260213-193154"
ZONE="us-central1-f"
REMOTE_DIR="/opt/wog-mmorpg"
PM2_RUNTIME_USER="${PM2_RUNTIME_USER:-preyanshu}"
PM2_RUNTIME_HOME="/home/$PM2_RUNTIME_USER/.pm2"

echo "=== WoG MMORPG Deploy to GCE ==="
echo "Runtime owner: $PM2_RUNTIME_USER"

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
  shard/dist shard/src shard/data shard/package.json shard/pnpm-lock.yaml shard/tsconfig.json \
  world src/data

# Create MCP tarball (separate so it installs into mcp/ subdir on VM)
echo "[2/5] Packing MCP server..."
tar czf /tmp/wog-mcp.tar.gz --exclude='node_modules' --exclude='.env' --exclude='.env.production' --exclude='.git' --exclude='._*' --exclude='.DS_Store' \
  mcp/dist mcp/src mcp/package.json mcp/pnpm-lock.yaml mcp/tsconfig.json

echo "[3/5] Uploading..."
gcloud compute scp --zone=$ZONE /tmp/wog-shard.tar.gz $INSTANCE:/tmp/wog-shard.tar.gz
gcloud compute scp --zone=$ZONE /tmp/wog-mcp.tar.gz $INSTANCE:/tmp/wog-mcp.tar.gz

# Extract and install on VM
echo "[4/5] Extracting and installing deps..."
gcloud compute ssh $INSTANCE --zone=$ZONE --command="\
  sudo install -d -o $PM2_RUNTIME_USER -g $PM2_RUNTIME_USER $REMOTE_DIR && \
  sudo tar xzf /tmp/wog-shard.tar.gz -C $REMOTE_DIR --no-same-owner --no-same-permissions 2>/dev/null && \
  sudo tar xzf /tmp/wog-mcp.tar.gz -C $REMOTE_DIR --no-same-owner --no-same-permissions 2>/dev/null && \
  sudo find $REMOTE_DIR -name '._*' -delete 2>/dev/null || true && \
  sudo chown -R $PM2_RUNTIME_USER:$PM2_RUNTIME_USER $REMOTE_DIR 2>/dev/null || true && \
  rm /tmp/wog-shard.tar.gz /tmp/wog-mcp.tar.gz && \
  sudo -iu $PM2_RUNTIME_USER env PM2_HOME=$PM2_RUNTIME_HOME bash -lc 'cd $REMOTE_DIR/shard && pnpm install --frozen-lockfile --prod && cd $REMOTE_DIR/mcp && pnpm install --frozen-lockfile --prod'"

# Restart PM2
echo "[5/5] Restarting PM2..."
gcloud compute ssh $INSTANCE --zone=$ZONE --command="\
  sudo -iu $PM2_RUNTIME_USER env PM2_HOME=$PM2_RUNTIME_HOME bash -lc 'cd $REMOTE_DIR && \
    (RUN_BLOCKCHAIN_WORKERS=false pm2 restart wog-mmorpg --update-env 2>/dev/null || RUN_BLOCKCHAIN_WORKERS=false pm2 restart wog-shard --update-env 2>/dev/null || RUN_BLOCKCHAIN_WORKERS=false pm2 start $REMOTE_DIR/dist/server.js --name wog-mmorpg --cwd $REMOTE_DIR) && \
    (RUN_BLOCKCHAIN_WORKERS=true pm2 restart wog-blockchain-worker --update-env 2>/dev/null || RUN_BLOCKCHAIN_WORKERS=true pm2 start $REMOTE_DIR/dist/blockchainWorker.js --name wog-blockchain-worker --cwd $REMOTE_DIR) && \
    (pm2 restart wog-mcp 2>/dev/null || pm2 start $REMOTE_DIR/mcp/dist/index.js --name wog-mcp --cwd $REMOTE_DIR/mcp) && \
    pm2 save' && \
  SHARD_ATTEMPT=1 && \
  until curl --max-time 20 -sf http://localhost:3000/health; do \
    if [ \$SHARD_ATTEMPT -ge 12 ]; then \
      echo 'Shard health check failed after 12 attempts'; \
      exit 1; \
    fi; \
    echo \"waiting for shard health (\$SHARD_ATTEMPT/12)\"; \
    SHARD_ATTEMPT=\$((SHARD_ATTEMPT + 1)); \
    sleep 5; \
  done && echo ' <- shard OK' && \
  WORKER_ATTEMPT=1 && \
  until curl --max-time 10 -sf http://localhost:3002/health; do \
    if [ \$WORKER_ATTEMPT -ge 12 ]; then \
      echo 'Blockchain worker health check failed after 12 attempts'; \
      exit 1; \
    fi; \
    echo \"waiting for blockchain worker health (\$WORKER_ATTEMPT/12)\"; \
    WORKER_ATTEMPT=\$((WORKER_ATTEMPT + 1)); \
    sleep 5; \
  done && echo ' <- blockchain worker OK' && \
  MCP_ATTEMPT=1 && \
  until curl --max-time 10 -sf http://localhost:3001/health; do \
    if [ \$MCP_ATTEMPT -ge 12 ]; then \
      echo 'MCP health check failed after 12 attempts'; \
      exit 1; \
    fi; \
    echo \"waiting for MCP health (\$MCP_ATTEMPT/12)\"; \
    MCP_ATTEMPT=\$((MCP_ATTEMPT + 1)); \
    sleep 5; \
  done && echo ' <- MCP OK' && \
  echo 'Both servers healthy!' && \
  echo '--- Port sanity check ---' && \
  PM2_JSON=\$(sudo -iu $PM2_RUNTIME_USER env PM2_HOME=$PM2_RUNTIME_HOME pm2 jlist 2>/dev/null) && \
  SHARD_PM2_PID=\$(printf '%s' \"\$PM2_JSON\" | node -e 'let d=\"\";process.stdin.on(\"data\",c=>d+=c).on(\"end\",()=>{const a=JSON.parse(d);const p=a.find(x=>x.name===\"wog-mmorpg\"||x.name===\"wog-shard\");process.stdout.write(String(p?.pid||\"\"))})') && \
  MCP_PM2_PID=\$(printf '%s' \"\$PM2_JSON\" | node -e 'let d=\"\";process.stdin.on(\"data\",c=>d+=c).on(\"end\",()=>{const a=JSON.parse(d);const p=a.find(x=>x.name===\"wog-mcp\");process.stdout.write(String(p?.pid||\"\"))})') && \
  SHARD_PORT_PID=\$(sudo fuser 3000/tcp 2>/dev/null | awk '{print \$1}') && \
  MCP_PORT_PID=\$(sudo fuser 3001/tcp 2>/dev/null | awk '{print \$1}') && \
  echo \"pm2 shard pid=\$SHARD_PM2_PID  port 3000 owner=\$SHARD_PORT_PID\" && \
  echo \"pm2 mcp pid=\$MCP_PM2_PID  port 3001 owner=\$MCP_PORT_PID\" && \
  if [ -n \"\$SHARD_PM2_PID\" ] && [ -n \"\$MCP_PM2_PID\" ] && [ -n \"\$SHARD_PORT_PID\" ] && [ -n \"\$MCP_PORT_PID\" ] && [ \"\$SHARD_PM2_PID\" = \"\$SHARD_PORT_PID\" ] && [ \"\$MCP_PM2_PID\" = \"\$MCP_PORT_PID\" ]; then \
    echo '✓ Ports 3000 and 3001 are owned by the canonical PM2 runtime'; \
  else \
    echo '⚠ WARNING: one or more ports are not owned by the canonical PM2 runtime'; \
    exit 1; \
  fi"

rm /tmp/wog-shard.tar.gz /tmp/wog-mcp.tar.gz 2>/dev/null || true

echo ""
echo "=== Deploy complete ==="
