# Upgrade to Knowledge Pilot 1.2.1

This hotfix corrects overly strict book-analysis source verification.

## What changed

A book analysis no longer fails because one optional source is inaccessible. The server now requires:

- without an owned copy: at least two successfully fetched external sources from two different domains;
- with an owned copy: at least one successfully fetched external source.

Additional failed source URLs are recorded as source limitations and excluded from verification.

## Safe upgrade

1. Stop Knowledge Pilot in aaPanel.
2. Back up the current file:

```bash
cd /www/wwwroot/knowledgepilot
cp src/services/business-actions.js src/services/business-actions.js.bak-1.2.0
```

3. Replace `src/services/business-actions.js` with the 1.2.1 file.
4. Run:

```bash
node --check src/services/business-actions.js
npm test
```

5. Restart the project.
6. In Admin > Books, click **Re-analyze** for the failed book.
7. Open the custom GPT and run: `Process all pending Knowledge Pilot tasks.`
