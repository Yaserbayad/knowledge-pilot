# Knowledge Pilot

Knowledge Pilot is a self-hosted adaptive topic-learning and guided-reading system. It delivers validated lessons and book sessions through a private learner dashboard, Telegram, and optional WhatsApp Web. Operational state is stored in an atomic local JSON database; learner-owned book files remain in a private server directory. Release identity is defined by the immutable GitHub release tag and the repository `VERSION` file.

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
- Soft light, dark, and warm reading themes, text sizing, focus mode, accessible dialogs, and complete lesson-level RTL behavior
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
- Idempotent completion/skipping and fail-closed handling of ambiguous external delivery effects
- Stale scheduler-job and verified-processing task recovery
- Per-user ownership checks on learner actions and signed expiring channel bindings
- Private signed learner links in channel messages
- Bounded outbound HTTP responses, SSRF protections, pinned validated DNS resolution, and strict production endpoint validation
- Strict browser security headers/CSP, origin protection for authenticated mutations, safe request logging, and correlation IDs
- Clear separation between verified-processing tasks, local scheduled jobs, review holds, and delivery state

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
   +-- authenticated verified-processing API
                    |
        +-----------+-----------+
        |                       |
        v                       v
Private ChatGPT Business   Optional Workspace Agent bridge
processing workflow        (loopback MCP + guarded trigger)
```

## ChatGPT Business processing

In `chatgpt_business` mode, Knowledge Pilot queues bounded verified-processing tasks rather than sending learner content to an OpenAI API from the application server.

Two operating modes are supported:

- **Manual fallback:** open the configured private ChatGPT Business processing workflow and process pending Knowledge Pilot tasks.
- **Workspace Agent automation:** `automation/workspace-agent` exposes the bounded queue through an authenticated loopback MCP bridge and invokes a published ChatGPT Workspace Agent only when pending work exists. Trigger intent/idempotency is persisted before the external call and ambiguous runs fail closed. The automatic timer must remain disabled until end-to-end lesson and book automation are verified on the target installation.

Everything after a valid result submission—quality gating, scheduling, delivery, reminders, learner review, and local recovery—is handled by Knowledge Pilot.

## Installation and deployment

For production aaPanel deployment, use [START-HERE.md](START-HERE.md) and the canonical [immutable-release runbook](docs/AAPANEL_DEPLOYMENT.md). Production releases are staged and verified from an immutable semantic release tag plus its exact commit SHA; do not deploy a moving branch or reuse old release-owned source.

After the one-time deployer bootstrap, an ordinary production release is invoked with the same permanent command every time:

```bash
sudo deploy-knowledge-pilot vX.Y.Z <EXPECTED_40_CHARACTER_COMMIT_SHA>
```

The repository-owned engine is `scripts/deploy-release.sh`; `scripts/install-deployer.sh` installs it once as `/usr/local/sbin/deploy-knowledge-pilot` from an exact merged source commit. The installed engine is deliberately upgraded separately when deployment architecture changes; it does not replace itself while an application deployment is running.

For a brand-new configuration before first production start:

```bash
cd /www/wwwroot/knowledgepilot
cp .env.example .env
node scripts/generate-secrets.js
# Edit .env without exposing its values in logs.
npm ci --omit=dev --ignore-scripts
node scripts/verify-config.js
npm run check
```

The repository-owned `scripts/install-aapanel.sh` is a fail-closed **staged-release preparation** command for an existing configured staging tree. It performs a locked full dependency install, configuration verification, the complete current application check/test suite, the high-severity production dependency audit, and then a production-only locked install. It never starts or changes a process manager.

Use one process manager only. The supported application entry point is:

```bash
node src/index.js
```

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

Workspace Agent verification is separate:

```bash
cd automation/workspace-agent
npm ci --ignore-scripts
npm run check
npm audit --omit=dev --audit-level=high
```

## Verified-processing action

- Schema: `https://YOUR_DOMAIN/gpt-action/openapi.json`
- Authentication: Bearer value from `GPT_ACTION_API_KEY`
- Processing instructions: `docs/CUSTOM_GPT_INSTRUCTIONS.md`

When the action contract or processing instructions change, update the configured ChatGPT Business processing workflow before enabling unattended triggers.

## Security

- Bind Node.js to `127.0.0.1`; expose only the HTTPS reverse proxy.
- Keep `.env`, `data/`, and owned copies outside public static routes.
- Run one application instance under a dedicated restricted user.
- Allow at least 35 MB request bodies in Nginx for 30 MB uploads.
- Verified-processing access to owned text is authenticated, bounded, and read-only.
- Learner APIs verify record ownership and return no cross-user content.
- Keep the Workspace Agent MCP service on loopback and expose only its authenticated unguessable proxy route when required.
- Use repository-specific read-only GitHub deployment credentials on the server; remove temporary write-capable bootstrap credentials before production closure.

See [docs/SECURITY.md](docs/SECURITY.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/CHATGPT_BUSINESS_SETUP.md](docs/CHATGPT_BUSINESS_SETUP.md), and [automation/workspace-agent/README.md](automation/workspace-agent/README.md).
