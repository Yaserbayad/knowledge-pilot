# Guided-reading and self-service test checklist — 1.3.0

## Deployment

- `/health` is successful and scheduler timestamps advance.
- GPT Action schema reports application version 1.3.0.
- Admin reports state schema version 4.
- Exactly one `node src/index.js` service owns the configured port.
- `.env` and the complete `data/` directory are backed up.

## Book setup

- Add a nonfiction book and process `book_analysis`.
- Correct metadata, source assessment, and session plan appear.
- Insufficient source coverage requests an owned copy and notifies the learner.
- Approving duration/structure creates future session-generation jobs.

## Automatic path

- A session passing validation becomes `scheduled` automatically.
- It reaches Reading and Telegram/WhatsApp at the scheduled time.
- It is not sent twice if a delivery job is retried.

## Held-content path

- A session with blocking issues appears in the learner’s **Needs your review** area.
- Telegram sends an action-required notice.
- Learner can preview, accept and schedule, request changes, or skip.
- Accepting schedules immediately without Admin.
- Requesting changes queues a revision and cancels stale delivery work.
- Skipping cancels delivery, reminder, and reinforcement work.

## Lifecycle integrity

- Draft/scheduled content cannot be marked complete.
- Notes and bookmarks are available only for delivered/completed sessions.
- Follow-up questions are available only after delivery.
- Completion is idempotent and schedules reinforcement once.
- Pause defers delivery; archive cancels it; resume restores future work.
- Cross-user reads and actions return 404.

## Topic-learning parity

Repeat the automatic and held-content tests for a weekly-plan lesson. Weekly lesson cards must be openable and expose the same learner-owned actions.

## Admin role

- Admin can monitor queues, failures, and state.
- Admin override controls work for exceptional recovery.
- Normal lesson and book-session delivery requires no Admin action.
