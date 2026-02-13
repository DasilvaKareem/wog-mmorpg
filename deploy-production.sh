#!/bin/bash
set -e

echo "🚀 WoG MMORPG Production Deployment Script"
echo "=========================================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if fly CLI is installed
if ! command -v fly &> /dev/null; then
    echo -e "${RED}❌ Fly CLI not found. Install: https://fly.io/docs/hands-on/install-flyctl/${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Fly CLI found${NC}"

# Check if logged in
if ! fly auth whoami &> /dev/null; then
    echo -e "${YELLOW}⚠️  Not logged in to Fly.io${NC}"
    echo "Running: fly auth login"
    fly auth login
fi

echo -e "${GREEN}✅ Logged in to Fly.io${NC}"

# Check if .env exists
if [ ! -f "shard/.env" ]; then
    echo -e "${RED}❌ shard/.env not found${NC}"
    exit 1
fi

echo -e "${YELLOW}⚠️  IMPORTANT: Secrets Check${NC}"
echo ""
echo "Make sure you've set production secrets with:"
echo ""
echo "  fly secrets set \\"
echo "    THIRDWEB_SECRET_KEY='your-prod-key' \\"
echo "    SERVER_PRIVATE_KEY='your-prod-wallet' \\"
echo "    JWT_SECRET='\$(openssl rand -hex 32)' \\"
echo "    ENCRYPTION_KEY='\$(openssl rand -hex 32)' \\"
echo "    STRIPE_SECRET_KEY='sk_live_xxx'"
echo ""
read -p "Have you set production secrets? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}❌ Please set secrets first${NC}"
    exit 1
fi

# Check if Redis is configured
echo ""
echo -e "${YELLOW}⚠️  Redis Check${NC}"
read -p "Have you created Fly Redis? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "Create Redis with:"
    echo "  fly redis create wog-redis --region sjc"
    echo ""
    echo "Then set the REDIS_URL secret:"
    echo "  fly secrets set REDIS_URL='redis://...'"
    echo ""
    read -p "Continue without Redis? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
    echo -e "${YELLOW}⚠️  Continuing without Redis (wallets will be in-memory)${NC}"
fi

# Deploy shard server
echo ""
echo -e "${GREEN}📦 Deploying shard server...${NC}"
cd shard

# Build first
echo "Building TypeScript..."
pnpm run build

# Deploy to Fly.io
echo "Deploying to Fly.io..."
fly deploy

cd ..

# Check health
echo ""
echo -e "${GREEN}🏥 Checking deployment health...${NC}"
sleep 5

HEALTH=$(curl -s https://wog-mmorpg.fly.dev/health || echo "failed")
if [[ $HEALTH == *"ok"* ]]; then
    echo -e "${GREEN}✅ Deployment successful!${NC}"
    echo ""
    echo "🎮 Your game is live at: https://wog-mmorpg.fly.dev"
    echo ""
    echo "Test endpoints:"
    echo "  Health:    curl https://wog-mmorpg.fly.dev/health"
    echo "  X402 Info: curl https://wog-mmorpg.fly.dev/x402/info"
    echo ""
    echo "View logs:   fly logs -a wog-mmorpg"
    echo "SSH:         fly ssh console -a wog-mmorpg"
else
    echo -e "${RED}❌ Deployment may have issues${NC}"
    echo "Check logs: fly logs -a wog-mmorpg"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ All done!${NC}"
