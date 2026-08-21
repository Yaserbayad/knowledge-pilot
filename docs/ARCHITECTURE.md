# Architecture and data flow — 1.3.0

## Runtime components

### Node.js application

One `node src/index.js` service provides HTTP APIs, learner and admin interfaces, private-link authentication, JSON persistence, local scheduling, Telegram, optional WhatsApp Web, quality validation, GPT-task management, and private book-file access. Run exactly one production instance unless the JSON store is replaced by a concurrency-safe database.

### JSON store

Writes are serialized, written to a temporary file, and atomically renamed to `data/state.json`. Schema version 4 contains:

- users and per-user automation preferences
- weekly plans and topic lessons
- books, book plans, and book sessions
- verified-processing tasks
- local scheduled jobs
- messages/notices, interactions, and progress

Older state is normalized automatically. This architecture is appropriate for a small private installation. Use SQLite or PostgreSQL before multi-instance or high-concurrency deployment.

At startup, workflow reconciliation repairs approved or scheduled items that lost their delivery job and restores missing learner notices for review holds, draft plans, source requirements, pending verified-processing tasks, and failed jobs.

### Local scheduler

The scheduler handles generation triggers, delivery, reminders, reinforcement, direct responses, system notices, and backups. It:

- claims jobs atomically
- prevents overlapping ticks
- retries failures with bounded attempts
- recovers jobs left in `running` after an interrupted process
- pauses delivery when the unfinished-item limit is reached
- notifies the learner when action or recovery is required

### Verified-processing queue

In `chatgpt_business` mode, the server cannot invoke the Business subscription. It creates authenticated GPT tasks. The custom GPT claims a task, researches it, submits a structured result, and the server validates and integrates the result. Stale task claims become reclaimable.

This queue is separate from local scheduled jobs. The dashboard and Admin report them separately.

### Owned-copy store

`data/book-files/<user>/<book>/` contains the original private upload and bounded extracted text. It is not served statically. GPT Actions can retrieve read-only chunks only through authenticated task context.

Learner APIs expose only safe owned-copy metadata and never return server filesystem paths. Generated lesson-card files require the owning learner's private session and are not public static assets.

## Learner-owned lifecycle

```text
Onboarding
  -> initial weekly-plan task queued automatically
  -> learner approves/edits plan
  -> generation job or GPT task
  -> server validates content
       -> passed: approved + automatically scheduled
       -> held: learner notified and shown review controls
  -> learner may accept, request changes, reschedule, or skip
  -> web + linked-channel delivery
  -> completion, feedback, follow-up, and spaced reinforcement
```

Routine content never requires administrator intervention. Admin can inspect state and use exceptional override controls.

## Topic-learning lifecycle

```text
weekly plan draft
  -> learner approval
  -> three generation jobs at planned cadence
  -> lesson processing
  -> approved | needs_review
  -> scheduled
  -> delivered
  -> completed | skipped
```

## Book lifecycle

```text
add book
  -> identity/source analysis
  -> source_required | unsupported | plan awaiting approval
  -> learner approves duration and structure
  -> core generation jobs at selected cadence
  -> session processing and validation
  -> approved | needs_review
  -> scheduled and delivered
  -> completed | skipped
  -> final synthesis after core completion
```

Topic lessons and book sessions have separate records, cadence, progress, and controls. They share users, channels, scheduling, notices, follow-up infrastructure, and optional knowledge connections.

## Quality behavior

Blocking issues hold content for the learner. Examples include missing required instructional elements, insufficient independently verified sources, unsupported claims, failed final audit, sensitive-topic review, or invalid book references.

Nonblocking warnings reduce the quality score but do not prevent scheduling when enough valid support remains. An optional failed source is excluded from validation and recorded as a warning.

## Lifecycle safeguards

- Only approved items can be scheduled.
- Only scheduled items can be delivered.
- Only delivered items can be completed or receive reading progress.
- Feedback follows completion.
- Follow-up questions require delivered or completed content.
- Review/revision is closed after delivery, completion, or skip.
- Completion and skip are idempotent; recorded deliveries are not sent again.
- Skip/revision cancels pending downstream jobs.
- Every learner API verifies record ownership.

## Notices

Action-required events are queued as `send_system_notice` jobs and are immediately visible in the learner web API, even before Telegram/WhatsApp delivery finishes. Channel failure notices remain visible on the web.

## Backup boundary

Built-in backups copy `state.json`. They do not duplicate owned book files. Server-level backups must archive the complete `data/` directory.
