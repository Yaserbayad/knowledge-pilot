# ChatGPT Business custom GPT setup — 1.3.0

## Purpose and limitation

The private custom GPT is Knowledge Pilot’s research and editorial engine. It processes topic and book tasks, reads bounded owned-book chunks when authorized, critiques its work, performs the final audit, and submits structured results.

A ChatGPT Business subscription cannot be invoked unattended by this Node service. The server therefore queues tasks and sends an action-required notice. Open the custom GPT and process the queue. After submission, validation, scheduling, delivery, reminders, and learner review are automatic.

## 1. Server configuration

These HTTPS endpoints must work:

```text
https://YOUR_DOMAIN/health
https://YOUR_DOMAIN/gpt-action/openapi.json
https://YOUR_DOMAIN/privacy
```

Recommended `.env` values:

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

`CUSTOM_GPT_URL` lets Telegram and the dashboard take the learner directly to the processor when verified work is waiting.

## 2. Create or update the GPT

| Field | Value |
|---|---|
| Name | Knowledge Pilot |
| Description | Verified adaptive topic and guided-reading research engine |
| Model | Strongest available Action-compatible model |
| Reasoning | Highest available |
| Web search | Enabled |
| Code Interpreter | Enabled |
| Visibility | Private |

Paste the complete `docs/CUSTOM_GPT_INSTRUCTIONS.md` into Instructions.

## 3. Configure the Action

- Authentication: API key
- Type: Bearer
- Key: exact `GPT_ACTION_API_KEY`
- Import: `https://YOUR_DOMAIN/gpt-action/openapi.json`

Allow the Knowledge Pilot domain if the workspace restricts Action domains.

## 4. Queue terminology

Knowledge Pilot has three distinct states:

- **Verified-processing tasks:** waiting for the custom GPT, claimed by it, completed, or failed.
- **Local jobs:** future generation triggers, delivery, reminders, reinforcement, notices, and backups.
- **Review holds:** generated content that exists but needs learner judgment.

A custom-GPT report of `Pending: 0` only means no currently processable verified task. It does not mean there are no future local jobs or review-held items.

## 5. Test

In GPT Preview:

```text
Check Knowledge Pilot for pending tasks.
```

Then:

```text
Process the next pending Knowledge Pilot task.
```

Confirm:

- the task changes to completed
- validated content auto-schedules
- held content appears in the learner dashboard
- Telegram sends either the content or an action-required notice
- no routine Admin action is required

## 6. Book task behavior

Supported book operations include identity/source analysis, bounded owned-copy reading, plan generation, core sessions, final synthesis, follow-ups, and reinforcement evaluation.

The GPT must retrieve owned-copy chunks repeatedly using `nextOffset`. It must never claim to have read unretrieved text. Output must be transformative and all quotations in one session must total no more than 25 words.

Fiction remains identified but deferred by the current guided-reading workflow unless the implementation is extended.

## 7. Book-analysis submission contract

Use the dedicated operation `submitBookAnalysisResult`. Submit `metadata`, `sourceAssessment`, `plan`, `sources`, and `verification` at the request root. HTTP 422 is retryable and contains field diagnostics; correct and resubmit the same task.

## 8. Normal command

```text
Process all pending Knowledge Pilot tasks. Research each task thoroughly, retrieve every relevant owned-book chunk provided, verify material claims using credible sources, perform the required adversarial critique and final audit, and submit only outputs that satisfy the Knowledge Pilot standard.
```

## 9. Upgrade procedure

After server upgrade:

1. Replace Instructions.
2. Delete the old Action schema.
3. Reimport `/gpt-action/openapi.json`.
4. Preserve the Bearer key.
5. Save privately and rerun the test commands.
