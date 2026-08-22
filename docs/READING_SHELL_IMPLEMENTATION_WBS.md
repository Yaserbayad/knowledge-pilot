# Bilingual Reading Shell — Surgical Implementation WBS

Status: implementation control document for the `feat/bilingual-reading-shell-20260822` branch.

## Objective

Replace the current lesson/book-session reading presentation with the frozen Read reading-shell interaction model while preserving Knowledge Pilot's existing authenticated app shell, APIs, persistence, delivery, security, quality gates, and deployment model.

The frozen prototype is a visual/interaction contract. Production code must remain strict-CSP compliant and must not accept or render arbitrary model-generated HTML.

## Non-negotiable invariants

1. Existing learner/admin authentication, private-link authorization, ownership checks, mutation CSRF/same-origin protections, and CSP remain intact.
2. Existing lesson completion/resume/feedback/follow-up APIs remain backward compatible.
3. Existing Telegram/WhatsApp lifecycle and web deep links remain valid.
4. Existing state files must remain readable. Additive state is preferred; no schema bump unless downgrade safety is proven.
5. The web reader always supports English and Arabic for newly generated reading material, using one shared evidence/source model and stable logical IDs across locales.
6. No arbitrary HTML from task results. Rendering uses a finite server-validated reading-document grammar.
7. Legacy single-language lessons and book sessions remain renderable through a deterministic adapter; missing legacy translations are not fabricated.
8. Theme ownership stays with the existing Knowledge Pilot theme service. Reader-language preference is persisted through the existing experience model where available.
9. Static shell assets may be service-worker cached; learner content and API responses must not be cached.
10. Production deployment remains the repository's immutable semantic-tag + exact-SHA process.

## WBS

### RS-01 — Freeze reader contract and compatibility boundary
- Map frozen primitives to finite block types.
- Define `ReadingDocument v1` and bilingual structural invariants.
- Define legacy lesson/session adapters.
- Acceptance: deterministic validation rejects unsupported/mismatched structures and accepts representative EN/AR documents.

### RS-02 — Backend normalization and quality
- Add shared reading-document normalization/validation.
- Extend lesson and book-session normalization to attach `readingDocument` while retaining existing flat fields.
- Extend quality checks for locale completeness/structural parity.
- Acceptance: malformed or one-sided bilingual output cannot reach approved/delivered state.

### RS-03 — Processing contracts
- Upgrade business-task result contracts, Custom GPT instructions, and OpenAPI submission schema to require/permit `ReadingDocument v1` for new lesson/book-session work.
- Preserve existing task identity, verification, sources, claims, and audit expectations.
- Acceptance: processing contract is explicit, bounded, and backward compatible at the HTTP envelope.

### RS-04 — Shared experience persistence
- Preserve lesson experience semantics and stale-revision protection.
- Add equivalent rich experience mutations for book sessions without removing existing resume/complete endpoints.
- Persist selected reader language, anchors, answers, notes, highlights, section feedback, and completion state.
- Acceptance: refresh/resume and stale-write behavior are deterministic for both content types.

### RS-05 — Frozen shell production assets
- Extract prototype presentation into external same-origin CSS/JS/modules.
- Implement hero, section spine, outline, progress, language switching, RTL/LTR, steppers, term definitions, reduced motion, keyboard/focus behavior, responsive layout, and completion ending.
- Reuse Knowledge Pilot theme state instead of prototype-local theme authority.
- Acceptance: no inline script/style; no inline style attributes; strict CSP remains satisfied.

### RS-06 — Lesson and book-session integration
- Render new `ReadingDocument v1` with shared shell.
- Route legacy records through adapters.
- Preserve notes/highlights/checks/sources/feedback/confidence/follow-up/completion controls.
- Acceptance: existing deep links and public API routes continue to work; no learner capability is lost.

### RS-07 — Delivery/cache/runtime compatibility
- Make message formatting locale-aware while keeping one concise channel-language delivery plus bilingual web access.
- Add shell assets to the service-worker static cache only.
- Prove state compatibility with schema 5 or introduce an explicit migration/downgrade path before any bump.
- Acceptance: deployment rollback semantics remain valid for runtime data.

### RS-08 — Verification and release readiness
- Add RED/GREEN tests for reading validation, bilingual parity, lesson integration, book-session experience, CSP/front-end hardening, legacy rendering, delivery, and caching.
- Run `npm run check` and the complete relevant test suite in CI.
- Review branch diff for unrelated changes and security regressions.
- Acceptance: all required checks pass before merge/tag/deploy; production is not modified from this feature branch.

## Release boundary

This WBS authorizes development only on the isolated feature branch. Merge, semantic version/tag creation, and production deployment are separate release actions and require successful verification first.
