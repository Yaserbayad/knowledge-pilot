# Upgrade to Knowledge Pilot 1.3.0

## Scope

This upgrade preserves `.env`, all state, private learner URLs, channel bindings, plans, lessons, books, uploaded owned copies, and progress. The state store migrates to schema version 4 automatically.

## 1. Identify the live process

Run before stopping anything:

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

Use the same process manager that owns the confirmed `node src/index.js` process. Do not run `pm2 restart` from an unrelated user account with an empty PM2 registry.

## 2. Back up

```bash
cd /www/wwwroot/knowledgepilot
cp .env /tmp/knowledgepilot.env.$(date +%s)
tar -czf /tmp/knowledgepilot-data-$(date +%F-%H%M%S).tar.gz data
cp -a VERSION package.json public src scripts tests docs /tmp/knowledgepilot-code-$(date +%F-%H%M%S)
```

## 3. Stop only Knowledge Pilot

Use aaPanel’s Node Project control, the confirmed systemd unit, or the exact PM2 owner. Verify the port is no longer listening before copying files.

## 4. Replace application files

Extract the 1.3.0 package to a temporary directory, then:

```bash
rsync -a --delete \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='node_modules/' \
  /tmp/knowledgepilot-1.3.0/ /www/wwwroot/knowledgepilot/
```

Never overwrite `.env` or `data/`.

## 5. Install and validate

```bash
cd /www/wwwroot/knowledgepilot
npm install --omit=dev
node scripts/verify-config.js
npm run check
```

Expected test result for this release: all tests pass.

## 6. Permissions

Use the actual runtime account. Example:

```bash
chown -R www:www /www/wwwroot/knowledgepilot
chmod 600 .env
find data -type d -exec chmod 750 {} \;
find data -type f -exec chmod 640 {} \;
```

## 7. Configuration

Recommended defaults:

```dotenv
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
```

## 8. Restart and verify

Restart the confirmed service, then:

```bash
curl -fsS https://YOUR_DOMAIN/health
curl -fsS https://YOUR_DOMAIN/gpt-action/openapi.json | grep '1.3.0'
```

Open Admin and confirm:

- application version 1.3.0
- scheduler enabled and ticking
- no unexpected failed local jobs
- GPT task queue counts are plausible

## 9. Update the custom GPT

1. Replace Instructions with `docs/CUSTOM_GPT_INSTRUCTIONS.md`.
2. Delete and reimport `/gpt-action/openapi.json`.
3. Keep the same Bearer key.
4. Run `Check Knowledge Pilot for pending tasks.`

## 10. Functional verification

- Completing onboarding queues one initial weekly-plan task.
- Approving a plan schedules lesson-generation jobs.
- A validated lesson/session auto-schedules.
- A held item is visible to its learner and sends an action-required notice.
- **Accept and schedule** works without Admin.
- Requesting changes creates a revision task and cancels stale delivery work.
- Skip cancels pending delivery, reminder, and reinforcement jobs.
- Repeating delivery after the item is recorded as delivered does not send it again.
- Cross-user access returns 404.
- Existing orphaned approved/scheduled content is reconciled at startup.
- Existing held content, draft plans, source requirements, pending GPT tasks, and failed jobs regain learner notices.
- Generated card URLs require the owning learner's private session, and owned-copy API metadata contains no server paths.

## Rollback

1. Stop the confirmed process.
2. Restore the previous code snapshot.
3. Restore the pre-upgrade `data/` archive only if the upgraded state cannot be used.
4. Restore `.env` if changed.
5. Run `npm install --omit=dev` for the restored version.
6. Restart and verify `/health`.

State schema 4 is additive and normalized, but retain the backup until the full smoke test is complete.
