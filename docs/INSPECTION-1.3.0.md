# Knowledge Pilot 1.3.0 — Inspection and Remediation Report

## Result

The supplied Knowledge Pilot 1.2.0 source was inspected and upgraded locally to 1.3.0. The live server was not modified.

The confirmed production symptom was caused by the product lifecycle, not Telegram: generated topic lessons and book sessions could remain `draft + needs_review`, while routine approval and scheduling controls existed only in Admin. Today and Telegram correctly excluded those held records, leaving the learner with no actionable explanation.

The revised release makes the lifecycle learner-owned and automation-first while retaining quality gates and exceptional Admin overrides.

## Implemented corrections

### 1. Learner-owned lifecycle

- Added learner-authorized review, revision, scheduling, and skip operations for topic lessons and book sessions.
- Every learner action verifies record ownership; cross-user access returns 404.
- Explicit **Accept and schedule** performs approval and scheduling in one action.
- Routine content no longer requires Admin.
- Admin is retained for monitoring and exceptional overrides.

### 2. Automatic progression

- Content that passes automated validation becomes approved and is scheduled automatically.
- Per-user automation settings allow the learner to disable automatic scheduling or change the delay later.
- Explicit learner acceptance schedules the item even when that user's automatic scheduling preference is disabled.
- The first weekly-plan task is queued once after onboarding when automatic start is enabled.

### 3. Visible review and waiting states

- Added a learner-facing **Needs your review** area.
- Weekly-plan lesson cards and book-session cards are openable and state-aware.
- Held content exposes Preview, Accept and schedule, Request changes, Skip, Deliver now, and schedule controls where valid.
- Draft or held book sessions no longer expose completion-only controls.
- Today now explains whether the system is waiting for plan approval, verified processing, review, generation, scheduling, or delivery.
- Queue terminology is separated into verified-processing tasks, local jobs, review holds, and deliveries.

### 4. Action-required communication

Web notices are immediately visible, and linked Telegram/WhatsApp channels are notified when applicable for:

- pending custom-GPT processing
- weekly-plan approval
- book-plan approval
- source upload requirements
- lesson or book-session review holds
- requested revisions
- unfinished-content backlogs
- failed internal jobs
- failed delivery on an individual channel

Telegram review notices include learner-owned Accept and schedule and Skip actions.

### 5. Startup reconciliation and legacy cleanup

A startup reconciliation pass now:

- repairs approved lessons or book sessions that lost their delivery job
- repairs scheduled items that have no active delivery job
- restores missing notices for legacy review holds
- restores notices for draft plans, source requirements, pending GPT tasks, and failed jobs

This directly covers existing 1.2.0 records that were created before the self-service workflow existed.

### 6. Lifecycle and concurrency safeguards

- Only approved content can be scheduled.
- Only scheduled content can be delivered.
- Only delivered content can be completed or receive reading progress.
- Feedback requires completion.
- Follow-up requires delivered or completed content.
- Review and revision close after delivery, completion, or skip.
- Completion and skip are idempotent.
- Recorded deliveries are not resent by repeated service calls.
- Skip and revision cancel pending delivery, reminder, and reinforcement work.
- Rescheduling is rejected after a delivery job has already entered `running`, preventing schedule-state races.

### 7. Scheduler and task reliability

- Stale local jobs left in `running` are recovered after a configurable timeout.
- Local jobs use bounded retries and backoff.
- Permanent job failure creates an action-required notice.
- Stale claimed custom-GPT tasks become reclaimable.
- Rejected GPT submissions retain diagnostics and remain correctable rather than silently completing.
- Unfinished-item limits pause delivery without losing work and notify the learner.

### 8. Quality-gate correction

- Blocking validation failures still hold content.
- Nonblocking source problems are recorded as warnings rather than unnecessarily blocking otherwise adequately supported content.
- Passed content follows the approved automatic-scheduling policy.

### 9. Security and privacy hardening

- Static-path containment uses canonical relative-path checks.
- Generated lesson/book card files require the owning learner's private session; they are no longer public static assets.
- Learner book APIs expose safe upload metadata but never return local `originalPath` or `textPath` values.
- Learner API ownership checks were expanded and tested.
- Input and configuration bounds were added for ports, timeouts, result limits, scheduling delays, retry counts, backups, and messaging intervals.
- HTTP responses now distinguish invalid input, lifecycle conflicts, missing records, oversized payloads, and unavailable services.

### 10. Product wording and documentation

- Removed misleading claims that approving a book plan means all sessions are already scheduled for delivery.
- Updated Today, Reading, Weekly Plan, Admin, setup, architecture, security, upgrade, and testing documentation.
- Centralized application version `1.3.0` and state schema version `4`.
- Added a production configuration validator for the automation-first operating mode.

## Validation performed

The final local source passed:

- `git diff --check`
- syntax checking for every JavaScript file under `src`, `public`, `scripts`, and `tests`
- `npm test`: **28 passed, 0 failed**
- `npm run check`: **28 passed, 0 failed**
- production-style `scripts/verify-config.js`: `ok: true`, no warnings, no failures
- the packaged archive was extracted into a clean temporary directory and its full 28-test suite passed
- the supplied patch passed `git apply --check` against the original 1.2.0 source snapshot

The test suite now covers:

- automatic first-plan workflow
- quality-pass automatic scheduling
- learner review and forced scheduling
- lesson and book-session ownership isolation
- revision/skip cancellation
- lifecycle conflicts and idempotency
- stale scheduler-job recovery
- stale GPT-task recovery
- startup reconciliation
- Telegram review actions
- private signed delivery links
- pending web notices
- private generated-card access
- removal of owned-copy filesystem paths from learner APIs

## Remaining limitations and items requiring live verification

### ChatGPT Business processing

A ChatGPT Business subscription cannot be invoked unattended by this Node service. In `chatgpt_business` mode, the server queues work and notifies the learner to open the configured custom GPT. Quality validation, scheduling, delivery, reminders, and learner review are automated after a valid submission. Fully unattended generation requires an API or local model.

### Single-instance JSON architecture

The atomic JSON store is appropriate for this private, small deployment and must run as exactly one application instance. SQLite or PostgreSQL is required before multi-instance or materially higher-concurrency use.

### Live deployment not performed

The supplied live server showed both `node server.js` and `node src/index.js` processes under `www`, while the SSH user's PM2 registry was empty. The correct owner and manager must be identified before restart. The application should run exactly one `node src/index.js` instance.

### External integration smoke tests

The user confirmed that the existing scheduler and Telegram delivery work after manual Admin approval. The new learner-owned Telegram actions, startup reconciliation, and production reverse-proxy behavior still require a controlled post-deployment smoke test.

### Dependency audit

The review archive did not include installed `node_modules`, and package installation was not completed in the isolated inspection environment. Run `npm ci --omit=dev` and `npm audit --omit=dev` on the deployment server before restart. Treat any reported vulnerability according to whether the affected path is used in production.

## Deployment decision

The source package is ready for a staged upgrade, not a blind overwrite. Preserve `.env` and the complete `data/` directory, identify and stop only the confirmed Knowledge Pilot process, install locked dependencies, run validation, restart one instance, reimport the custom-GPT schema/instructions, and complete the smoke test in the deployment checklist.
