# WoG Agent Runbook: Import + Deploy (Latest Code Only)

Use this guide when you want a clean, repeatable deployment path:
- test import locally with Docker Postgres/Redis
- verify shard + worker + MCP
- deploy to VM from a user-selected Git branch
- avoid duplicate PM2 processes

## 0) Rules Before You Start

1. Always use the latest code from the same branch for:
   - `shard/`
   - `mcp/`
   - `client/`
   - `client-xr/`
2. Do not mix old shard with new client (or vice versa).
3. Keep `RUN_BACKGROUND_WORKERS=true` in shard runtime so reconciliation stays active.
4. Never leave duplicate PM2 processes running.

---

## 1) Local Prep (Mainnet Config + Docker DB/Redis)

From repo root:

```bash
cd /home/preyanshu/wog-mmorpg
docker compose up -d postgres redis
```

Use local DB/cache in `shard/.env`:

```env
DATABASE_URL=postgresql://wog:wog@127.0.0.1:5432/wog
REDIS_URL=redis://127.0.0.1:6379
SHARD_CHAIN_ENV=mainnet
RUN_BACKGROUND_WORKERS=true
```

Optional but recommended for separate blockchain worker process:

```env
RUN_BLOCKCHAIN_WORKERS=false
```

(`RUN_BLOCKCHAIN_WORKERS=false` on shard server process, and `true` on worker process.)

---

## 2) Hard Reset Local Data Stores (Must Be Empty First)

```bash
docker exec wog-redis redis-cli FLUSHALL
docker exec -e PGPASSWORD=wog wog-postgres psql -U wog -d wog -c "DROP SCHEMA IF EXISTS game CASCADE;"
```

Verify empty:

```bash
docker exec wog-redis redis-cli DBSIZE
# expected: 0
```

---

## 3) Import Prod Player Export + Live Sessions into Postgres

From `shard/`:

```bash
cd /home/preyanshu/wog-mmorpg/shard
npx tsx scripts/importPlayerExportToPostgres.ts data/exports/prod-redis-player-export-2026-04-12T20-03-47.437Z.json --include-registered-wallets
npx tsx scripts/importLiveSessionsToPostgres.ts data/exports/prod-redis-live-sessions-2026-04-13T17-13-42.284Z.json
```

Quick verification:

```bash
docker exec -e PGPASSWORD=wog wog-postgres psql -U wog -d wog -At -c \
"select 'characters',count(*) from game.characters
 union all
 select 'live_sessions',count(*) from game.live_sessions
 union all
 select 'crafted_item_instances',count(*) from game.crafted_item_instances;"
```

Note: keep Redis empty unless you intentionally want cache warmup.

---

## 4) Run Local Shard + Worker + MCP (Smoke Test)

Build:

```bash
cd /home/preyanshu/wog-mmorpg/shard && pnpm install && pnpm build
cd /home/preyanshu/wog-mmorpg/mcp && pnpm install && pnpm build
```

Start (separate terminals or PM2):

```bash
# terminal 1: shard API (workers enabled)
cd /home/preyanshu/wog-mmorpg/shard
RUN_BACKGROUND_WORKERS=true RUN_BLOCKCHAIN_WORKERS=false node dist/server.js

# terminal 2: blockchain worker
cd /home/preyanshu/wog-mmorpg/shard
RUN_BLOCKCHAIN_WORKERS=true node dist/blockchainWorker.js

# terminal 3: MCP
cd /home/preyanshu/wog-mmorpg/mcp
node dist/index.js
```

Health checks:

```bash
curl -sf http://127.0.0.1:3000/health
curl -sf http://127.0.0.1:3002/health
curl -sf http://127.0.0.1:3001/health
```

---

## 5) VM Deploy (Ask User Branch First)

On your machine before SSH:

```bash
read -rp "Enter branch to deploy (ask user first): " BRANCH
echo "Deploying branch: $BRANCH"
```

SSH into VM:

```bash
gcloud compute ssh instance-20260213-193154 --zone=us-central1-f
```

On VM, update code to selected branch:

```bash
cd /opt/wog-mmorpg
git fetch --all --prune
git checkout "$BRANCH"
git pull origin "$BRANCH"
```

Install + build latest `shard` and `mcp`:

```bash
cd /opt/wog-mmorpg/shard && pnpm install --frozen-lockfile && pnpm build
cd /opt/wog-mmorpg/mcp && pnpm install --frozen-lockfile && pnpm build
```

---

## 6) PM2 Safe Restart (No Duplicates)

Delete old process names first:

```bash
pm2 delete wog-mmorpg 2>/dev/null || true
pm2 delete wog-shard 2>/dev/null || true
pm2 delete wog-blockchain-worker 2>/dev/null || true
pm2 delete wog-mcp 2>/dev/null || true
```

Start canonical processes:

```bash
cd /opt/wog-mmorpg
RUN_BACKGROUND_WORKERS=true RUN_BLOCKCHAIN_WORKERS=false pm2 start shard/dist/server.js --name wog-mmorpg --cwd /opt/wog-mmorpg/shard
RUN_BLOCKCHAIN_WORKERS=true pm2 start shard/dist/blockchainWorker.js --name wog-blockchain-worker --cwd /opt/wog-mmorpg/shard
pm2 start mcp/dist/index.js --name wog-mcp --cwd /opt/wog-mmorpg/mcp
pm2 save
pm2 status
```

Confirm env:

```bash
pm2 env wog-mmorpg | grep -E "RUN_BACKGROUND_WORKERS|RUN_BLOCKCHAIN_WORKERS" || true
pm2 env wog-blockchain-worker | grep RUN_BLOCKCHAIN_WORKERS || true
```

---

## 7) Post-Deploy Verification

```bash
curl -sf http://127.0.0.1:3000/health
curl -sf http://127.0.0.1:3002/health
curl -sf http://127.0.0.1:3001/health
```

Check ports belong to PM2 processes:

```bash
sudo fuser 3000/tcp 3001/tcp 3002/tcp
pm2 jlist | jq 'map({name, pid, pm2_env: {status: .pm2_env.status}})'
```

If unhealthy:

```bash
pm2 logs wog-mmorpg --lines 120 --nostream
pm2 logs wog-blockchain-worker --lines 120 --nostream
pm2 logs wog-mcp --lines 120 --nostream
```

---

## 8) Client Consistency Check (Latest Client + XR)

After backend deploy, verify both clients are on matching latest branch build:

```bash
cd /opt/wog-mmorpg/client && pnpm install --frozen-lockfile && pnpm build
cd /opt/wog-mmorpg/client-xr && pnpm install --frozen-lockfile && pnpm build
```

If you run client servers from VM, restart their PM2 apps with the same delete-then-start pattern.

---

## 9) One-Page Checklist

1. Ask user branch.
2. Pull that branch on VM.
3. Build shard + mcp.
4. Delete old PM2 apps.
5. Start `wog-mmorpg`, `wog-blockchain-worker`, `wog-mcp`.
6. Ensure `RUN_BACKGROUND_WORKERS=true`.
7. Confirm `/health` on `3000`, `3001`, `3002`.
8. Confirm no duplicate processes/ports.
9. Confirm clients are built from the same latest branch.
