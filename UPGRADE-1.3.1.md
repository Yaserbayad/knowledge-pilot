# Upgrade to 1.3.1

Version 1.3.1 adds permanent learner-account deletion. It does not change the state schema or require environment-variable changes.

## Before deployment

Back up the application, `.env`, `data/`, and the aaPanel Nginx configuration.

## Deployment

Replace application source while preserving `.env`, `data/`, `node_modules/`, and `automation/`. Run:

```bash
npm ci --omit=dev
npm run check
node scripts/verify-config.js
```

Restart only the existing Knowledge Pilot Node project.

## Verification

- Confirm the Admin Learners panel shows **Delete learner**.
- Confirm learner Settings shows **Delete account and all data**.
- A wrong confirmation must not delete anything.
- A successful deletion must invalidate the private learner link immediately.
- Protected backups remain governed by the configured rotation policy.
