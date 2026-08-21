# Knowledge Pilot 1.3.0 — Safe Deployment Checklist

This checklist upgrades `/www/wwwroot/knowledgepilot` while preserving secrets, learner data, private links, Telegram bindings, owned books, plans, sessions, and progress.

## 1. Upload the release archive

Upload `knowledgepilot-1.3.0-self-service.tar.gz` to `/tmp/` on the server.

Do not extract it over the live application yet.

## 2. Identify the actual live process manager

The earlier inspection showed two Node processes under `www` and an empty PM2 registry under the SSH user. Recheck because PIDs may have changed:

```bash
ps -eo user,pid,ppid,lstart,cmd | grep -E 'node|knowledgepilot' | grep -v grep
sudo ss -ltnp | grep -E 'node|:3100'
```

For every candidate PID:

```bash
sudo readlink -f /proc/PID/cwd
sudo tr '\0' ' ' < /proc/PID/cmdline; echo
sudo cat /proc/PID/cgroup
```

The Knowledge Pilot process should have:

```text
working directory: /www/wwwroot/knowledgepilot
command: node src/index.js
```

Use the same aaPanel, systemd, supervisor, or PM2 owner that started that process. Do not start another instance. Separately identify `node server.js`; do not stop it unless its working directory proves it belongs to an obsolete duplicate Knowledge Pilot deployment.

## 3. Create immutable pre-upgrade backups

```bash
stamp=$(date +%F-%H%M%S)
cd /www/wwwroot/knowledgepilot

sudo tar -czf "/tmp/knowledgepilot-data-$stamp.tar.gz" data
sudo tar -czf "/tmp/knowledgepilot-code-$stamp.tar.gz" \
  --exclude=node_modules \
  --exclude=data \
  --exclude=.env \
  .
sudo cp .env "/tmp/knowledgepilot-env-$stamp"
sudo chmod 600 "/tmp/knowledgepilot-env-$stamp"
```

Confirm all three files exist and are non-empty:

```bash
ls -lh /tmp/knowledgepilot-*"$stamp"*
```

Copy the backups off-server before continuing when the owned-book data is important.

## 4. Extract into a staging directory

```bash
sudo rm -rf /tmp/knowledgepilot-1.3.0-stage
sudo mkdir -p /tmp/knowledgepilot-1.3.0-stage
sudo tar -xzf /tmp/knowledgepilot-1.3.0-self-service.tar.gz \
  -C /tmp/knowledgepilot-1.3.0-stage

cat /tmp/knowledgepilot-1.3.0-stage/knowledgepilot/VERSION
```

Expected:

```text
1.3.0
```

Optional integrity check using the supplied checksum file:

```bash
cd /tmp
sha256sum -c knowledgepilot-1.3.0-self-service.sha256
```

## 5. Stop only the confirmed Knowledge Pilot service

Use the process manager identified in Step 2. Examples:

```bash
# aaPanel: stop the exact Node project in the panel

# systemd example only:
sudo systemctl stop knowledge-pilot

# PM2 example only, run as the confirmed PM2 owner:
sudo -u www -H pm2 stop knowledge-pilot
```

Verify port 3100 is no longer listening before copying code:

```bash
sudo ss -ltnp | grep ':3100' || true
```

## 6. Copy code without overwriting secrets or data

```bash
sudo rsync -a --delete \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='node_modules/' \
  /tmp/knowledgepilot-1.3.0-stage/knowledgepilot/ \
  /www/wwwroot/knowledgepilot/
```

Verify preservation:

```bash
cd /www/wwwroot/knowledgepilot
cat VERSION
sudo test -s .env
sudo test -s data/state.json
```

Expected version: `1.3.0`.

## 7. Install locked production dependencies

```bash
cd /www/wwwroot/knowledgepilot
sudo -u www -H npm ci --omit=dev
sudo -u www -H npm audit --omit=dev
```

Do not ignore an audit result without checking whether the vulnerable package and code path are used in production. Baileys is optional and unofficial; leave WhatsApp disabled unless required.

## 8. Validate the preserved configuration

Ensure these values are present or intentionally configured in `.env`:

```dotenv
AI_PROVIDER=chatgpt_business
GPT_ACTIONS_ENABLED=true
GPT_AUTO_SCHEDULE_APPROVED=true
GPT_AUTO_SCHEDULE_DELAY_MINUTES=2
GPT_TASK_CLAIM_TIMEOUT_MINUTES=30
GPT_NOTIFY_PENDING_TASKS=true
AUTO_START_FIRST_PLAN=true
NOTIFY_ACTION_REQUIRED=true
UNFINISHED_ITEM_LIMIT=3
SCHEDULER_ENABLED=true
SCHEDULER_POLL_SECONDS=30
JOB_RUN_TIMEOUT_MINUTES=15
MAX_JOB_ATTEMPTS=4
CUSTOM_GPT_URL=https://chatgpt.com/g/...
```

