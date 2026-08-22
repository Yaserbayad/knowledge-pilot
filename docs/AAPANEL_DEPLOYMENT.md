# aaPanel deployment — canonical immutable-release runbook

This is the authoritative production deployment and rollback procedure for the current Knowledge Pilot aaPanel host.

The steady state is deliberately manual at the release gate and automated after that gate:

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

`data/` is runtime state. Its contents, ownership, and permission metadata are not rewritten merely because application code is deployed. Release-owned source, `automation/`, `node_modules/`, `.git/`, and obsolete release files are replaced by the requested release rather than copied forward from the current live tree.

The deployment engine must never print `.env` contents, application secrets, bearer tokens, Telegram credentials, SSH private keys, learner data, or owned book contents.

## Release authority and normal invocation

GitHub is the sole code authority. Deploy only an immutable semantic release tag plus its exact 40-character commit SHA:

```bash
sudo deploy-knowledge-pilot vX.Y.Z <EXPECTED_40_CHARACTER_COMMIT_SHA>
```

The two-argument interface is intentional. The semantic tag is human-readable release identity; the supplied SHA is an independent fail-closed identity check.

For every deployment the engine:

1. prunes/fetches authoritative tags;
2. explicitly refreshes `refs/remotes/origin/main`, independent of the checkout's configured fetch refspec;
3. requires authoritative remote `main` to exist;
4. resolves `refs/tags/<tag>^{commit}`;
5. requires that result to equal the supplied SHA exactly;
6. requires the commit to be an ancestor of the freshly fetched `origin/main`.

It refuses moving refs such as `main`/`latest`, malformed tags, unavailable commits, deleted remote tags retained only in stale local state, and tag/SHA mismatches.

## One-time installation or deliberate engine upgrade

The repository owns both pieces:

- deployment engine: `scripts/deploy-release.sh`
- installer: `scripts/install-deployer.sh`

After an engine change is reviewed and merged to `main`:

1. Record the exact merged commit as `<ENGINE_SOURCE_SHA>`.
2. Obtain `scripts/install-deployer.sh` from **that exact commit** and transfer that single file to the server without editing it.
3. Run:

```bash
sudo bash install-deployer.sh <ENGINE_SOURCE_SHA>
```

No separate bootstrap wrapper is required.

The installer fails closed unless its own uploaded bytes match `scripts/install-deployer.sh` in the supplied exact commit. Before changing the installed engine it also:

- requires root and an exact 40-character source SHA;
- verifies `/opt/knowledgepilot-deploy` is the expected Knowledge Pilot SSH repository;
- serializes installer work and refuses to replace the engine while an application deployment lock is active;
- explicitly refreshes authoritative `origin/main` through the existing read-only deployment credential;
- requires the source commit to exist on that `origin/main`;
- extracts `scripts/deploy-release.sh` from the exact source commit;
- runs `bash -n` and the engine self-test;
- atomically installs `/usr/local/sbin/deploy-knowledge-pilot` as `root:root` mode `0755`;
- verifies the installed file hash, permissions, and self-test.

The installer does **not** deploy, stop, restart, or replace the live Knowledge Pilot application. The installed engine also never overwrites itself while an application deployment is running.

### Bounded npm configuration cleanup during installation

The installer checks npm's user/global configuration locations plus `/root/.npmrc` and `/etc/npmrc`. If it finds stale entries named `APP_SECRET`, `--init.module`, or `init.module`, it removes only those entries while preserving the config file's ownership and mode. It reports the path and key name only, never the value.

This cleanup does not read, print, replace, or modify `/www/wwwroot/knowledgepilot/.env`, so it does not alter the real Knowledge Pilot `APP_SECRET`.

If no matching npm-config entry is found, no npm-config change is made. The actual production source of a prior npm warning is established only by the path/key evidence emitted on the server; it is not guessed beforehand.

## What one deployment command performs

### 1. Exclusive lock and healthy-baseline preflight

Before any live mutation, the engine acquires an exclusive `flock`. A concurrent invocation fails immediately and cannot run cleanup belonging to the active deployment.

It then proves the existing deployment is both identifiable and healthy:

