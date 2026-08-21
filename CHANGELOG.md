# 1.4.2

## Security

- Hardened authenticated browser mutations, security headers/CSP, request-size enforcement, request logging, private file containment, channel binding, and outbound SSRF/DNS-rebinding protections.
- Added bounded streaming response handling across research, AI/provider, Knowledge Pilot bridge, and Workspace Agent requests.
- Hardened production configuration validation and deployment credential guidance.

## Fixed

- Made JSON state publication fail closed when persistence fails and reject unsupported future schemas.
- Prevented ambiguous external deliveries and Workspace Agent triggers from being blindly duplicated after uncertain outcomes.
- Made accepted verified-processing results and terminal task state atomic, retired superseded work, and removed redundant full accepted-result retention.
- Prevented completed lesson/book progress regression and invalid book/session state transitions.
- Closed owned-book path traversal/symlink escape and WhatsApp account-binding ownership gaps.
- Fixed strict-CSP frontend progress rendering and unified accessible dialog focus/Escape/Tab behavior.
- Fixed Workspace Agent empty-queue reconciliation so a claimed queue cannot clear an active run before its documented beta run status is checked.

## Changed

- Expanded regression coverage for persistence, HTTP security, scheduling, result contracts, books, frontend runtime behavior, Workspace Agent safety, and deployment invariants.
- Made aaPanel release preparation fail closed, reproducible, and process-manager-neutral.
- Replaced hard-coded Workspace Agent Node paths with the actual installer runtime binary.
- Replaced legacy moving-package deployment instructions with an immutable tag/SHA staging, cutover, smoke, and rollback runbook.

## Compatibility

- No state-schema bump and no intentional breaking learner/admin or verified-processing API change from 1.4.1.

# 1.4.1

- Learners can add an owned PDF or ebook while creating a book and attach or replace it later from every book state.
- Active, paused, completed, and archived reading tracks retain their status, sessions, and progress when a source is added.
- Books waiting for source analysis automatically supersede stale analysis work and queue a fresh analysis.
- Replacements use versioned private files and remove only the superseded source after the new copy is safely stored.
- Upload errors now return accurate client-error status codes.

# 1.4.0

- Replaced automatically expanded Today lessons with closed-by-default daily cards and a deliberate lesson cover.
- Added a calm, centered, section-based reader with a persistent next action, accessible outline, subtle time/progress context, and no decorative topic-lesson SVG.
- Added durable section/anchor progress, monotonic completed sections, debounced autosave, offline retry, idempotent mutations, and revision conflicts that prevent stale overwrites.
- Added local knowledge checks with retry/skip, private answer history, completion confidence, saved notes/highlights, section feedback, source and saved-item drawers, and explicit-only contextual AI actions.
- Added soft light, dark, and warm reader themes, text sizing, focus mode, responsive safe-area controls, Arabic lesson UI/RTL behavior, and accessible dialog focus management.
- Rebuilt Weekly plan cards with a wrapping responsive grid and bottom-aligned actions.
- Added a conservative service worker for the non-private application shell; private lesson payloads are deliberately not stored in shared browser caches.
- Upgraded the additive state schema to version 5 and expanded regression coverage to 32 tests.

# 1.3.1

- Added permanent learner self-deletion from Settings and administrator deletion from the Learners panel.
- Added one ownership-aware cascade service that removes profiles, plans, lessons, interactions, jobs, messages, Business tasks, books, book plans, book sessions, uploaded book files, and generated cards.
- Added exact-name confirmation, cross-origin request protection, immediate private-session invalidation, shared-file protection, and backup-retention disclosure.
- Added lifecycle guards so in-flight generation and Business task submissions cannot recreate content after an account is deleted.
- Added deletion isolation, authorization, confirmation, private-file, stale-session, and regression tests.

# 1.3.0

- Replaced routine administrator approval with a learner-owned self-service lifecycle for topic lessons and book sessions.
- Automatically approves and schedules content that passes quality validation; explicit learner acceptance always schedules.
- Added learner Preview, Accept and schedule, Request changes, Skip, Deliver now, and Change time controls.
- Added web, Telegram, and WhatsApp action-required notices for review holds, source requirements, queued verified processing, backlogs, and failed jobs.
- Added private signed learner URLs to channel delivery and action notices.
- Added per-user automation settings and automatic first-plan creation after onboarding.
- Separated blocking quality issues from nonblocking source warnings.
- Added idempotent delivery/completion/skip behavior and lifecycle-state guards.
- Added stale local-job and stale GPT-task recovery.
- Clarified Admin as monitoring and exceptional override only.
- Added schema version 4, centralized application versioning, clearer queue metrics, HTTP error statuses, and immediate web visibility for pending notices.
- Expanded automated coverage for self-service ownership, scheduling, notices, recovery, source warnings, and lifecycle integrity.

# 1.2.2

- Reconciles book source status using verified server evidence and plan completeness.
- Promotes an owned-copy analysis to `awaiting_plan_approval` when the full text, at least one verified external context source, and a complete plan are present.
- Records the model decision and server decision separately for auditability.
- Promotes a misleading `limited` source badge to `medium` in this verified owned-copy scenario.
- Adds regression coverage for the Sapiens-style failure case.

# Changelog

## 1.2.1

- Fixed book analysis rejection when one optional source is inaccessible.
- Book analysis now requires at least two successfully fetched, independently diverse external sources, or one external source when a user-owned copy is available.
- Failed optional sources are recorded as source limitations instead of invalidating otherwise verified analysis.


## 1.2.0

- Added a separate adaptive book-learning track while preserving topic learning.
- Added book entry by title/author, ISBN, or HTTPS catalogue/publisher URL.
- Added duplicate merging, maximum-three-active-book control, and fiction deferral.
- Added lawful owned-copy uploads for PDF, EPUB, TXT, and Markdown with bounded extraction, archive-bomb limits, private storage, and GPT chunk access.
- Added source-quality assessment, insufficient-source handling, dynamic plans, duration override, plan approval, review checkpoints, and final synthesis.
- Added book sessions, concept mastery, topic-link suggestions requiring learner approval, notes, bookmarks, follow-up questions, feedback, reinforcement, and final assessments.
- Added pause, resume, archive, restart, skip, speed-up, slow-down, deeper, and shorter-session controls.
- Added Telegram and WhatsApp book delivery, completion commands, reminders, and reinforcement.
- Added dedicated learner Books UI and administrator book review/operations UI with RTL, mobile-first, and dark/light theme support.
- Added ChatGPT Business task types for book analysis, session generation, finale, follow-up, and reinforcement evaluation.
- Upgraded the local JSON schema to version 3 with automatic backward-compatible migration.
- Added book-file directory configuration, security documentation, upgrade workflow, and regression tests.

## 1.1.0

- Rebuilt the learner interface with a mobile-first responsive layout.
- Added full page-level RTL/LTR switching based on the learner language.
- Added automatic direction handling for mixed Arabic and Latin lesson content.
- Added a complete editable learning-profile form under Settings.
- Reused the same profile form for first-time onboarding and later updates.
- Added persistent light and dark themes across learner, admin, and public pages.
- Added a mobile bottom navigation bar with safe-area support.
- Improved keyboard focus, touch targets, dialogs, empty states, cards, forms, and accessible status messaging.
- Added regression coverage for repeated onboarding/profile updates and theme assets.

## 1.0.2

- Fixed Telegram deep-link payload compatibility by using short URL-safe binding tokens.

## 1.0.1

- Fixed OpenAPI schema compatibility with the ChatGPT GPT Actions importer.

## 1.0.0

- Initial Knowledge Pilot MVP release.
