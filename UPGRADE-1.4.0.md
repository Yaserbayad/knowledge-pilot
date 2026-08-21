# Upgrade to 1.4.0

This release redesigns topic-lesson reading while preserving users, plans, books, sessions, delivery, automation, and account deletion.

## Data compatibility

- State schema 5 adds a versioned `experience` object to each topic lesson.
- Existing lesson fields remain unchanged.
- Existing lessons receive safe defaults at startup.
- No record is deleted or renamed.
- The previous `resumePercent` remains supported and is updated from completed reader sections.

## Safe aaPanel upgrade

1. Keep a verified full Node-project backup and a copy of `data/state.json`.
2. Stop only the existing Knowledge Pilot Node project.
3. Replace application files while preserving `.env`, `data/`, `node_modules/`, and `automation/workspace-agent/workspace-agent.env`.
4. Run `npm ci --omit=dev`, `node scripts/verify-config.js`, and `npm run check`.
5. Start the same aaPanel Node project using `npm start`.
6. Confirm `/health`, the private learner dashboard, the Admin dashboard, Telegram delivery, and the Workspace Agent bridge.

## Rollback

Stop the Knowledge Pilot Node project, restore the prior application archive and the pre-upgrade `data/state.json`, restore ownership to `www:www`, run the prior dependency install, and start the same project. Schema 5 is additive, but restoring the paired state backup gives an exact rollback.

## Deliberate limits

- Audio was not added because the existing application has no reliable background-audio or TTS pipeline.
- The service worker caches only the application shell. Private lesson content is not placed in shared Cache Storage; an already-open lesson remains usable during a connection interruption and pending progress retries when connectivity returns.
