# Knowledge Pilot 1.3.0 deployment checklist — retired

> **Historical only. Do not deploy from this checklist.**

This file originally described the 1.3.0 archive-based deployment procedure. That procedure predates the current immutable GitHub release model, Workspace Agent release boundary, locked staging verification, and hardened rollback rules.

Current installations and upgrades must follow [AAPANEL_DEPLOYMENT.md](AAPANEL_DEPLOYMENT.md).

The current runbook deliberately differs from the old 1.3.0 process in material ways:

- deploy an immutable release tag resolved to an exact commit SHA, never an uploaded/moving package;
- build and test a clean staging tree before stopping production;
- validate both the root application and `automation/workspace-agent` with locked installs and production dependency audits;
- preserve only `.env`, `data/`, and server-owned `.well-known/` material during cutover;
- replace release-owned `automation/` and dependency trees with the release being deployed;
- identify and reuse the exact existing process manager instead of assuming PM2 ownership;
- retain a rollback code snapshot and fail closed if smoke verification does not pass;
- use a repository-specific read-only deployment credential and remove temporary write-capable bootstrap access before closure.

The historical 1.3.0 inspection record remains available separately for forensic context; it is not deployment authority.