Run:

```bash
sudo -u www -H node scripts/verify-config.js
sudo -u www -H npm run check
```

Required result:

```text
verify-config: ok true
28 tests passed, 0 failed
```

## 9. Correct ownership and restrictive permissions

Use the confirmed runtime account; the observed account was `www`:

```bash
sudo chown -R www:www /www/wwwroot/knowledgepilot
sudo chmod 600 /www/wwwroot/knowledgepilot/.env
sudo find /www/wwwroot/knowledgepilot/data -type d -exec chmod 750 {} \;
sudo find /www/wwwroot/knowledgepilot/data -type f -exec chmod 640 {} \;
```

## 10. Restart exactly one application instance

Use the same manager from Step 2. Examples:

```bash
# aaPanel: start/restart the exact Node project

# systemd example only:
sudo systemctl start knowledge-pilot

# PM2 example only, as the confirmed owner:
sudo -u www -H pm2 start ecosystem.config.cjs
sudo -u www -H pm2 save
```

Confirm one Knowledge Pilot process and one listener:

```bash
ps -eo user,pid,ppid,lstart,cmd | grep -E 'node src/index.js|knowledgepilot' | grep -v grep
sudo ss -ltnp | grep ':3100'
```

## 11. Verify startup migration and reconciliation

```bash
curl -fsS https://k.hmgtr.com/health
curl -fsS https://k.hmgtr.com/gpt-action/openapi.json | grep '1.3.0'
```

Open `/admin` and confirm:

- Version 1.3.0
- scheduler enabled and producing a recent `lastTickAt`
- no unexpected failed local jobs
- pending GPT-task count is plausible
- existing held items are visible to their owning learners
- no duplicate Knowledge Pilot process exists

Startup reconciliation may create missing delivery jobs and action-required notices for legacy records. This is expected.

## 12. Update the custom GPT

1. Replace its instructions with `docs/CUSTOM_GPT_INSTRUCTIONS.md` from this release.
2. Delete the old Action schema.
3. Reimport `https://k.hmgtr.com/gpt-action/openapi.json`.
4. Keep Bearer authentication set to the existing `GPT_ACTION_API_KEY`.
5. Run:

```text
Check Knowledge Pilot for pending tasks.
```

Then process the queue once:

```text
Process all pending Knowledge Pilot tasks. Continue until the pending queue is empty. Report completed, held-for-review, and failed counts.
```

## 13. Controlled functional smoke test

Use a test learner or low-risk current learner.

### Automatic pass path

1. Approve a weekly plan or book plan.
2. Process the generated GPT task.
3. Confirm a quality-passed lesson/session automatically becomes scheduled.
4. Confirm it appears in Today/Reading at delivery time.
5. Confirm Telegram receives it without Admin intervention.

### Held-content path

1. Use or create a `needs_review` lesson/session.
2. Confirm **Needs your review** appears in the learner dashboard.
3. Confirm Telegram sends an action-required message.
4. Select **Accept and schedule** from the learner side.
5. Confirm scheduling and delivery occur without Admin.
6. Test **Request changes** and verify a revision task is queued.
7. Test **Skip** and verify no later reminder or reinforcement is sent.

### Security path

1. Open a generated card while signed in as its owner: expect 200.
2. Open it without a private learner session: expect 401.
3. Open it as another learner: expect 404.
4. Confirm learner book JSON contains upload metadata but no `originalPath` or `textPath`.

## 14. Observe for one full cycle

Monitor application logs, Admin operations, Today, and Telegram through at least:

- one automatic lesson delivery
- one book-session delivery
- one reminder cycle
- one custom-GPT task claim/submission

Check failed jobs and channel failures before declaring the upgrade complete.

## Rollback

1. Stop the confirmed Knowledge Pilot process.
2. Restore the code archive:

```bash
cd /www/wwwroot/knowledgepilot
sudo rm -rf public src scripts tests docs
sudo tar -xzf /tmp/knowledgepilot-code-TIMESTAMP.tar.gz -C /www/wwwroot/knowledgepilot
```

3. Restore `.env` only when necessary.
4. Restore the pre-upgrade `data/` archive only if state restoration is required:

```bash
cd /www/wwwroot/knowledgepilot
sudo rm -rf data
sudo tar -xzf /tmp/knowledgepilot-data-TIMESTAMP.tar.gz -C /www/wwwroot/knowledgepilot
```

5. Reinstall dependencies for the restored version.
6. Restore ownership and permissions.
7. Restart the single confirmed process and verify `/health`.

Keep the backups until the smoke test and one complete delivery cycle have passed.
