#!/bin/bash

# ========================================
# ClickDep Setup Script for Linux Mint
# ========================================

set -e

echo "╔═══════════════════════════════════════════════╗"
echo "║        🚀 ClickDep Setup Script               ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then
  echo "⚠️  Please run this script without sudo"
  exit 1
fi

# Check for Node.js/npm
if ! command -v npm &> /dev/null; then
  echo "📦 Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# Check for Git
if ! command -v git &> /dev/null; then
  echo "📦 Installing Git..."
  sudo apt-get install -y git
fi

# Install Bun
if ! command -v bun &> /dev/null; then
  echo "📦 Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

# Install PM2 globally
if ! command -v pm2 &> /dev/null; then
  echo "📦 Installing PM2..."
  sudo npm install -g pm2
fi

# Install serve globally (for static sites)
if ! command -v serve &> /dev/null; then
  echo "📦 Installing serve..."
  sudo npm install -g serve
fi

echo ""
echo "📁 Setting up ClickDep..."

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Install server dependencies
echo "📦 Installing server dependencies..."
cd server
bun install

# Install dashboard dependencies and build
echo "📦 Installing dashboard dependencies..."
cd ../dashboard
bun install
bun run build

# Create data directory
echo "📂 Creating data directory..."
mkdir -p ../data/repos
mkdir -p ../data/logs

# Go back to root
cd ..

# Setup PM2 startup
echo "⚙️  Configuring PM2 startup..."
pm2 startup systemd -u $USER --hp $HOME || true

echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║            ✅ Setup Complete!                 ║"
echo "╠═══════════════════════════════════════════════╣"
echo "║                                               ║"
echo "║  To start ClickDep:                           ║"
echo "║    cd $SCRIPT_DIR"
echo "║    pm2 start server/src/index.ts \\           ║"
echo "║        --interpreter ~/.bun/bin/bun \\        ║"
echo "║        --name clickdep                        ║"
echo "║                                               ║"
echo "║  Or use the start script:                     ║"
echo "║    ./start.sh                                 ║"
echo "║                                               ║"
echo "╚═══════════════════════════════════════════════╝"
