#!/usr/bin/env bash
set -euo pipefail

# Pull terrain JSONs from the production VM back into the local repo.
# Run this after editing the world via https://worldofgeneva.com/map/ and
# clicking "Save to Shard" — it syncs the VM's on-disk terrain files into
# world/content/terrain/ so they survive the next deploy and can be
# committed to git.

INSTANCE="instance-20260213-193154"
ZONE="us-central1-f"
REMOTE_DIR="/opt/wog-mmorpg"
LOCAL_DIR="world/content/terrain"

cd "$(dirname "$0")"
mkdir -p "$LOCAL_DIR"

echo "==> Pulling terrain from $INSTANCE:$REMOTE_DIR/$LOCAL_DIR/ → $LOCAL_DIR/"
gcloud compute scp --zone="$ZONE" --recurse \
  "$INSTANCE:$REMOTE_DIR/$LOCAL_DIR/*.json" "$LOCAL_DIR/"

echo ""
echo "==> Done. Review with: git status $LOCAL_DIR"
