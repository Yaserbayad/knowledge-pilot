#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/www/wwwroot/knowledge-pilot}"
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

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env. Edit it before starting the service." >&2
fi

npm install --omit=dev
mkdir -p data/backups data/cards data/book-files data/whatsapp-auth
chmod 700 data data/backups data/cards data/book-files data/whatsapp-auth
chmod 600 .env

if command -v pm2 >/dev/null 2>&1; then
  pm2 start ecosystem.config.cjs
  pm2 save
  echo "Knowledge Pilot started with PM2."
else
  echo "PM2 is not installed. In aaPanel Node Project, set startup file to src/index.js." >&2
fi
