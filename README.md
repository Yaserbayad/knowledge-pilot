# Knowledge Pilot 1.4.1

Knowledge Pilot is a self-hosted adaptive topic-learning and guided-reading system. It delivers validated lessons and book sessions through a private learner dashboard, Telegram, and optional WhatsApp Web. Operational state is stored in an atomic local JSON database; learner-owned book files remain in a private server directory.

## Product workflow

Knowledge Pilot is learner-owned and automation-first:

1. Onboarding captures the learner’s interests, level, exclusions, cadence, and delivery channels.
2. The system queues the first weekly plan automatically.
3. The learner approves or edits a weekly plan or book plan once.
4. Generated content that passes automated validation is approved, scheduled, and delivered automatically.
5. Content that needs judgment appears in **Needs your review** with **Accept and schedule**, **Request changes**, and **Skip** controls.
6. Telegram and the web dashboard notify the learner whenever processing, a decision, a source upload, or recovery action is required.
7. The administrator console is for monitoring and exceptional overrides, not routine learning decisions.

Learners can disable automatic scheduling or change the delivery delay at any time. Explicit learner acceptance always schedules the item without requiring an administrator.

## Main capabilities

### Topic learning

- Private learner links and editable onboarding/profile
- Automatic first-plan creation and coherent weekly plans
- Verified five-to-ten-minute lessons
- Closed-by-default Today cards, structured lesson covers, and a centered guided reader
- Durable section anchors, cross-device resume, race-safe autosave, knowledge checks, notes, highlights, and confidence review
- Soft light, dark, and warm reading themes, text sizing, focus mode, accessible drawers, and complete lesson-level RTL behavior
- Claim/source mapping, adversarial critique, final audit, and automated quality gates
- Self-service review, revision, scheduling, skipping, completion, feedback, follow-ups, reminders, reinforcement, progress, and library

### Guided reading

- Dedicated Reading workspace separate from topic learning
- Add by title/author, ISBN, or HTTPS catalogue/publisher URL
- Lawful learner-owned PDF, EPUB, TXT, or Markdown upload, up to 30 MB
- Source-quality assessment and explicit insufficient-source workflow
- Learner-approved duration and structure followed by automated session generation and delivery
- Session summaries, context, criticism, application, assessment, notes, bookmarks, pace, depth, pause/resume, archive/restart, and topic-link controls
- Telegram/WhatsApp/web delivery with book and session labels

### Reliability and operations

- Schema version 5 with backward-compatible lesson-experience normalization
- Learner self-deletion and administrator deletion with complete user-owned data and private-file cleanup
- Atomic JSON writes and rotating state backups
- Idempotent completion and skipping, plus duplicate guards after delivery is recorded
- Stale scheduler-job and GPT-task recovery
- Per-user ownership checks on all learner actions
- Private signed learner links in channel messages
- Clear separation between verified-processing tasks, local scheduled jobs, review holds, and delivery state
- Web-visible action notices before the scheduler has finished sending channel notifications

## Architecture

```text
Learner dashboard / Admin monitoring
              |
              v
Node.js service ---------------- Atomic JSON state
   |      |                          |
   |      +-- local scheduler        +-- users, plans, lessons, books,
   |                                  sessions, jobs, notices, progress
   +-- Telegram / optional WhatsApp
   +-- private owned-copy files
   +-- authenticated GPT Action API
                    |
                    v
          Private ChatGPT Business custom GPT
       research -> draft -> critique -> audit -> submit
```

## ChatGPT Business limitation

A ChatGPT Business subscription cannot be invoked unattended by this server. In `chatgpt_business` mode, Knowledge Pilot queues verified-processing tasks and notifies the learner when the custom GPT must be opened. Run:

```text
Process all pending Knowledge Pilot tasks.
```

Everything after a valid submission—quality gating, scheduling, delivery, reminders, and learner review—is automated. Fully unattended generation requires a separately configured API or local model.

## Installation

```bash
cd /www/wwwroot/knowledgepilot
cp .env.example .env
node scripts/generate-secrets.js
npm install --omit=dev
node scripts/verify-config.js
npm run check
```

Set at minimum:

```dotenv
APP_BASE_URL=https://learn.example.com
AI_PROVIDER=chatgpt_business
GPT_ACTIONS_ENABLED=true
GPT_AUTO_SCHEDULE_APPROVED=true
GPT_AUTO_SCHEDULE_DELAY_MINUTES=2
AUTO_START_FIRST_PLAN=true
NOTIFY_ACTION_REQUIRED=true
CUSTOM_GPT_URL=https://chatgpt.com/g/...
```

Use one process manager only. The supported entry point is:

```bash
node src/index.js
```

For aaPanel and safe upgrades, read [START-HERE.md](START-HERE.md), [UPGRADE-1.4.1.md](UPGRADE-1.4.1.md), and [docs/AAPANEL_DEPLOYMENT.md](docs/AAPANEL_DEPLOYMENT.md).

## Data layout

```text
data/state.json             live operational database
data/backups/               rotating JSON state backups
data/cards/                 generated topic/book cards
data/book-files/            private owned copies and extracted text
data/whatsapp-auth/         WhatsApp session credentials
```

The built-in backup command copies JSON state. A server-level backup must archive the complete `data/` directory to include owned book files.

## Commands

```bash
npm start
npm test
npm run check
npm run backup
npm run generate-secrets
node scripts/verify-config.js
```

## GPT Action

- Schema: `https://YOUR_DOMAIN/gpt-action/openapi.json`
- Authentication: Bearer value from `GPT_ACTION_API_KEY`
- Instructions: `docs/CUSTOM_GPT_INSTRUCTIONS.md`

After an upgrade, reimport the schema and replace the custom GPT instructions.

## Security

- Bind Node.js to `127.0.0.1`; expose only the HTTPS reverse proxy.
- Keep `.env`, `data/`, and owned copies outside public static routes.
- Run one instance under a dedicated restricted user.
- Allow at least 35 MB request bodies in Nginx for 30 MB uploads.
- GPT access to owned text is authenticated, bounded, and read-only.
- Learner APIs verify record ownership and return no cross-user content.

See [docs/SECURITY.md](docs/SECURITY.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and [docs/CHATGPT_BUSINESS_SETUP.md](docs/CHATGPT_BUSINESS_SETUP.md).
