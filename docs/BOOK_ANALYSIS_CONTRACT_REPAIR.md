# Book-analysis contract repair — v1.2.3

## Observed symptom

A custom GPT could report that a complete analysis and plan were submitted, while Knowledge Pilot stored `plan=null`, left the book in `source_required` or `analysis_failed`, and sometimes marked the Business task completed.

## Confirmed root causes

1. **Generic result schema:** every task type shared one large optional superset schema. This made the Action call ambiguous and allowed the nested book plan to be omitted, wrapped, stringified, or renamed.
2. **Silent normalization:** `normalizeBookAnalysis()` treated a missing plan as an empty object and supplied defaults. The server therefore could not distinguish “no plan arrived” from “a deliberately limited analysis.”
3. **False terminal state:** a structurally empty normalized plan could still produce a successful book-analysis handler response with `plan=null`; the outer task layer then marked the task completed.
4. **Wrong failure classification:** the custom GPT could call the failure endpoint after a schema/contract error, turning an integration defect into `analysis_failed`.
5. **Concurrent reanalysis race:** the old dedupe key included the current timestamp. Every Re-analyze click created a separate active task, and later submissions could overwrite earlier state.
6. **Stale dashboard evidence:** reanalysis did not clear the previous `limited` source badge and limitations while new analysis was pending.
7. **Insufficient diagnostics:** rejected or accepted submission structure was not retained, making it difficult to prove whether the server received the intended session plan.

## v1.2.3 correction

- Added the dedicated `submitBookAnalysisResult` Action.
- Added `contractVersion=book-analysis.v2`.
- Validates the complete result before source fetching or state mutation.
- Returns HTTP 422 with exact field errors for missing or malformed plans.
- Keeps retryable contract errors pending and the book in `queued_analysis`.
- Stores payload fingerprint, received keys, wrapper path, session count, source count, and accepted canonical result.
- Accepts common harmless wrappers/aliases for backward compatibility, including stringified nested plan JSON, but always converts to one canonical contract.
- Prevents schema/integration errors from being reported as substantive analysis failures.
- Enforces one active analysis task per book and rejects stale task results.
- Supersedes legacy timestamped pending tasks when a new analysis is requested.
- Clears stale source status when reanalysis begins.
- Supersedes older draft plans when a new verified plan is accepted.
- Repairs submitted duration upward when the session count requires more weeks at the chosen cadence.

## Exact regression case

The automated suite verifies a book with:

- 878,553 extracted owned-copy characters
- two independently fetched external reviews
- `sufficientForDetailedPlan=false` from the model
- a complete 18-session plan
- a submitted four-week duration at three sessions per week

Expected result:

- submission accepted
- 18 sessions preserved
- duration normalized to six weeks
- source quality promoted from limited to medium
- status `awaiting_plan_approval`
- non-null stored plan
- completed task containing accepted-result diagnostics
