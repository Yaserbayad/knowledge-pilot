# Architecture and data flow

## Runtime components

### Node.js application

One `node src/index.js` service provides HTTP APIs, learner/admin interfaces, private-link authentication, JSON persistence, local scheduling, Telegram, optional WhatsApp Web, quality validation, verified-processing task management, and private book-file access. Run exactly one production instance while the JSON store is the persistence boundary.

The production HTTP boundary uses byte-capped request parsing, same-origin protection for authenticated browser mutations, strict security headers/CSP, correlation IDs, minimal public health output, and redacted request-error logging.

### JSON store

Writes are serialized. Each transaction mutates a draft, writes and atomically renames the durable state file, and publishes the new in-memory state only after persistence succeeds. The store rejects state created by a future unsupported schema rather than rewriting it.

Schema version 5 contains:

- users and per-user automation preferences
- weekly plans and topic lessons
- books, book plans, and book sessions
- verified-processing tasks
- local scheduled jobs
- messages/notices, interactions, and progress

Supported older state is normalized on startup. This architecture is appropriate for one small/private installation; multi-instance deployment requires replacing the JSON authority with a concurrency-safe shared datastore.

At startup, workflow reconciliation repairs approved/scheduled items that lost recoverable local work and restores missing learner notices. Accepted verified-processing results are terminal and are not downgraded because a later acknowledgement is ambiguous.

### Local scheduler

The scheduler handles generation triggers, delivery, reminders, reinforcement, direct responses, system notices, and backups. It:

- claims jobs atomically
- prevents overlapping ticks
- retries bounded operations when retry is safe
- persists intent before external delivery effects
- fails closed on stale/ambiguous external-send work instead of blindly repeating it
- pauses delivery when the unfinished-item limit is reached
- notifies the learner when action or recovery is required

### Verified-processing queue

In `chatgpt_business` mode, the application creates authenticated bounded processing tasks. Results are normalized and validated before they become authoritative application state. Accepted artifacts and terminal task completion are committed in the same durable transaction where required, so a later scheduling/notification failure does not turn already accepted content back into retryable work.

Task output is bounded by type, cardinality, field length, source metadata, HTTPS source rules, and compact verification metadata. Completed tasks keep references/acceptance diagnostics, not redundant full accepted payloads.

The queue can be processed manually or through the optional Workspace Agent bridge. It remains separate from local scheduled jobs and review holds.

### Workspace Agent bridge

`automation/workspace-agent` is a separate trust boundary used for unattended verified-processing invocation when configured. It:

- binds MCP to loopback only
- exposes only an authenticated, unguessable reverse-proxy route when needed
- keeps the Knowledge Pilot Action key server-side
- requires HTTPS for credential-bearing non-loopback endpoints
- streams and caps response bodies
- persists exact trigger intent, prompt fingerprint, and idempotency key before the external POST
- reuses the same unresolved intent on retry
- blocks overlapping work while a prior run is ambiguous
- omits learner content and credentials from logs

Its automatic timer is disabled until target-environment lesson and book end-to-end checks pass.

### Owned-copy store

`data/book-files/<user>/<book>/` contains private learner-owned source files and bounded extracted text. Paths use validated identity segments and both lexical and resolved-path containment checks, preventing traversal and symlink escape. The files are not served statically.

Verified-processing actions can retrieve read-only bounded chunks only in authenticated task context. Learner APIs expose safe owned-copy metadata and never return server filesystem paths. Generated card files require the owning learner's private session.

### Outbound research / AI HTTP

External research and AI requests use bounded streaming readers rather than unbounded full-body buffering. Research destinations reject prohibited private/reserved address ranges, validate redirects, and pin the already validated DNS address into the actual outbound connection to close DNS-rebinding gaps.

## Learner-owned lifecycle

```text
Onboarding
  -> initial weekly-plan task queued automatically
  -> learner approves/edits plan
  -> generation job or verified-processing task
  -> server validates content
       -> passed: approved + automatically scheduled
       -> held: learner notified and shown review controls
  -> learner may accept, request changes, reschedule, or skip
  -> web + linked-channel delivery
  -> completion, feedback, follow-up, and spaced reinforcement
```

Routine content does not require administrator intervention. Admin can inspect state and use exceptional override controls.

## Topic-learning lifecycle

```text
weekly plan draft
  -> learner approval
  -> generation work at planned cadence
  -> lesson processing
  -> approved | needs_review
  -> scheduled
  -> delivered
  -> completed | skipped
```

Completed lesson progress is terminal at 100% and cannot regress. Approving a replacement plan retires pending/claimed work that belongs only to superseded plan state.

## Book lifecycle

```text
add book + initial analysis task (atomic)
  -> identity/source analysis
  -> source_required | unsupported | plan awaiting approval
  -> learner approves duration and structure
  -> core generation work at selected cadence
  -> session processing and validation
  -> approved | needs_review
  -> scheduled and delivered
  -> completed | skipped
  -> final synthesis after core completion
```

Book creation and its initial analysis task share one transaction. Re-analysis replacement state/task creation is atomic. Duplicate-add and active-book-limit decisions are enforced inside the serialized mutation boundary. Invalid lifecycle jumps are rejected, and skipped sessions stay skipped when a book resumes.

Topic lessons and book sessions have separate records, cadence, progress, and controls. They share users, channels, scheduling, notices, follow-up infrastructure, and optional knowledge connections.

## Quality behavior

Blocking issues hold content for the learner. Examples include missing required instructional elements, insufficient independently verified sources, unsupported claims, failed final audit, sensitive-topic review, or invalid book references.

Nonblocking warnings reduce the quality score but do not prevent scheduling when enough valid support remains. An optional failed source is excluded from validation and recorded as a warning.

## Lifecycle safeguards

- Only approved items can be scheduled.
- Only scheduled items can be delivered.
- Only delivered items can be completed or receive ordinary reading progress.
- Completed progress cannot be reduced.
- Feedback follows completion.
- Follow-up questions require delivered or completed content.
- Review/revision is closed after delivery, completion, or skip.
- Completion and skip are idempotent; recorded/ambiguous external delivery is not blindly repeated.
- Skip/revision/supersession cancels or retires stale downstream work.
- Every learner API verifies record ownership.
- Telegram and WhatsApp account binding use signed, expiring channel-specific tokens.

## Frontend boundary

The learner/admin pages use an external theme bootstrap compatible with the strict CSP. Dynamic dialogs use labeled focus-managed surfaces with Escape handling, Tab trapping, and focus restoration. Service-worker caching is limited to the public shell/assets and excludes API and private learner URLs.

## Notices

Action-required events are immediately visible in the learner web API and may also be queued for Telegram/WhatsApp delivery. Channel delivery failures do not remove the web-visible notice.

## Backup boundary

Built-in backups copy `state.json`; they do not duplicate owned book files. Server-level backups must archive the complete `data/` directory. Application deployment preserves `.env` and `data/` while release-owned source—including `automation/`—is replaced from one immutable release.
