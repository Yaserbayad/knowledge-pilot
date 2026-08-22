# aaPanel deployment — canonical immutable-release runbook

This is the authoritative production deployment and rollback procedure for the current Knowledge Pilot aaPanel host.

The normal steady state is deliberately manual at the release gate and automated after that gate:

```text
develop -> verify/review -> merge -> immutable semantic tag -> SSH -> one deploy command -> PASS or verified rollback
```

There is no GitHub release watcher, deployment timer, GitHub-triggered SSH job, self-hosted runner, or new AI execution service.

## Production contract

The permanent deployment engine is designed for this deployment architecture:

- Repository: `Yaserbayad/knowledge-pilot`.
- Live path: `/www/wwwroot/knowledgepilot`.
- Listener: `127.0.0.1:3100`.
- Application entry: `node src/index.js`.
- Runtime user/group: `www:www`.
- Application process manager: the existing aaPanel Node project only.
- Deployment checkout: `/opt/knowledgepilot-deploy`.
- Production GitHub authentication: the existing repository-specific **read-only** SSH deploy key.
- Permanent command: `/usr/local/sbin/deploy-knowledge-pilot`.
- Runtime-owned paths preserved across every deployment: `.env`, `data/`, and `.well-known/` when present.

Release-owned source, `automation/`, `node_modules/`, `.git/`, and obsolete release files are replaced by the requested release. They are never copied forward from the current live source tree.

The deployment engine must never print `.env` contents, application secrets, bearer tokens, Telegram credentials, SSH private keys, learner data, or owned book contents.

## Release authority and invocation

GitHub is the sole code authority. Deploy only an immutable semantic release tag plus its exact 40-character commit SHA:

```bash
sudo deploy-knowledge-pilot v1.4.3 <EXPECTED_40_CHARACTER_COMMIT_SHA>
```

The two-argument interface is intentional. A tag is human-readable release identity; the expected SHA is an independent fail-closed identity check. The engine fetches tags through the read-only deployment checkout, resolves `refs/tags/<tag>^{commit}`, and requires the result to equal the supplied SHA exactly. It refuses branches such as `main`, aliases such as `latest`, malformed tags, unavailable commits, and tag/SHA mismatches.

Do not weaken this to a moving ref merely to shorten the command.

## One-time installation of the permanent command

The repository owns both pieces:

- deployment engine: `scripts/deploy-release.sh`
- one-time installer: `scripts/install-deployer.sh`

After the deployment-engine change is merged to `main`, use the exact merged source commit as `<ENGINE_SOURCE_SHA>`. Because the live application is still an older release during this first bootstrap, do **not** assume `scripts/install-deployer.sh` already exists in `/www/wwwroot/knowledgepilot`. Bootstrap the reviewed installer directly from the exact commit in the existing read-only deployment checkout:

```bash
ENGINE_SOURCE_SHA='<ENGINE_SOURCE_SHA>'
sudo bash -c '
set -Eeuo pipefail
repo=/opt/knowledgepilot-deploy
sha="$1"
git -C "$repo" fetch --prune origin
test "$(git -C "$repo" cat-file -t "$sha" 2>/dev/null)" = commit
git -C "$repo" merge-base --is-ancestor "$sha" refs/remotes/origin/main
tmp="$(mktemp)"
trap '\''rm -f "$tmp"'\'' EXIT
git -C "$repo" show "${sha}:scripts/install-deployer.sh" > "$tmp"
bash -n "$tmp"
bash "$tmp" "$sha"
' knowledge-pilot-bootstrap "$ENGINE_SOURCE_SHA"
```

This bootstrap does not update the deployment checkout working tree and does not need a GitHub write credential. The installer then independently re-verifies the exact source commit before installation.

The installer:

1. requires root and an exact 40-character source commit;
2. verifies `/opt/knowledgepilot-deploy` is the Knowledge Pilot SSH repository;
3. fetches through the existing deployment credential;
4. requires the source commit to exist on `origin/main`;
5. extracts `scripts/deploy-release.sh` directly from that exact commit with `git show`;
6. runs `bash -n` and the engine's self-test before installation;
7. atomically installs `/usr/local/sbin/deploy-knowledge-pilot` as `root:root` mode `0755`;
8. verifies the installed file hash, permissions, and self-test.

The installed engine does **not** overwrite itself during application deployments. This avoids a circular deployment where the currently executing safety mechanism changes midway through its own run.

### Bounded npm configuration cleanup during installation

The one-time installer also checks npm's user/global configuration file locations plus `/root/.npmrc` and `/etc/npmrc`. If it finds stale npm-config entries named `APP_SECRET`, `--init.module`, or `init.module`, it removes only those configuration entries while preserving the file's ownership and mode. It reports only the configuration path and key name, never the value.

This cleanup does **not** read, print, replace, or modify `/www/wwwroot/knowledgepilot/.env`, and therefore does not alter the actual Knowledge Pilot `APP_SECRET`.

If no matching npm-config entry is found, the installer makes no npm-config change. The actual production source of the prior npm warnings is confirmed only by the path/key evidence printed when the installer runs; do not guess it in advance.

