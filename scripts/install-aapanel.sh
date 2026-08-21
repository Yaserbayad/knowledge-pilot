#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/www/wwwroot/knowledgepilot}"
cd "$APP_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node.js 24 LTS from aaPanel first." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(`.`)[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22 or newer is required; Node.js 24 LTS is recommended." >&2
  exit 1
fi

if [ ! -f package-lock.json ]; then
  echo "package-lock.json is required for a reproducible deployment." >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo ".env is required. Refusing to create or guess production configuration." >&2
  exit 1
fi

npm ci --omit=dev --ignore-scripts
mkdir -p data/backups data/cards data/book-files data/whatsapp-auth
chmod 700 data data/backups data/cards data/book-files data/whatsapp-auth
chmod 600 .env

node scripts/verify-config.js
npm run check

echo "Knowledge Pilot release preparation passed. Process manager configuration and running processes were left unchanged."
