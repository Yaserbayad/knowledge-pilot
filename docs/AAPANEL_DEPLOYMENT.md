# aaPanel deployment — Knowledge Pilot 1.3.0

## Requirements

- Ubuntu 22.04/24.04 or comparable Linux
- aaPanel site with valid HTTPS
- Node.js 22 or newer
- aaPanel Node Project Manager **or** one PM2/systemd service
- At least 1 GB free disk, plus space for owned book files and backups

## Fresh installation

```bash
cd /www/wwwroot/knowledgepilot
cp .env.example .env
node scripts/generate-secrets.js
nano .env
npm install --omit=dev
mkdir -p data/backups data/cards data/book-files data/whatsapp-auth
node scripts/verify-config.js
npm run check
```

Set ownership to the actual runtime account. Example:

```bash
chown -R www:www /www/wwwroot/knowledgepilot
chmod 600 .env
find data -type d -exec chmod 750 {} \;
find data -type f -exec chmod 640 {} \;
```

## Recommended `.env`

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3100
APP_BASE_URL=https://learn.example.com
AI_PROVIDER=chatgpt_business
GPT_ACTIONS_ENABLED=true
GPT_AUTO_SCHEDULE_APPROVED=true
GPT_AUTO_SCHEDULE_DELAY_MINUTES=2
GPT_TASK_CLAIM_TIMEOUT_MINUTES=30
GPT_NOTIFY_PENDING_TASKS=true
AUTO_START_FIRST_PLAN=true
NOTIFY_ACTION_REQUIRED=true
UNFINISHED_ITEM_LIMIT=3
CUSTOM_GPT_URL=https://chatgpt.com/g/...
```

## aaPanel Node project

| Field | Value |
|---|---|
| Project path | `/www/wwwroot/knowledgepilot` |
| Project name | `knowledge-pilot` |
| Start command | `npm start` |
| Entry point | `src/index.js` |
| Port | `3100` |
| Instances | `1` |
| Run user | `www` or another restricted project user |

Do not start a second PM2 process when aaPanel already owns the project. Knowledge Pilot’s JSON database is designed for one application instance.

## Confirm which process owns the service

An empty `pm2 status` under your SSH account does not prove the app is stopped; PM2 registries are per user. Use:

```bash
ps -eo user,pid,ppid,lstart,cmd | grep -E 'node|knowledgepilot' | grep -v grep
sudo ss -ltnp | grep -E 'node|:3100'
```

For each candidate PID:

```bash
sudo readlink -f /proc/PID/cwd
sudo tr '\0' ' ' < /proc/PID/cmdline; echo
sudo cat /proc/PID/cgroup
```

The correct Knowledge Pilot process has working directory `/www/wwwroot/knowledgepilot` and command `node src/index.js`. Remove or separately identify unrelated `node server.js` processes before deployment.

## Reverse proxy

Proxy the HTTPS domain to `http://127.0.0.1:3100`:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_http_version 1.1;
proxy_read_timeout 180s;
client_max_body_size 35m;
```

Force HTTPS.

## Verification

```bash
curl -fsS https://learn.example.com/health
curl -fsS https://learn.example.com/gpt-action/openapi.json | grep '1.3.0'
```

Open `/admin` with `ADMIN_TOKEN` and confirm the scheduler is ticking and no unexpected failed jobs exist.

## Telegram

1. Create a bot with BotFather.
2. Set `TELEGRAM_ENABLED=true` and `TELEGRAM_BOT_TOKEN`.
3. Restart the confirmed Knowledge Pilot service.
4. Verify the webhook and link the learner from the private dashboard.

Telegram delivers lessons/book sessions and action-required notices. Review notices include learner-owned **Accept and schedule** and **Skip** actions.

## WhatsApp Web

Optional and unofficial:

```dotenv
WHATSAPP_ENABLED=true
WHATSAPP_DEDICATED_NUMBER=32470123456
```

Restart, pair through Linked Devices, and use only for opted-in low-volume delivery.

## Custom GPT

1. Replace Instructions with `docs/CUSTOM_GPT_INSTRUCTIONS.md`.
2. Delete and reimport `https://YOUR_DOMAIN/gpt-action/openapi.json`.
3. Keep Bearer authentication using `GPT_ACTION_API_KEY`.
4. Test with `Check Knowledge Pilot for pending tasks.`

## Upgrade

Follow [../UPGRADE-1.3.0.md](../UPGRADE-1.3.0.md). Preserve `.env` and all of `data/`.

## Full-data backups

Built-in backups cover JSON state. Add an aaPanel cron job for the complete data directory:

```bash
mkdir -p /www/backup/knowledge-pilot
tar -czf /www/backup/knowledge-pilot/data-$(date +%F-%H%M%S).tar.gz \
  -C /www/wwwroot/knowledgepilot data
find /www/backup/knowledge-pilot -name 'data-*.tar.gz' -mtime +30 -delete
```

Keep a second encrypted off-server copy when owned books matter.

## Common problems

- **HTTP 413:** set `client_max_body_size 35m` and reload Nginx.
- **Data directory not writable:** correct ownership for the runtime user.
- **No Telegram delivery:** verify binding, webhook, and that the item is scheduled/delivered rather than held.
- **Today is empty:** inspect learner workflow counts for review holds, queued GPT tasks, and future generation jobs.
- **PM2 shows nothing:** inspect processes by PID and user; do not start a duplicate service.
- **PDF/EPUB extraction unavailable:** run `npm install --omit=dev` and restart.
