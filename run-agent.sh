#!/bin/bash
# Launch AI Agent - Autonomous MMORPG Player

cd "$(dirname "$0")/shard"

echo "🤖 Launching AI Agent Alpha..."
echo "================================"
echo ""

pnpm exec tsx src/aiAgent.ts
