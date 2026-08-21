# Knowledge Pilot 1.2.2 status-reconciliation hotfix

This hotfix corrects a book-analysis state mismatch in which a completed analysis could remain `source_required` even when a user-owned full copy, verified external context, and a complete learning plan were present.

## Install

1. Stop Knowledge Pilot in aaPanel.
2. Back up `src/services/business-actions.js` and `data/`.
3. Replace `src/services/business-actions.js` with the v1.2.2 file.
4. Run `node --check src/services/business-actions.js` and `npm test`.
5. Restart the project.
6. Requeue the affected book analysis. The previous completed task cannot be reconstructed because result payloads are not retained after submission.

No `.env` change or data migration is required.
