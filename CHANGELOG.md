# Changelog

All notable Knowledge Pilot changes are documented here. Versions follow Semantic Versioning.

## [1.4.2] - 2026-08-21

### Security
- Hardened authenticated browser mutations, security headers/CSP, request-size enforcement, request logging, private file containment, channel binding, and outbound SSRF/DNS-rebinding protections.
- Added bounded streaming response handling across research, AI/provider, Knowledge Pilot bridge, and Workspace Agent requests.
- Hardened production configuration validation and deployment credential guidance.

### Fixed
- Made JSON state publication fail closed when persistence fails and reject unsupported future schemas.
- Prevented ambiguous external deliveries and Workspace Agent triggers from being blindly duplicated after uncertain outcomes.
- Made accepted verified-processing results and terminal task state atomic, retired superseded work, and removed redundant full accepted-result retention.
- Prevented completed lesson/book progress regression and invalid book/session state transitions.
- Closed owned-book path traversal/symlink escape and WhatsApp account-binding ownership gaps.
- Fixed strict-CSP frontend progress rendering and unified accessible dialog focus/Escape/Tab behavior.
- Fixed Workspace Agent empty-queue reconciliation so a claimed queue cannot clear an active run before its documented beta run status is checked.

### Changed
- Expanded regression coverage for persistence, HTTP security, scheduling, result contracts, books, frontend runtime behavior, Workspace Agent safety, and deployment invariants.
- Made aaPanel release preparation fail closed, reproducible, and process-manager-neutral.
- Replaced hard-coded Workspace Agent Node paths with the actual installer runtime binary.
- Replaced legacy moving-package deployment instructions with an immutable tag/SHA staging, cutover, smoke, and rollback runbook.

### Compatibility
- No state-schema bump and no intentional breaking learner/admin or verified-processing API change from 1.4.1.
