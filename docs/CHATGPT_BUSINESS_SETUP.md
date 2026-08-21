# ChatGPT Business processing setup

## Purpose

The private ChatGPT Business processing workflow is Knowledge Pilot’s research and editorial engine. It processes topic and book tasks, reads bounded owned-book chunks when authorized, critiques its work, performs the final audit, and submits structured results back to Knowledge Pilot.

Knowledge Pilot supports two ways to invoke that processing workflow:

- **Manual fallback:** the server queues verified-processing tasks and the learner/operator opens the private processing workflow when notified.
- **Workspace Agent automation:** the repository-owned `automation/workspace-agent` bridge exposes the bounded task API through authenticated MCP and invokes a published ChatGPT Workspace Agent only when processable work exists. The bridge persists the exact trigger intent and idempotency key before the external request; ambiguous runs block overlap rather than being blindly retried.

After a valid result is submitted, Knowledge Pilot handles validation, scheduling, delivery, reminders, review holds, and local recovery automatically.

## 1. Knowledge Pilot server configuration

These HTTPS endpoints must work:

```text
https://YOUR_DOMAIN/health
https://YOUR_DOMAIN/gpt-action/openapi.json
https://YOUR_DOMAIN/privacy
```

Relevant `.env` values:

```dotenv
AI_PROVIDER=chatgpt_business
GPT_ACTIONS_ENABLED=true
GPT_ACTION_API_KEY=YOUR_LONG_RANDOM_SECRET
GPT_AUTO_SCHEDULE_APPROVED=true
GPT_AUTO_SCHEDULE_DELAY_MINUTES=2
GPT_TASK_CLAIM_TIMEOUT_MINUTES=30
GPT_NOTIFY_PENDING_TASKS=true
CUSTOM_GPT_URL=https://chatgpt.com/g/...
```

Keep the real bearer value private. `CUSTOM_GPT_URL` is useful for the manual fallback and for action-required links; it is not a server credential.

## 2. Create or update the private processing workflow

For a custom-GPT/manual fallback, use:

| Field | Value |
|---|---|
| Name | Knowledge Pilot |
| Description | Verified adaptive topic and guided-reading research engine |
| Model | Strongest available Action-compatible model appropriate to the workflow |
| Web search | Enabled |
| Code Interpreter | Enabled when needed |
| Visibility | Private |

Use the complete repository-owned `docs/CUSTOM_GPT_INSTRUCTIONS.md` as the processing instructions.

## 3. Configure the verified-processing Action

- Authentication: API key
- Type: Bearer
- Key: exact `GPT_ACTION_API_KEY`
- Import: `https://YOUR_DOMAIN/gpt-action/openapi.json`

Allow the Knowledge Pilot domain if the workspace restricts Action domains.

## 4. Queue terminology

Knowledge Pilot has three distinct states:

- **Verified-processing tasks:** waiting for processing, claimed, completed, or failed.
- **Local jobs:** future generation triggers, delivery, reminders, reinforcement, notices, and backups.
- **Review holds:** generated content that exists but needs learner judgment.

A processing report of `Pending: 0` only means no currently processable verified task. It does not mean there are no future local jobs or review-held items.

## 5. Manual-fallback test

In the private processing workflow, run:

```text
Check Knowledge Pilot for pending tasks.
```

Then:

```text
Process the next pending Knowledge Pilot task.
```

Confirm:

- the task changes to completed
- validated content auto-schedules once
- held content appears in the learner dashboard
- Telegram sends either the content or an action-required notice when enabled
- no routine Admin action is required

## 6. Workspace Agent automation

The bridge lives in `automation/workspace-agent` and is a separate trust boundary.

Safety requirements:

- MCP binds to loopback only.
- The public reverse-proxy path is unguessable and independently bearer-authenticated.
- The Knowledge Pilot Action key is kept server-side.
- Credential-bearing remote URLs require HTTPS; explicit loopback HTTP is allowed only for the local Knowledge Pilot service.
- Empty-queue checks do not invoke a Workspace Agent.
- Trigger intent, prompt fingerprint, and idempotency key are durable before the external POST.
- Retries reuse the same exact unresolved intent.
- Oversized responses are cancelled while streaming rather than fully buffered.
- Logs exclude credentials and learner content.
- The automatic trigger timer remains disabled until target-environment lesson and book end-to-end tests pass.

Install and verify the bridge from the same immutable release as the application:

```bash
cd /www/wwwroot/knowledgepilot/automation/workspace-agent
npm ci --ignore-scripts
npm run check
npm audit --omit=dev --audit-level=high
npm ci --omit=dev --ignore-scripts
```

Server integration is performed by `deploy/configure-server.mjs`, which preserves existing bridge secrets/path identity and renders the Node binary that actually runs the installer into the systemd unit templates. Follow [AAPANEL_DEPLOYMENT.md](AAPANEL_DEPLOYMENT.md) rather than invoking deployment steps ad hoc.

Before enabling `knowledgepilot-agent-trigger.timer`, prove one manual trigger cycle and one timer-triggered cycle for both lesson and book work, with no duplicate result or overlapping ambiguous run.

## 7. Book task behavior

Supported book operations include identity/source analysis, bounded owned-copy reading, plan generation, core sessions, final synthesis, follow-ups, and reinforcement evaluation.

The processor must retrieve owned-copy chunks repeatedly using `nextOffset`. It must never claim to have read unretrieved text. Output must be transformative and all quotations in one session must total no more than 25 words.

Fiction remains identified but deferred by the current guided-reading workflow unless the implementation is extended.

## 8. Book-analysis submission contract

Use the dedicated operation `submitBookAnalysisResult`. Submit `metadata`, `sourceAssessment`, `plan`, `sources`, and `verification` at the request root. HTTP 422 is retryable and contains bounded field diagnostics; correct and resubmit the same task.

## 9. Normal manual command

```text
Process all pending Knowledge Pilot tasks. Research each task thoroughly, retrieve every relevant owned-book chunk provided, verify material claims using credible sources, perform the required adversarial critique and final audit, and submit only outputs that satisfy the Knowledge Pilot standard.
```

## 10. Release updates

When the action contract or processing instructions change:

1. Deploy and verify the immutable server release first.
2. Replace processing Instructions from `docs/CUSTOM_GPT_INSTRUCTIONS.md`.
3. Reimport `/gpt-action/openapi.json` while preserving the private Bearer key.
4. Re-run the manual processing test.
5. Re-run the Workspace Agent end-to-end tests before re-enabling unattended triggers.
