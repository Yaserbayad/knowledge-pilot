# aaPanel deployment — canonical immutable-release runbook

This is the authoritative deployment and rollback procedure for Knowledge Pilot on the current aaPanel host.

## Deployment invariants

- Deploy an **immutable release tag resolved to an exact commit SHA**. Never deploy `main`, `latest`, or another moving branch.
- Live application path: `/www/wwwroot/knowledgepilot`.
- Bind the Node application to `127.0.0.1:3100`; expose it only through the existing HTTPS reverse proxy.
- Preserve only runtime-owned material: `.env`, `data/`, and server-owned `.well-known/` when present.
- Do **not** preserve `automation/`, application source, `node_modules/`, or other release files. They belong to the release being deployed.
- Run exactly one Knowledge Pilot application instance. Reuse the process manager that already owns the live process; do not introduce PM2, systemd, or another manager during a code cutover.
- The server deployment credential must be repository-specific and read-only. A write-capable GitHub CLI/token credential is not part of the steady-state deployment design.
- Never print `.env`, deployment keys, bearer tokens, or other secrets into logs or terminal output.

The examples below use `<RELEASE_TAG>` and `<RELEASE_SHA>` deliberately. Replace them only with the release identity published in GitHub after final verification.

## 1. Identify the real live process before changing anything

Do not infer process ownership from the current shell user's PM2 registry. Inspect the listener and process directly:

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

The expected application process has working directory `/www/wwwroot/knowledgepilot` and runs `node src/index.js` (directly or through the existing manager). Record the exact existing stop and start/restart mechanism. If process ownership is ambiguous, stop here; do not start another copy.

## 2. Resolve and verify the immutable release

Use a private deployment checkout outside the live web root, authenticated with the repository-specific read-only credential:

```bash
DEPLOY_REPO=/opt/knowledgepilot-deploy
LIVE=/www/wwwroot/knowledgepilot
STAGE=/www/wwwroot/knowledgepilot.stage
ROLLBACK=/www/wwwroot/knowledgepilot.rollback
RELEASE_TAG='<RELEASE_TAG>'
EXPECTED_SHA='<RELEASE_SHA>'

cd "$DEPLOY_REPO"
git fetch --prune --tags origin
ACTUAL_SHA="$(git rev-parse "${RELEASE_TAG}^{commit}")"
test "$ACTUAL_SHA" = "$EXPECTED_SHA"
```

Fail closed if the tag does not resolve exactly to the published SHA.

## 3. Build a clean staging tree from that commit

The staging tree is built from the immutable commit, not copied from the live application:

```bash
rm -rf "$STAGE"
mkdir -p "$STAGE"
git archive "$EXPECTED_SHA" | tar -x -C "$STAGE"

# Copy configuration without displaying it. Validation uses isolated staging data.
install -m 600 "$LIVE/.env" "$STAGE/.env"
mkdir -p "$STAGE/data/backups" "$STAGE/data/cards" "$STAGE/data/book-files" "$STAGE/data/whatsapp-auth"
```

Validate the root application with the locked dependency graph and isolated data directories:

```bash
DATA_DIR=./data WHATSAPP_AUTH_DIR=./data/whatsapp-auth \
  bash "$STAGE/scripts/install-aapanel.sh" "$STAGE"

cd "$STAGE"
npm audit --omit=dev --audit-level=high
```

Validate the Workspace Agent independently, then leave only production dependencies in the staged release:

```bash
cd "$STAGE/automation/workspace-agent"
npm ci --ignore-scripts
npm run check
npm audit --omit=dev --audit-level=high
npm ci --omit=dev --ignore-scripts
```

Do not continue if any install, configuration check, test, or audit fails.

## 4. Create a rollback code snapshot

The rollback snapshot intentionally excludes live secrets and mutable application data:

```bash
rm -rf "$ROLLBACK"
mkdir -p "$ROLLBACK"
rsync -a \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='.well-known/' \
  "$LIVE/" "$ROLLBACK/"
```

Confirm that `$ROLLBACK/src/index.js` exists before proceeding.

## 5. Cut over only after the stage is fully green

