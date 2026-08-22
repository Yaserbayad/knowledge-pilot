#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/www/wwwroot/knowledgepilot}"

if [ ! -d "$APP_DIR" ]; then
  echo "Knowledge Pilot directory not found: $APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install a supported Node.js release in aaPanel first." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(`.`)[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22 or newer is required. Node.js 24 LTS is recommended." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required." >&2
  exit 1
fi

if [ ! -f package-lock.json ]; then
  echo "package-lock.json is required for a reproducible deployment." >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo ".env is missing. Copy it from the existing production runtime or create it from .env.example, then add real secrets." >&2
  exit 1
fi

# Install the full locked dependency graph first so the complete current test
# suite can use future devDependencies without changing the deployment engine.
npm ci --ignore-scripts

mkdir -p data data/cards data/backups data/book-files data/whatsapp-auth
chmod 700 data data/cards data/backups data/book-files data/whatsapp-auth
chmod 600 .env

node scripts/verify-config.js
npm run check
npm audit --omit=dev --audit-level=high

# Only after verification succeeds, prepare the production dependency tree.
npm ci --omit=dev --ignore-scripts

cat <<'MSG'

Knowledge Pilot release preparation passed.
This script intentionally does not start or mutate a process manager.
For aaPanel production deployment, use the canonical docs/AAPANEL_DEPLOYMENT.md procedure or the installed deploy-knowledge-pilot command.
MSG
