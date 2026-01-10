#!/bin/bash

# ========================================
# ClickDep Start Script
# ========================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Starting ClickDep..."

# Ensure data directories exist
mkdir -p data/repos
mkdir -p data/logs
mkdir -p data/pids

# Start the server with Bun
cd server
exec bun run src/index.ts