## What one deployment command performs

### 1. Exclusive lock and production preflight

Before changing live production, the engine acquires an exclusive `flock`. A concurrent invocation fails immediately without running stage cleanup owned by the active deployment.

It then verifies the actual running application rather than inferring identity from file ownership or a successful manager command:

- live path, `.env`, and `data/` exist;
- `.env` mode is exactly `600`, using permission-string comparison rather than decimal arithmetic on octal notation;
- runtime user `www` can read `.env` and read/write `data/`;
- exactly one listener owns `127.0.0.1:3100`;
- the listener PID exists under `/proc`;
- `/proc/<pid>/cwd` is exactly `/www/wwwroot/knowledgepilot`;
- argv identifies `node src/index.js`;
- actual process UID/GID match `www:www`;
- exactly one aaPanel Node-project PID file identifies that PID and the matching generated aaPanel start script targets the Knowledge Pilot live path;
- aaPanel start-script output targets needed before process launch are writable by `www`;
- sufficient disk space exists for staging, rollback, and deployment overhead;
- the deployment checkout is the expected repository.

The aaPanel PID file itself is a special case: aaPanel's generated start script may attempt to write it even though the application must start as `www`. The engine therefore does not require `www` to own that bookkeeping file. After startup, the privileged deployer writes the **independently verified listener PID** back to the aaPanel PID file.

### 2. Immutable release verification

The engine fetches tags with the existing repository-specific deployment credential and verifies:

```text
requested semantic tag -> exact commit SHA == supplied expected SHA
```

If the deployment checkout exposes a configured SSH private key and matching `.pub` sidecar, public-key identity is compared canonically as `key-type + key-material`; optional comments are ignored.

No `gh auth login`, write token, GitHub API write credential, or GitHub Action SSH access is required.

### 3. Clean staging from Git

The stage is rebuilt from the exact release commit outside the running tree:

```text
/www/wwwroot/knowledgepilot.stage
```

Source comes from `git archive <exact-sha>`, never from the current live application directory. The engine verifies release version identity and deployment-engine compatibility, then privately copies `.env` to staging and creates isolated staging data directories.

### 4. Full verification before live cutover

The staged root application performs, in order:

```text
locked full dependency install
configuration verification
complete current application check/test suite
npm audit --omit=dev --audit-level=high
production-only locked dependency preparation
```

`npm run check` determines success by exit status. Test totals are never hardcoded.

When `automation/workspace-agent/` is present, staging separately performs:

```text
npm ci --ignore-scripts
complete Workspace Agent check/test suite
npm audit --omit=dev --audit-level=high
npm ci --omit=dev --ignore-scripts
```

Any failure here exits non-zero **before the live application is stopped or release-owned files are replaced**.

### 5. Verified rollback snapshot

Before cutover the engine creates:

```text
/www/wwwroot/knowledgepilot.rollback
```

The snapshot contains the current release-owned production files and excludes:

- `.env`
- `data/`
- `.well-known/`
- `.git/`

The engine requires a valid prior `src/index.js` and semantic `VERSION` before the snapshot is considered rollback-ready.

Release copying uses checksum-based `rsync` plus `--delete`. The checksum requirement is deliberate: a disposable regression simulation proved that timestamp/size-only comparison can incorrectly keep an old same-size release file.

### 6. Workspace automation state

If `knowledgepilot-agent-trigger.timer` is already active, the engine records its enabled/active state and pauses it for the short live cutover. If it is not active, it is not started.

After success or rollback, the engine restores only the prior state. A deployment never enables the API-trigger timer merely because a new release was installed.

No ChatGPT schedules, GPTs, plugins/apps, or agents are modified by the deployment engine.

### 7. Graceful aaPanel cutover

Immediately before stopping the application, the engine re-verifies the listener PID, cwd, argv, UID/GID, and aaPanel project identity.

It then sends graceful `TERM` to **only that verified PID** and requires port `3100` to clear. It never uses `pkill`, `killall`, or blind `kill -9`.

The stop is deliberately implemented against the exact aaPanel-tracked PID because common aaPanel terminal restart examples use forced process killing, which is outside Knowledge Pilot's deployment safety policy. The aaPanel PID file and generated start script remain the process-manager identity.

The clean staged release is checksum-copied into the live path with `--delete`, excluding exactly `.env`, `data/`, and `.well-known/`. This removes stale release-owned files and old `.git/` metadata.

Ownership is restored to `www:www` for the application/runtime-owned tree without recursively changing server-owned `.well-known/` ownership.

### 8. Restart as the application user, then verify reality

The generated aaPanel start script is invoked explicitly as `www`:

```text
runuser -u www -- bash <confirmed-aaPanel-start-script>
```

A successful command return is **not** accepted as proof of a successful restart. The engine then independently verifies the new listener PID, cwd, argv, UID/GID, live `VERSION`, and local `/health` response. Only after those checks pass does the privileged wrapper refresh aaPanel's PID file with the verified PID.

This permanently protects the v1.4.2 failure where invoking the aaPanel start script as root produced `root root node src/index.js`.