- live path, `VERSION`, `.env`, and `data/` exist;
- `.env` mode is exactly `600` using permission-string comparison;
- `www` can read `.env` and read/write `data/`;
- exactly one listener owns `127.0.0.1:3100`;
- exactly one process has the live directory as its working directory;
- `/proc/<pid>/cwd` is exactly the live path;
- argv identifies `node src/index.js`;
- actual UID/GID match `www:www`;
- exactly one aaPanel Node-project PID file identifies that PID;
- the matching aaPanel start script targets the live path and `src/index.js`;
- required start-script output locations are writable by `www`;
- sufficient disk space exists for staging, rollback, and overhead;
- the deployment checkout is the expected repository;
- current local `/health` reports the current `VERSION`;
- current authenticated local `/api/gpt/health` succeeds;
- current `nginx -t` succeeds;
- current external HTTPS `/health` and `/gpt-action/openapi.json` succeed and report the current version.

This baseline proof prevents a pre-existing DNS, nginx, authentication, or public-route fault from being misdiagnosed as a new-release failure after cutover.

### 2. Exact production Node/npm toolchain capture

The deployment does not trust whichever `node` or `npm` happens to appear first in the root SSH shell's `PATH`.

From the confirmed live PID it resolves `/proc/<pid>/exe`, requires that exact executable to be Node with repository-supported major version (`>=22`), and captures the npm executable from the same runtime installation. Staging checks, package-version parsing, smoke helpers, Workspace Agent checks/configuration, and post-restart identity validation use that captured toolchain.

The engine does **not** pin npm 11. Current production Node 24.18.0/npm 12.0.1 remains valid.

### 3. Immutable release verification

Using the existing repository-specific deployment credential, the engine performs the tag/SHA/main checks described above. If a configured private key and `.pub` sidecar are visible from the checkout configuration, their identity is compared as canonical `key-type + key-material`; optional comments are ignored.

No `gh auth login`, GitHub write token, or GitHub Action SSH credential is required.

### 4. Clean staging from Git

The stage is rebuilt outside the running tree at:

```text
/www/wwwroot/knowledgepilot.stage
```

Source comes from `git archive <exact-sha>`, never from the current live application directory. The engine verifies release version identity and deployment-engine compatibility, privately copies `.env` to staging, and creates isolated staging data directories.

### 5. Full verification before live cutover

The staged root application performs, in order:

```text
locked full dependency install
configuration verification
complete current application check/test suite
npm audit --omit=dev --audit-level=high
production-only locked dependency preparation
```

The complete current test suite determines success by exit status; test totals are never hardcoded.

When `automation/workspace-agent/` is present, staging also performs its locked install, complete check/test suite, production dependency audit, and production-only dependency install with the captured production Node/npm toolchain.

Any failure here exits non-zero **before the live application is stopped or release-owned files are replaced**.

### 6. Verified rollback snapshot

Before cutover the engine rebuilds:

```text
/www/wwwroot/knowledgepilot.rollback
```

The snapshot contains current release-owned production files and excludes `.env`, `data/`, `.well-known/`, and `.git/`. It requires a valid prior `src/index.js` and semantic `VERSION` before the snapshot is rollback-ready.

Release copying uses checksum-based `rsync` plus `--delete`, so stale same-size/same-timestamp release files cannot survive accidentally.

### 7. Workspace automation state

If `knowledgepilot-agent-trigger.timer` is already active, its enabled/active state is recorded and the timer is paused for the live cutover. If it is not active, deployment does not start it.

After success or rollback, only the prior state is restored. Deployment never enables the automatic trigger timer merely because a release was installed.

### 8. Graceful aaPanel cutover

Immediately before stop, runtime/process/manager identity is re-verified.

The engine sends graceful `TERM` only to that verified PID. It then requires **both**:

- the exact process to disappear from `/proc`;
- port `3100` to clear.

It never uses `pkill`, `killall`, or blind `kill -9`.

Only after verified shutdown does checksum cutover replace release-owned files. `.env`, `data/`, and `.well-known/` remain excluded. Release-owned content is restored to `www:www`; preserved `data/` ownership/modes and server-owned `.well-known/` metadata are not recursively rewritten.

### 9. Restart as `www`, then verify reality

The confirmed aaPanel start script is invoked explicitly as `www`. A successful start command is not accepted as proof of success.

The engine then requires the new listener/process to match:

- one process/one loopback listener;
- live cwd;
- `node src/index.js` argv;
- `www:www` UID/GID;
- the **same exact Node executable** captured from the previous healthy runtime;
- expected live `VERSION`;
- successful local `/health`.

Only after these checks does the privileged wrapper refresh aaPanel's PID file with the verified PID.

### 10. Authenticated local production smoke

The engine reads `GPT_ACTION_API_KEY` internally from the existing `.env` and performs a bounded authenticated GET of `/api/gpt/health`. The key is never printed or placed in command-line arguments.

