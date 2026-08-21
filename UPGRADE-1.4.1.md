# Upgrade to 1.4.1

Version 1.4.1 is an additive book-source workflow update. It does not change the state schema and requires no new environment variables or dependencies.

## Behavior

- A learner may attach or replace a private PDF, EPUB, TXT, or Markdown copy from every book page.
- The Add Book form also accepts an optional owned file; a filename can identify the book when no title, ISBN, or URL is supplied.
- Active reading tracks preserve their status, sessions, schedule, and progress. The new source is available to future generated sessions.
- Books waiting for analysis automatically queue a fresh analysis using the newly uploaded source.
- The previous stored source is removed only after its validated replacement and state record are safely committed.

## Deployment

Preserve `.env`, `data/`, `node_modules/`, `.well-known/`, and `automation/`, replace the remaining application files, then restart the existing aaPanel Node project.

Validate:

```bash
node scripts/verify-config.js
npm run check
curl -fsS https://YOUR_DOMAIN/health
curl -fsS https://YOUR_DOMAIN/gpt-action/openapi.json | grep '1.4.1'
```

Rollback restores the previous code release. State schema 5 remains compatible with 1.4.0.
