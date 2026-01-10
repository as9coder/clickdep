#!/bin/bash

# ========================================
# ClickDep Start Script
# ========================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if already running
if pm2 list | grep -q "clickdep"; then
  echo "🔄 Restarting ClickDep..."
  pm2 restart clickdep
else
  echo "🚀 Starting ClickDep..."
  pm2 start server/src/index.ts \
    --interpreter ~/.bun/bin/bun \
    --name clickdep \
    --time
fi

# Save PM2 process list
pm2 save

# Show logs
pm2 logs clickdep --lines 20
