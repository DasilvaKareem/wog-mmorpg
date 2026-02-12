#!/bin/bash
# Setup Authentication System

echo "🔐 Setting up authentication system..."
echo ""

# Check if .env exists
if [ ! -f .env ]; then
  echo "❌ .env file not found!"
  exit 1
fi

# Check if JWT_SECRET already exists
if grep -q "JWT_SECRET=" .env; then
  echo "✅ JWT_SECRET already set in .env"
else
  echo "📝 Adding JWT_SECRET to .env..."

  # Generate a random 32-character secret
  SECRET=$(openssl rand -hex 32)
  echo "" >> .env
  echo "# JWT Authentication" >> .env
  echo "JWT_SECRET=$SECRET" >> .env

  echo "✅ JWT_SECRET added to .env"
fi

echo ""
echo "🧪 Testing authentication system..."
echo ""

# Test the auth system
pnpm exec tsx src/authHelper.ts

if [ $? -eq 0 ]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║           ✅ AUTHENTICATION SYSTEM READY!                    ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  echo "Next steps:"
  echo "1. Read AUTHENTICATION.md for full documentation"
  echo "2. Protect your endpoints by adding authenticateRequest middleware"
  echo "3. Update your agents to use authenticated API calls"
  echo ""
else
  echo ""
  echo "❌ Authentication test failed"
  echo "Check the error above and try again"
  exit 1
fi
