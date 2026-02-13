#!/bin/bash
# WoG MMORPG - Google Cloud VM Deployment Script

set -e

echo "🚀 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "📦 Installing pnpm..."
sudo npm install -g pnpm

echo "📁 Creating app directory..."
sudo mkdir -p /opt/wog-mmorpg
sudo chown $USER:$USER /opt/wog-mmorpg
cd /opt/wog-mmorpg

echo "📥 Waiting for code upload..."
echo "Now copy your code to this server"
