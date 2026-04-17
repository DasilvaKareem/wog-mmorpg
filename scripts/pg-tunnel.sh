#!/usr/bin/env bash
# Opens an SSH tunnel to the production Postgres DB on GCE.
# Leaves the tunnel running in the foreground — Ctrl+C to stop.
# Connect your GUI tool (Postico/TablePlus/DBeaver) to 127.0.0.1:5433.

set -euo pipefail

INSTANCE="instance-20260213-193154"
ZONE="us-central1-f"
LOCAL_PORT="5433"
REMOTE_HOST="10.119.0.3"
REMOTE_PORT="5432"

if lsof -iTCP:$LOCAL_PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $LOCAL_PORT is already in use. Close the other tunnel first, or edit LOCAL_PORT in this script."
  exit 1
fi

echo "Opening tunnel: 127.0.0.1:$LOCAL_PORT  →  $REMOTE_HOST:$REMOTE_PORT (via $INSTANCE)"
echo "Connect Postico to:"
echo "  Host:     127.0.0.1"
echo "  Port:     $LOCAL_PORT"
echo "  User:     wog"
echo "  Database: wog"
echo ""
echo "Password: run  gcloud compute ssh $INSTANCE --zone=$ZONE --command='grep DATABASE_URL /opt/wog-mmorpg/.env'"
echo ""
echo "Ctrl+C to stop the tunnel."
echo ""

exec gcloud compute ssh "$INSTANCE" --zone="$ZONE" -- -N -L "$LOCAL_PORT:$REMOTE_HOST:$REMOTE_PORT"
