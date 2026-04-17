#!/bin/bash
# Run this script on the GCP VM to set up WoG MMORPG

set -e

APP_USER="${APP_USER:-preyanshu}"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
PM2_HOME="$APP_HOME/.pm2"

echo "🚀 WoG MMORPG Server Setup"
echo "=========================="

if [ -z "$APP_HOME" ]; then
  echo "❌ App user '$APP_USER' does not exist. Create it first or set APP_USER."
  exit 1
fi

# Update system
echo "📦 Updating system packages..."
sudo apt-get update -qq

# Install Node.js 20
echo "📦 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
echo "📦 Installing pnpm..."
sudo npm install -g pnpm

# Move code to /opt
echo "📁 Setting up application..."
sudo mkdir -p /opt/wog-mmorpg
sudo cp -r /tmp/wog-shard/* /opt/wog-mmorpg/
sudo chown -R $APP_USER:$APP_USER /opt/wog-mmorpg

# Create .env file
echo "📝 Creating production .env..."
sudo -iu $APP_USER bash -lc "cat > /opt/wog-mmorpg/.env << 'EOF'
THIRDWEB_SECRET_KEY=Vp7KuCl817FH2rCXi3NZTL91-pA6X5WvfsjRA_lhIFkGvoHgXd3Qq0ozMJ4e7kOPlbMXnOjpG4YSifuC2WU5Nw
SERVER_PRIVATE_KEY=0xc5a961559e58d5e386dc35335b1cc3d5be9eda8605f333576496247c977937f0
GOLD_CONTRACT_ADDRESS=0x421699e71bBeC7d05FCbc79C690afD5D8585f182
ITEMS_CONTRACT_ADDRESS=0xAe68cdA079fd699780506cc49381EE732837Ec35
CHARACTER_CONTRACT_ADDRESS=0x331dAdFFFFC8A126a739CA5CCAd847c29973B642
TRADE_CONTRACT_ADDRESS=0x74Ae909712bCa5D8828d5AF9a272a2F7Eb1886A6
AUCTION_HOUSE_CONTRACT_ADDRESS=0x1677d33f707F082E21F23821e3074e921b2c301e
GUILD_CONTRACT_ADDRESS=0x0FAd20d1052BC4327D0e07Aa3De64EEC6C3DfF39
GUILD_VAULT_CONTRACT_ADDRESS=0x71Fa28e9cA4f284A426e17c3E1aff0722D1eb215
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
REDIS_URL=redis://default:A5znjbd13vo1qdour4ss2fef84ce1jve4qr2iq158m9t4tjb7zd@redis-19091.crce262.us-east-1-1.ec2.cloud.redislabs.com:19091
EOF
"

# Install dependencies
echo "📦 Installing dependencies..."
sudo -iu $APP_USER bash -lc "cd /opt/wog-mmorpg && pnpm install --frozen-lockfile"

# Build TypeScript
echo "🔨 Building TypeScript..."
sudo -iu $APP_USER bash -lc "cd /opt/wog-mmorpg && pnpm run build" || echo "⚠️  Build had warnings but continuing..."

# Install PM2 for process management
echo "📦 Installing PM2..."
sudo npm install -g pm2

# Create PM2 ecosystem file
echo "📝 Creating PM2 config..."
sudo -iu $APP_USER bash -lc "cat > /opt/wog-mmorpg/ecosystem.config.js << 'EOFPM2'
module.exports = {
  apps: [{
    name: 'wog-mmorpg',
    script: 'dist/server.js',
    cwd: '/opt/wog-mmorpg',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
EOFPM2
"

# Start with PM2
echo "🚀 Starting server with PM2..."
sudo -iu $APP_USER env PM2_HOME=$PM2_HOME bash -lc "cd /opt/wog-mmorpg && pm2 start ecosystem.config.js && pm2 save"
sudo env PATH="$PATH" PM2_HOME="$PM2_HOME" pm2 startup systemd -u "$APP_USER" --hp "$APP_HOME"

echo ""
echo "✅ Setup complete!"
echo "Runtime owner: $APP_USER"
echo ""
echo "Your server is now running at:"
echo "  http://$(curl -s ifconfig.me):3000"
echo ""
echo "Useful commands:"
echo "  sudo -iu $APP_USER env PM2_HOME=$PM2_HOME pm2 logs wog-mmorpg   - View logs"
echo "  sudo -iu $APP_USER env PM2_HOME=$PM2_HOME pm2 status            - Check status"
echo "  sudo -iu $APP_USER env PM2_HOME=$PM2_HOME pm2 restart wog-mmorpg - Restart server"
echo "  sudo -iu $APP_USER env PM2_HOME=$PM2_HOME pm2 stop wog-mmorpg   - Stop server"
echo ""
