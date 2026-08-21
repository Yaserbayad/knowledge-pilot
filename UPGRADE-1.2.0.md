# Upgrade to Knowledge Pilot 1.2.0

This upgrade preserves existing users, private links, Telegram links, lessons, plans, progress, settings, themes, and configuration. The JSON store migrates automatically to schema version 3 on startup.

## 1. Back up and stop

```bash
cd /www/wwwroot/knowledgepilot
pm2 stop knowledge-pilot 2>/dev/null || true
cp .env /tmp/knowledgepilot.env.$(date +%s)
tar -czf /tmp/knowledgepilot-data-$(date +%F-%H%M%S).tar.gz data
cp -a public /tmp/knowledgepilot-public-$(date +%F-%H%M%S)
```

If aaPanel manages the process directly, stop it from the Node Project screen instead of PM2.

## 2. Replace application files

Extract the 1.2.0 package into a temporary directory, then copy all application files except `.env` and `data/` into the existing project.

Example:

```bash
rsync -a --delete \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='node_modules/' \
  /tmp/knowledge-pilot-v1.2.0/ /www/wwwroot/knowledgepilot/
```

## 3. Install new dependencies and directories

```bash
cd /www/wwwroot/knowledgepilot
npm install --omit=dev
mkdir -p data/backups data/cards data/book-files data/whatsapp-auth
```

Set ownership to the actual aaPanel Node project user. Example for `www`:

```bash
chown -R www:www /www/wwwroot/knowledgepilot
find data -type d -exec chmod 750 {} \;
find data -type f -exec chmod 640 {} \;
chmod 600 .env
```

## 4. Validate before start

```bash
node scripts/verify-config.js
npm test
find src scripts tests -name '*.js' -print0 | xargs -0 -n1 node --check
```

## 5. Update Nginx upload limit

Set:

```nginx
client_max_body_size 35m;
proxy_read_timeout 180s;
```

Reload Nginx.

## 6. Start and verify

Restart from aaPanel or:

```bash
pm2 restart knowledge-pilot
```

Verify:

```bash
curl -fsS https://YOUR_DOMAIN/health
curl -fsS https://YOUR_DOMAIN/gpt-action/openapi.json | grep '1.2.0'
```

## 7. Update the custom GPT

1. Replace its Instructions with `docs/CUSTOM_GPT_INSTRUCTIONS.md`.
2. Delete and reimport the Action schema from `/gpt-action/openapi.json`.
3. Keep the same Bearer key.
4. In Preview, ask: `Check Knowledge Pilot for pending tasks.`

## 8. Functional smoke test

1. Open an existing learner link and verify previous data.
2. Open **Books** and add a nonfiction book.
3. Process the queued `book_analysis` task in the custom GPT.
4. Approve the generated duration and structure.
5. Process the queued first `book_session` task.
6. Review/schedule it in Admin and verify Telegram/web delivery.
7. Complete it, add a note/bookmark, and confirm progress updates.
