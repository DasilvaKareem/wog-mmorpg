#!/bin/bash
# Aurelia Dawnstrider — Boot & Play
#
# Usage:
#   ./scripts/aurelia-dawnstrider/setup.sh           # Re-deploy (new JWT) + run mine-craft-sell
#   ./scripts/aurelia-dawnstrider/setup.sh --reuse    # Reuse existing JWT from credentials.json
#
# This script:
#   1. Deploys (or reuses) the agent to get a fresh JWT
#   2. Exports env vars for the game scripts
#   3. Runs the mine-craft-sell pipeline

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CREDS_FILE="$SCRIPT_DIR/credentials.json"
SHARD_URL="${SHARD_URL:-https://wog.urbantech.dev}"

# ── Deploy or reuse ─────────────────────────────────────────────────

if [[ "${1:-}" == "--reuse" ]] && [[ -f "$CREDS_FILE" ]]; then
  echo "♻️  Reusing existing credentials from $CREDS_FILE"
  JWT=$(python3 -c "import json; print(json.load(open('$CREDS_FILE'))['credentials']['jwtToken'])")
  WALLET=$(python3 -c "import json; print(json.load(open('$CREDS_FILE'))['credentials']['walletAddress'])")
  ENTITY=$(python3 -c "import json; print(json.load(open('$CREDS_FILE'))['gameState']['entityId'])")
  ZONE=$(python3 -c "import json; print(json.load(open('$CREDS_FILE'))['gameState']['zoneId'])")
else
  echo "🚀 Deploying Aurelia Dawnstrider..."
  RESPONSE=$(curl -s -X POST "$SHARD_URL/x402/deploy" \
    -H "Content-Type: application/json" \
    -d '{
      "agentName": "ClaudeExplorer",
      "character": { "name": "Aurelia Dawnstrider", "race": "elf", "class": "ranger" },
      "payment": { "method": "free" },
      "deployment_zone": "village-square",
      "metadata": { "source": "claude-code", "version": "2.0" }
    }')

  # Check for success
  SUCCESS=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('success', False))" 2>/dev/null)
  if [[ "$SUCCESS" != "True" ]]; then
    echo "❌ Deploy failed:"
    echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
    exit 1
  fi

  # Extract credentials
  JWT=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['credentials']['jwtToken'])")
  WALLET=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['credentials']['walletAddress'])")
  ENTITY=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['gameState']['entityId'])")
  ZONE=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['gameState']['zoneId'])")

  # Save updated credentials
  echo "$RESPONSE" | python3 -c "
import json, sys
resp = json.load(sys.stdin)
creds = {
  'agentName': 'ClaudeExplorer',
  'character': resp['character'],
  'credentials': {
    'walletAddress': resp['credentials']['walletAddress'],
    'jwtToken': resp['credentials']['jwtToken'],
    'expiresIn': resp['credentials']['expiresIn']
  },
  'gameState': {
    'entityId': resp['gameState']['entityId'],
    'zoneId': resp['gameState']['zoneId'],
    'deploymentId': resp.get('deploymentId', '')
  },
  'professions': [],
  'a2a': resp.get('a2a', {})
}
json.dump(creds, open('$CREDS_FILE', 'w'), indent=2)
print('✅ Credentials saved to $CREDS_FILE')
"
fi

echo ""
echo "Character: Aurelia Dawnstrider (Elf Ranger)"
echo "Wallet:    ${WALLET:0:20}..."
echo "Entity:    $ENTITY"
echo "Zone:      $ZONE"
echo ""

# ── Export env and run ───────────────────────────────────────────────

export JWT WALLET_ADDRESS="$WALLET" ENTITY_ID="$ENTITY" ZONE_ID="$ZONE" SHARD_URL

echo "⛏️  Running mine-craft-sell pipeline..."
echo ""
npx tsx "$SCRIPT_DIR/../mine-craft-sell.ts"
