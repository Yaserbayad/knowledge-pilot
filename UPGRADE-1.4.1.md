# Upgrade to 1.4.1 — historical release note

> **Historical only.** This file records the 1.4.1 behavior change. It is not the current deployment procedure. Use [docs/AAPANEL_DEPLOYMENT.md](docs/AAPANEL_DEPLOYMENT.md) for all current installations and upgrades.

Version 1.4.1 was an additive book-source workflow update. It did not change the state schema and required no new environment variables or dependencies.

## Behavior introduced in 1.4.1

- A learner may attach or replace a private PDF, EPUB, TXT, or Markdown copy from every book page.
- The Add Book form also accepts an optional owned file; a filename can identify the book when no title, ISBN, or URL is supplied.
- Active reading tracks preserve their status, sessions, schedule, and progress. The new source is available to future generated sessions.
- Books waiting for analysis automatically queue a fresh analysis using the newly uploaded source.
- The previous stored source is removed only after its validated replacement and state record are safely committed.

## Deployment note

The original 1.4.1 instructions preserved `automation/` and reused an existing `node_modules/` tree. That procedure is intentionally retired because later releases include security and reliability changes inside the Workspace Agent and require reproducible locked installs.

Current deployments must use an immutable release tag/SHA, stage the complete repository-owned release (including `automation/`), use locked installs, verify both root and Workspace Agent suites/audits, preserve only runtime configuration/data, and cut over through the existing confirmed process manager. See the canonical runbook linked above.

The state at 1.4.1 used schema version 5 and was compatible with 1.4.0 for the original rollback case.
