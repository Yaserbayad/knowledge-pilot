# Start here — Knowledge Pilot deployment and operations

Knowledge Pilot is deployed from immutable GitHub releases. The live aaPanel directory is runtime state, not the source of code authority.

## For a new release or upgrade

Use the canonical [aaPanel immutable-release runbook](docs/AAPANEL_DEPLOYMENT.md).

The safe sequence is:

1. Identify the exact process and process manager currently serving `/www/wwwroot/knowledgepilot` on `127.0.0.1:3100`.
2. Resolve the published release tag to its exact expected commit SHA.
3. Build a clean staging tree from that immutable commit.
4. Preserve `.env` without displaying it and validate against isolated staging data.
5. Run locked installs, configuration verification, the full root test suite, the Workspace Agent suite, and both production dependency audits.
6. Create a rollback code snapshot.
7. Stop only the confirmed Knowledge Pilot process.
8. Replace release-owned files while preserving only `.env`, `data/`, and server-owned `.well-known/` material.
9. Restart through the same process manager.
10. Verify local/external health, release identity, learner/admin flows, verified-processing behavior, and configured delivery channels.
11. If the Workspace Agent bridge is used, validate it end to end before enabling its automatic timer.
12. Roll back immediately if the release cannot pass smoke verification.

Never deploy from `main`/`latest`, never preserve an old `automation/` directory across releases, and never start a second process manager because the current shell's PM2 view is empty.

## Preparing an already-staged release

The repository-owned aaPanel preparation command is deliberately fail-closed and does **not** start or modify a process manager:

```bash
cd /www/wwwroot/knowledgepilot.stage
DATA_DIR=./data WHATSAPP_AUTH_DIR=./data/whatsapp-auth \
  bash scripts/install-aapanel.sh /www/wwwroot/knowledgepilot.stage
npm audit --omit=dev --audit-level=high
```

Validate the Workspace Agent separately:

```bash
cd /www/wwwroot/knowledgepilot.stage/automation/workspace-agent
npm ci --ignore-scripts
npm run check
npm audit --omit=dev --audit-level=high
npm ci --omit=dev --ignore-scripts
```

If any command fails, do not touch the live process.

## Historical upgrade notes

Version-specific upgrade files document what changed in those releases; they are not the current deployment authority. In particular, [UPGRADE-1.4.1.md](UPGRADE-1.4.1.md) is retained only as historical release context.