1. Stop **only** the confirmed Knowledge Pilot process using the exact manager identified in step 1.
2. Confirm port `3100` is no longer owned by the old Knowledge Pilot PID.
3. Replace release-owned files while preserving runtime-owned data/configuration:

```bash
rsync -a --delete \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='.well-known/' \
  "$STAGE/" "$LIVE/"
```

4. Restore ownership to the actual runtime account and keep `.env` private. Example only when `www:www` is the confirmed runtime identity:

```bash
chown -R www:www "$LIVE"
chmod 600 "$LIVE/.env"
find "$LIVE/data" -type d -exec chmod 750 {} \;
find "$LIVE/data" -type f -exec chmod 640 {} \;
```

5. Restart through the **same** manager that owned the process before cutover. Do not start an additional manager.

## 6. Workspace Agent server integration

If the Workspace Agent bridge is part of this installation, render the checked-in unit templates using the Node binary that actually runs the installer:

```bash
cd "$LIVE/automation/workspace-agent"
node deploy/configure-server.mjs
sudo systemctl daemon-reload
sudo nginx -t
sudo systemctl restart knowledgepilot-mcp.service
```

`configure-server.mjs` preserves existing bridge credentials and MCP route identity, renders `process.execPath` into the service units, and leaves `knowledgepilot-agent-trigger.timer` disabled. Enable the timer only after the release's end-to-end lesson and book automation smoke tests pass.

## 7. Verify the running release

Local process and health:

```bash
sudo ss -ltnp | grep ':3100'
curl -fsS http://127.0.0.1:3100/health
```

External HTTPS health and action schema:

```bash
curl -fsS https://YOUR_DOMAIN/health
curl -fsS https://YOUR_DOMAIN/gpt-action/openapi.json
```

Confirm the reported application version matches `<RELEASE_TAG>` and that the process serving port `3100` has the expected live working directory.

Then perform the functional smoke set:

1. Open a private learner link and load the learner dashboard.
2. Open `/admin` and confirm the scheduler is healthy with no unexpected failed jobs.
3. Exercise a verified-processing lesson task and a book task.
4. Confirm accepted content schedules once and held content reaches learner review controls.
5. Confirm Telegram delivery/notification if enabled.
6. If Workspace Agent automation is configured, run one manual trigger cycle, verify the exact task completes without duplication, then test one timer-triggered cycle before enabling the timer permanently.

Do not call the release deployed until the smoke set passes.

## 8. Rollback

Rollback uses the same process owner and keeps the current `.env` and `data/` intact:

1. Stop only the confirmed Knowledge Pilot process.
2. Restore the previous release-owned files:

```bash
rsync -a --delete \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='.well-known/' \
  "$ROLLBACK/" "$LIVE/"
```

3. Restart through the same process manager.
4. Re-run local and external health checks.
5. If Workspace Agent unit templates changed between releases, rerun that restored release's `deploy/configure-server.mjs`, `systemctl daemon-reload`, `nginx -t`, and restart its MCP service.

If rollback cannot be verified, keep the service stopped rather than starting an unverified combination of code and runtime state.

## Reverse proxy

The existing HTTPS virtual host should proxy the application to `http://127.0.0.1:3100` and allow owned-book uploads:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_http_version 1.1;
proxy_read_timeout 180s;
client_max_body_size 35m;
```

Force HTTPS. Do not expose port `3100` publicly.

## Backups

Built-in backups cover JSON state. Server-level backups should protect the complete `data/` directory, including owned book files. Store at least one encrypted copy off-server when that data matters.

## Common failure conditions

- **Release tag/SHA mismatch:** stop; do not deploy.
- **Any staged test/audit/config failure:** stop; do not touch the live process.
- **Ambiguous process manager or multiple port-3100 owners:** stop and reconcile ownership; do not start another process.
- **HTTP 413:** verify the HTTPS virtual host uses `client_max_body_size 35m`.
- **Data directory not writable:** restore ownership for the confirmed runtime user.
- **No Telegram delivery:** verify configuration/binding and whether the item is delivered, scheduled, or held for review.
- **Workspace Agent suspended/ambiguous run:** leave the timer disabled and reconcile the durable trigger intent before retrying.
