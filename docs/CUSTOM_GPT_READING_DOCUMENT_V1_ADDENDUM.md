# Custom GPT Addendum — ReadingDocument v1

This addendum applies to Knowledge Pilot lesson, `book_session`, and `book_finale` tasks when the task context exposes `readingDocumentContract.version = 1`.

The live task context and server validation remain authoritative. This document explains the intended processing behavior and resolves the apparent conflict with the older general instruction to use only the learner's configured language.

## Language rule

For a ReadingDocument v1 task:

1. Research and verify the material once using the normal Knowledge Pilot source, adversarial-review, and final-audit requirements.
2. Build one logical reading document from that evidence.
3. Submit the complete reading document in **English and Arabic in the same result**.
4. Use the same stable section, block, option, step, matrix-row, and glossary IDs for both languages.
5. Preserve the same meaning, claims, uncertainty, examples, checks, and source basis across English and Arabic. Do not independently invent, omit, strengthen, or weaken facts in either language.
6. Keep the established flat lesson/book-session content in the learner's configured language. That flat content continues to support concise Telegram/WhatsApp delivery and backward compatibility.
7. Treat the learner's configured language as the default opening/channel language only. The web reading experience contains both English and Arabic.

For tasks that do not expose ReadingDocument v1, continue following the existing configured-language rule.

## Output boundary

`readingDocument` is structured data, never HTML. Use only the block types declared by the live task contract. Do not submit scripts, styles, HTML fragments, iframe/embed markup, event handlers, or arbitrary presentation code.

The server validates the document before accepting the result. A lesson or book-session result is invalid when:

- English or Arabic is missing from supplied localized content;
- aligned bilingual lists have different lengths;
- a block type is not in the declared finite grammar;
- stable IDs collide or use an invalid form;
- a matrix row does not match its columns;
- a check references a missing expected option;
- the document version is unsupported.

## Evidence and source traceability

ReadingDocument v1 does not create a second evidence model. The existing `sources`, `claims`, and verification audit remain the factual authority for the task result. Both languages must express the same source-grounded material.

## Legacy compatibility

Existing pre-v1.5 single-language lesson and book-session records are not retroactively translated. They remain available through the legacy reader. New verified lesson/book-session processing uses ReadingDocument v1 when the live task contract requires it.
