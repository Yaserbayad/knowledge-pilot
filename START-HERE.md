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

The permanent command performs the complete safe lifecycle: exclusive lock, actual-process preflight, read-only Git release verification, clean `git archive` staging, full application and Workspace Agent verification/audits, rollback snapshot, graceful aaPanel cutover, clean release-file replacement, explicit startup as `www`, actual runtime verification, authenticated local smoke, server integration, external HTTPS smoke, and automatic verified rollback after a post-cutover failure.

The command preserves exactly `.env`, `data/`, and server-owned `.well-known/` when present. It does not carry stale release source, old `automation/`, `node_modules/`, `.git/`, or obsolete release files into the new release.

Never deploy from `main`, `latest`, a feature branch, a working directory, or an unverified tag. Never start a second process manager because a shell-level PM2 view is empty.

## One-time deployer bootstrap

The permanent engine is repository-owned at `scripts/deploy-release.sh` and installed as `/usr/local/sbin/deploy-knowledge-pilot` by `scripts/install-deployer.sh`.

After the engine change is merged to `main`, install it from that exact merged commit:

```bash
sudo bash scripts/install-deployer.sh <ENGINE_SOURCE_SHA>
```

The installer fetches through the existing repository-specific read-only GitHub access, extracts the engine from the exact source commit, syntax-checks/self-tests it, installs it atomically as root-owned mode `0755`, and verifies the installed hash and self-test.

Application releases do not update the running deployment engine midway through deployment. A deliberate one-time reinstall is required only when the deployment architecture or the engine itself materially changes. See `docs/AAPANEL_DEPLOYMENT.md` for that boundary and rollback semantics.

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

If any staging command fails, do not touch the live process.

## Historical upgrade notes

Version-specific upgrade files document what changed in those releases; they are not current deployment authority. In particular, [UPGRADE-1.4.1.md](UPGRADE-1.4.1.md) is retained only as historical release context.