Embedded Node snippets that use top-level `await` explicitly run with module input mode, protecting the Node 24 STDIN ambiguity regression.

### 11. Workspace Agent server integration

When present, the checked-in Workspace Agent server configurator runs with the captured Node binary, followed by:

```text
systemctl daemon-reload
nginx -t
systemctl restart knowledgepilot-mcp.service
verify MCP service active
```

The configurator preserves the existing route identity and bearer credentials. The trigger timer is not newly enabled.

### 12. External production smoke

The engine derives `APP_BASE_URL` internally from `.env`, requires HTTPS, and verifies external `/health` and `/gpt-action/openapi.json` both report the requested release version.

A release that materially changes processing contracts can still require release-specific lesson/book end-to-end verification after the generic deployment succeeds; the generic engine does not pretend application-specific semantic validation is universal.

## Success output

A successful ordinary deployment ends with concise non-secret output:

```text
RESULT=PASS
RELEASE=vX.Y.Z
RELEASE_SHA=<sha>
MANAGER=aapanel-node
RUNTIME_USER=www
PRODUCTION_CUTOVER=PASS
```

## Failure and automatic rollback

### Before live stop

A preflight, current-baseline, release-authority, staging, test, audit, or rollback-snapshot failure exits non-zero before live source is replaced or the confirmed live process is stopped.

### After live mutation begins

Once graceful stop is attempted, later failures are rollback-eligible. Rollback:

1. inspects listener state without treating ambiguity as "no process";
2. refuses release-file restoration if a listener/process state cannot be safely identified;
3. stops only a verified Knowledge Pilot process when necessary;
4. checksum-restores prior release-owned files with `--delete`;
5. preserves current `.env`, `data/`, and `.well-known/`;
6. restarts through the same aaPanel start script as `www`;
7. re-verifies process identity, exact Node binary, prior version, and local health;
8. reruns authenticated local smoke;
9. restores prior Workspace Agent server integration when present;
10. reruns external health/OpenAPI checks for the prior version;
11. restores the prior timer state.

Only complete verification can produce:

```text
ROLLBACK=PASS
```

Ambiguous or failed rollback verification produces `ROLLBACK=FAIL` and a non-zero deployment result.

## Regression-protected deployment lessons

Automated tests permanently cover:

1. no npm 11 pin; supported runtime follows repository policy;
2. `.env` mode string handling rather than incorrect octal arithmetic;
3. explicit `www` startup and actual UID/GID verification;
4. deploy-key comparison independent of optional comments;
5. explicit Node module input mode for STDIN top-level `await`;
6. runtime truth after start rather than trusting command success;
7. lock-loser cleanup isolation;
8. stale deleted remote tag pruning;
9. installer/deployment lock serialization;
10. explicit authoritative `origin/main` refresh;
11. exact-process exit before file cutover;
12. ambiguous-listener rollback refusal;
13. preservation of runtime-owned `data/` permissions;
14. exact live Node toolchain use;
15. healthy local/authenticated/nginx/external baseline before cutover;
16. installer self-integrity against the exact reviewed source commit.

The suite also contains disposable successful cutover, pre-cutover failure, post-cutover automatic rollback, stale-file removal, runtime-data preservation, root-runtime rejection, and installer tamper/failure simulations.

## When the engine must be deliberately upgraded

Ordinary UI work, lesson/book workflow changes, normal backend features, validation, styling, new routes, and most GPT-processing changes should keep using the same installed command.

Review and deliberately reinstall the engine only when deployment architecture changes materially, for example:

- replacing aaPanel as process manager;
- changing runtime user/group;
- changing live/stage/rollback filesystem layout;
- materially changing Node/runtime policy;
- introducing a database migration mechanism;
- adding/removing production services the engine must reconcile;
- changing repository/release identity policy;
- changing production GitHub authentication architecture.

## Manual diagnostics

If preflight stops, inspect facts rather than weakening guardrails or starting another process:

```bash
sudo ss -ltnp | grep ':3100'
PID=<confirmed-pid>
sudo readlink -f /proc/$PID/cwd
sudo readlink -f /proc/$PID/exe
sudo tr '\0' ' ' < /proc/$PID/cmdline; echo
sudo awk '/^(Uid|Gid):/' /proc/$PID/status
```

## Reverse proxy and backups

The existing HTTPS virtual host must continue proxying to `http://127.0.0.1:3100`; port 3100 remains private.

Built-in backups cover JSON state. Server-level backups should protect the complete `data/` directory, including owned book files, with at least one encrypted off-server copy when the data matters.