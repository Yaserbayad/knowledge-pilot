# Security notes

## Secrets

Protect `APP_SECRET`, `ADMIN_TOKEN`, `GPT_ACTION_API_KEY`, `TELEGRAM_WEBHOOK_SECRET`, Workspace Agent bearer/access credentials, `.env`, WhatsApp credentials, deployment credentials, and the complete `data/` directory. Production startup rejects weak/placeholder application secrets. Rotate a secret immediately after exposure.

Never print `.env` or credential values during deployment or troubleshooting.

## Network exposure

Bind the Knowledge Pilot application to `127.0.0.1:3100` and expose only the HTTPS reverse proxy. Do not expose the application port or filesystem data directory publicly.

Production service URLs reject embedded URL credentials. Credential-bearing non-loopback endpoints require HTTPS; explicit loopback HTTP is allowed only for local service-to-service communication where configured.

The Workspace Agent MCP service also binds to loopback only. Any reverse-proxied MCP route must remain unguessable and independently bearer-authenticated.

## Browser / HTTP boundary

- Authenticated browser mutations reject cross-origin/cross-site requests.
- Request bodies are bounded by UTF-8 bytes, not JavaScript character count.
- Public health output is intentionally minimal.
- Production responses use strict CSP/security headers and HSTS when served as production HTTPS.
- Frontend executable script is external; generated markup does not rely on CSP-blocked inline style attributes.
- Request errors carry a correlation ID while logs omit raw query strings/private-link material.
- Internal 500 details are not returned to clients.
- Service-worker caching is limited to shell/static assets and excludes API/private learner URLs.

## Access isolation

Learner links contain signed private credentials. Every learner API verifies the linked user. Generated lesson/book-card URLs require the owning learner session; cards are not public static assets. Learner book responses expose safe upload metadata but never local filesystem paths. Admin endpoints require `ADMIN_TOKEN`. Verified-processing endpoints require the configured Bearer Action key.

Telegram and WhatsApp account linking use signed, expiring, channel-specific binding tokens. A valid WhatsApp bind is committed atomically and displaces any prior owner of the incoming JID.

## Source fetching and SSRF controls

External research requests reject prohibited loopback, private, shared, link-local, multicast, and reserved destinations. DNS is resolved and validated before connection, and the already validated address is pinned into the outbound lookup so a later DNS answer cannot redirect the socket to a forbidden address. Redirect targets are revalidated.

Response bodies are streamed under hard byte caps and cancelled when they exceed the configured limit. The same bounded-reader pattern is used for AI/provider and Workspace Agent HTTP responses. Approved external lesson/book source URLs must use HTTPS.

## Persistence and external effects

JSON transactions mutate a draft and publish the new in-memory state only after the durable atomic rename succeeds. State written by a future unsupported schema fails closed.

External delivery jobs persist intent before sending. A stale/ambiguous job with an unresolved external-send intent is not blindly retried, preventing duplicate Telegram/WhatsApp/direct responses after uncertain process failure.

Accepted verified-processing artifacts and their terminal task state are committed together where required. Later acknowledgement or scheduling/notification failure cannot downgrade already accepted content back into retryable work.

## Verified-processing / Workspace Agent boundary

- Model-controlled strings, collections, source metadata, and verification metadata are normalized and bounded before acceptance.
- Completed tasks retain compact acceptance metadata/references rather than duplicate full accepted payloads.
- Owned-copy text can be retrieved only in bounded authenticated chunks.
- Workspace Agent trigger intent, prompt fingerprint, request, and idempotency key are persisted before the external trigger POST.
- Ambiguous trigger retries reuse the exact persisted intent; changed queue state does not replace it.
- An unresolved/stale active run blocks overlap rather than being silently cleared.
- Workspace Agent logs contain operational counts/statuses, not learner content or credentials.
- Automatic Workspace Agent triggering remains disabled until target-environment end-to-end tests pass.

## User-owned book files

- Accepted formats: PDF, EPUB, TXT, Markdown.
- Maximum upload: 30 MB.
- PDFs and EPUBs are checked by file signature.
- EPUB extraction is capped by entry count, per-entry size, and total uncompressed size.
- Extracted text is bounded.
- Identity path segments are validated; lexical and resolved-path checks prevent traversal and symlink escape.
- Files are written through temporary/versioned paths and are never exposed as static assets.
- The processor can read only bounded chunks through authenticated task context.
- Permanent learner deletion removes owned records and private file locations without affecting another learner.

An upload scanner is not bundled. For broader/untrusted public use, place ClamAV or an equivalent malware scanner before extraction and isolate processing in a restricted environment.

## Copyright controls

The feature is designed for transformative education, not redistribution. Processing instructions and result validation require summary/analysis, prohibit reconstructed chapters, and cap quotations. Users should upload only copies they lawfully possess. The operator remains responsible for applicable law and access rights.

## Deployment credentials

Production deployment should use a repository-specific **read-only** GitHub credential from a deployment checkout outside the web root. Do not leave a broad/write-capable GitHub CLI credential on the server after bootstrap. Deployment must resolve an immutable release tag to the expected commit SHA before staging or cutover.

See [AAPANEL_DEPLOYMENT.md](AAPANEL_DEPLOYMENT.md) for the fail-closed staging, cutover, rollback, and credential boundary.

## Backups

Application JSON backups do not contain a second copy of owned files. Configure an encrypted server backup of the complete `data/` directory, limit access, define retention, and test restoration.

## WhatsApp

Baileys is unofficial. Use a dedicated number, explicit opt-in, low volume, and no unsolicited messaging. Telegram and web remain the reliable channels if WhatsApp disconnects.
