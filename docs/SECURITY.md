# Security Notes

## Secrets

Protect `APP_SECRET`, `ADMIN_TOKEN`, `GPT_ACTION_API_KEY`, `TELEGRAM_WEBHOOK_SECRET`, `.env`, WhatsApp credentials, and the complete `data/` directory. Rotate a secret immediately after exposure.

## Network exposure

Bind Node.js to `127.0.0.1`. Expose only the HTTPS reverse proxy. Do not expose port 3100 or the filesystem data directory publicly.

## Access isolation

Learner links contain signed private credentials. Every learner API verifies the linked user. Generated lesson and book-card URLs also require the owning learner session; cards are not public static assets. Learner book responses expose safe upload metadata but never local filesystem paths. Admin endpoints require `ADMIN_TOKEN`. GPT endpoints require the Bearer Action key.

## Source fetching

The server validates and fetches external sources itself. It blocks private, loopback, link-local, and other prohibited network destinations to reduce SSRF risk. Approved external lesson/book sources must use direct HTTPS URLs.

## User-owned book files

- Accepted formats: PDF, EPUB, TXT, Markdown.
- Maximum upload: 30 MB.
- PDFs and EPUBs are checked by file signature.
- EPUB extraction is capped by entry count, per-entry size, and total uncompressed size.
- Extracted text is capped at 2.5 million characters.
- Files are written through temporary files and atomic rename.
- Stored files use restricted permissions and are never exposed as static assets.
- The GPT can read only bounded chunks through the authenticated Action endpoint.
- Delete the entire book-file directory when permanently deleting a learner/book; verify deletion according to your own retention policy.

An upload scanner is not bundled. For broader or untrusted public use, place ClamAV or an equivalent malware scanner before extraction and isolate processing in a restricted container.

## Copyright controls

The feature is designed for transformative education, not redistribution. The GPT instructions and server validators require summary/analysis, prohibit reconstructed chapters, and cap all quotations in a session to 25 words combined. Users should upload only copies they lawfully possess. The operator remains responsible for applicable law and access rights.

## Backups

Application JSON backups do not contain a second copy of owned files. Configure an encrypted server backup of the complete `data/` directory. Limit access, define retention, and test restoration.

## WhatsApp

Baileys is unofficial. Use a dedicated number, explicit opt-in, low volume, and no unsolicited messaging. Telegram and web remain the reliable channels if WhatsApp disconnects.
