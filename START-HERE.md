# Start here — Knowledge Pilot deployment and operations

Knowledge Pilot is deployed from immutable GitHub releases. The live aaPanel directory is runtime state, not the source of code authority.

## Normal future release deployment

Use the canonical [aaPanel immutable-release runbook](docs/AAPANEL_DEPLOYMENT.md).

After the permanent deployer has been installed once, the operator workflow for an ordinary release is:

1. Finish development and review.
2. Pass CI and release checks.
3. Merge to `main`.
4. Create the immutable semantic release tag and record its exact commit SHA.
5. SSH to production.
6. Run one command:

```bash
sudo deploy-knowledge-pilot vX.Y.Z <EXPECTED_40_CHARACTER_COMMIT_SHA>
```

7. Accept the deployment only when the command reports `RESULT=PASS`; otherwise follow its failure/rollback result.

The permanent command performs the complete safe lifecycle: exclusive lock, actual-process and healthy-baseline preflight, exact aaPanel Node-toolchain capture, read-only Git release verification, clean `git archive` staging, full application and Workspace Agent verification/audits, rollback snapshot, graceful aaPanel cutover, clean release-file replacement, explicit startup as `www`, actual runtime verification, authenticated local smoke, server integration, external HTTPS smoke, and automatic verified rollback after a post-cutover failure.

The command preserves exactly `.env`, `data/`, and server-owned `.well-known/` when present. `data/` is treated as runtime-owned state: deployment preserves its existing ownership and permission metadata as well as its contents. The command does not carry stale release source, old `automation/`, `node_modules/`, `.git/`, or obsolete release files into the new release.

Never deploy from `main`, `latest`, a feature branch, a working directory, or an unverified tag. Never start a second process manager because a shell-level PM2 view is empty.

## One-time deployer installation

The permanent engine is repository-owned at `scripts/deploy-release.sh` and installed as `/usr/local/sbin/deploy-knowledge-pilot` by the repository-owned `scripts/install-deployer.sh`.

After an engine change is reviewed and merged to `main`:

1. Record the exact merged commit as `<ENGINE_SOURCE_SHA>`.
2. Obtain `scripts/install-deployer.sh` from **that exact commit** and transfer that file to the server without editing it.
3. Run:

```bash
sudo bash install-deployer.sh <ENGINE_SOURCE_SHA>
```

The installer fails closed unless its own bytes match `scripts/install-deployer.sh` at the supplied exact `main` commit. It then uses only the existing repository-specific read-only GitHub access, re-fetches authoritative `origin/main`, verifies the source commit, extracts `scripts/deploy-release.sh` from that exact commit, syntax-checks and self-tests it, installs it atomically as `/usr/local/sbin/deploy-knowledge-pilot` with `root:root` mode `0755`, verifies the installed hash and permissions, and reruns the installed self-test.

No extra bootstrap wrapper is required. The installer does not deploy, stop, restart, or replace the live Knowledge Pilot application.

Application releases do not update the running deployment engine midway through deployment. A deliberate reinstall is required only when the deployment architecture or the engine itself materially changes. See `docs/AAPANEL_DEPLOYMENT.md` for that boundary and rollback semantics.

## Preparing an already-staged release manually

The repository-owned aaPanel preparation command remains fail-closed and does **not** start or modify a process manager:

```bash
cd /www/wwwroot/knowledgepilot.stage
DATA_DIR=./data WHATSAPP_AUTH_DIR=./data/whatsapp-auth \
  bash scripts/install-aapanel.sh /www/wwwroot/knowledgepilot.stage
```

It performs the locked full dependency install, configuration verification, complete current application check/test suite, high-severity production dependency audit, and final production-only locked install.

Validate the Workspace Agent independently when present:

```bash
cd /www/wwwroot/knowledgepilot.stage/automation/workspace-agent
npm ci --ignore-scripts
npm run check
npm audit --omit=dev --audit-level=high
npm ci --omit=dev --ignore-scripts
```

For automated production deployment, the permanent engine runs these checks with the exact Node/npm toolchain captured from the currently serving aaPanel process; the manual commands above are diagnostic/manual preparation examples only.

If any staging command fails, do not touch the live process.

## Historical upgrade notes

Version-specific upgrade files document what changed in those releases; they are not current deployment authority. In particular, [UPGRADE-1.4.1.md](UPGRADE-1.4.1.md) is retained only as historical release context.