### 9. Authenticated local production smoke

The engine reads `GPT_ACTION_API_KEY` from the existing `.env` internally and performs a bounded authenticated GET of `/api/gpt/health`. The key is never printed or placed in command-line arguments.

Embedded Node code that uses top-level `await` explicitly runs with:

```text
node --input-type=module
```

This protects the Node 24 `ERR_AMBIGUOUS_MODULE_SYNTAX` regression.

### 10. Workspace Agent server integration

When the deployed release includes `automation/workspace-agent/`, the engine runs the checked-in server configurator and then:

```text
systemctl daemon-reload
nginx -t
systemctl restart knowledgepilot-mcp.service
verify MCP service active
```

The configurator preserves the existing MCP route identity and bearer credentials. The trigger timer is not newly enabled by deployment.

### 11. External production smoke

The engine derives `APP_BASE_URL` internally from `.env` without printing the file, requires HTTPS, and verifies:

- external `/health` succeeds and reports the expected release version;
- `/gpt-action/openapi.json` succeeds and reports the expected release version.

These checks are bounded and non-destructive. A release that changes critical processing contracts may still require release-specific end-to-end lesson/book verification after the generic deployment succeeds.

## Success output

A successful ordinary deployment ends with a concise non-secret result such as:

```text
RESULT=PASS
RELEASE=v1.4.3
RELEASE_SHA=<sha>
MANAGER=aapanel-node
RUNTIME_USER=www
PRODUCTION_CUTOVER=PASS
```

## Failure and automatic rollback

### Failure before live stop/cutover

A preflight, release-verification, staging, test, audit, or rollback-snapshot failure exits non-zero. The live application source is not replaced and the confirmed live Knowledge Pilot process is not stopped.

### Failure after live cutover begins

The engine automatically attempts rollback using the verified snapshot:

1. stop only a verified failed/new Knowledge Pilot process if one exists;
2. checksum-restore the prior release-owned files with `--delete`;
3. preserve the current `.env`, `data/`, and `.well-known/`;
4. restore production ownership/permissions;
5. restart through the same aaPanel start script as `www`;
6. re-verify listener, cwd, argv, UID/GID, prior version, and local health;
7. rerun the authenticated local smoke;
8. restore the prior Workspace Agent server integration when present;
9. rerun external health/OpenAPI checks for the prior version;
10. restore the prior timer state.

Only then may it print:

```text
ROLLBACK=PASS
```

If any rollback verification is ambiguous or fails, the engine reports `ROLLBACK=FAIL` and exits non-zero. It never labels an unverified rollback successful.

## Regression-protected v1.4.2 deployment lessons

Automated tests permanently cover these failures:

1. **npm version:** no npm 11.x pin; runtime support follows repository policy (`Node >=22`, with current production Node 24.18.0/npm 12.0.1 valid).
2. **permission mode:** `.env` mode is checked as a permission string; unsafe representative modes are rejected.
3. **root runtime:** aaPanel startup is explicitly invoked as `www`, and actual runtime UID/GID are verified afterward.
4. **deploy-key comments:** canonical public-key identity ignores optional comments.
5. **Node STDIN module mode:** top-level-await snippets explicitly use ESM.
6. **command success is not runtime success:** PID, cwd, argv, listener, runtime identity, version, and health are checked after startup.

The test suite also includes disposable success and forced-failure simulations for clean cutover, runtime-owned data preservation, stale-file removal, automatic rollback, deployment-lock isolation, and the one-time installer.

## When the permanent engine must be deliberately upgraded

Ordinary application releases should continue using the same installed command. UI work, lesson/book workflow changes, normal backend features, validation, styling, new routes, and most GPT-processing changes do not require a new deployment script.

A deliberate engine update is required when the deployment architecture itself changes materially, including examples such as:

- replacing aaPanel as process manager;
- changing the application runtime user/group;
- changing live/stage/rollback filesystem layout;
- materially changing Node/runtime policy;
- introducing a database schema migration mechanism;
- adding/removing production services in a way the current engine cannot safely reconcile;
- changing repository/release identity policy;
- changing production GitHub authentication architecture.

When that happens, update `scripts/deploy-release.sh` in the repository, test/review/merge it, then rerun the one-time installer with the exact new engine source commit. Do not let an application deployment replace the running engine mid-execution.

## Manual diagnostic checks

If the permanent command stops at preflight, inspect facts without bypassing the guardrails:

```bash
sudo ss -ltnp | grep ':3100'
PID=<confirmed-pid>
sudo readlink -f /proc/$PID/cwd
sudo tr '\0' ' ' < /proc/$PID/cmdline; echo
sudo awk '/^(Uid|Gid):/' /proc/$PID/status
```

Do not respond to a preflight failure by starting another Node process or weakening identity checks. Diagnose the exact failed boundary first.

## Reverse proxy and backups

The existing HTTPS virtual host should continue proxying to `http://127.0.0.1:3100` and allow owned-book uploads. Port `3100` must remain private.

Built-in backups cover JSON state. Server-level backups should protect the complete `data/` directory, including owned book files, with at least one encrypted off-server copy when the data matters.
