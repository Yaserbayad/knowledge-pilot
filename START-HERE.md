# Start or upgrade Knowledge Pilot 1.4.1

Version 1.4.1 keeps the guided topic-lesson experience and lets learners attach or replace a private book PDF or ebook at any time. Active reading progress is preserved, while books waiting for source analysis are automatically re-queued. Existing `.env`, users, private links, Telegram links, plans, lessons, books, sessions, progress, and uploaded files are preserved. State remains on schema version 5.

## Safe upgrade

1. Identify the exact process that serves Knowledge Pilot. Do not assume the current shell user’s PM2 registry owns it.
2. Back up `.env` and the complete `data/` directory.
3. Stop only the confirmed Knowledge Pilot process.
4. Replace application files while preserving `.env` and `data/`.
5. Install dependencies, validate, and restart the same process manager.

```bash
cd /www/wwwroot/knowledgepilot
cp .env /tmp/knowledgepilot.env.$(date +%s)
tar -czf /tmp/knowledgepilot-data-$(date +%F-%H%M%S).tar.gz data
```

Copy the package from a temporary directory:

```bash
rsync -a --delete \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='node_modules/' \
  /tmp/knowledgepilot-1.4.1/ /www/wwwroot/knowledgepilot/
```

Then:

```bash
cd /www/wwwroot/knowledgepilot
npm install --omit=dev
node scripts/verify-config.js
npm run check
```

Set ownership to the actual runtime user, for example:

```bash
chown -R www:www /www/wwwroot/knowledgepilot
chmod 600 .env
find data -type d -exec chmod 750 {} \;
find data -type f -exec chmod 640 {} \;
```

Restart through the same aaPanel, systemd, or PM2 service that owned the process before the upgrade.

## Verify

```bash
curl -fsS https://YOUR_DOMAIN/health
curl -fsS https://YOUR_DOMAIN/gpt-action/openapi.json | grep '1.4.1'
```

Reimport the GPT Action schema and replace the custom GPT instructions with `docs/CUSTOM_GPT_INSTRUCTIONS.md`.

## Smoke test

1. Open an existing private learner link.
2. Confirm the learner settings show automatic scheduling enabled.
3. Approve a weekly plan or book plan.
4. Process the resulting custom-GPT task.
5. Confirm validated content schedules automatically.
6. Confirm held content appears in the learner dashboard with **Accept and schedule**, **Request changes**, and **Skip**.
7. Confirm Telegram receives either the content or an action-required notice.
8. Confirm Admin is not needed for the normal lifecycle.

See [UPGRADE-1.4.1.md](UPGRADE-1.4.1.md) for the current deployment and rollback procedure.
