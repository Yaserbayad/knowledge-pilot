# GPT Action schema notes

Knowledge Pilot 1.3.0 retains the strict schema corrections introduced in earlier releases and includes the learner-owned automation and book-learning Action contracts.

If GPT Builder reports missing object properties, skipped functions, or missing path parameter names:

1. Confirm the server returns schema version `1.3.0`:

```bash
curl -s https://YOUR_DOMAIN/gpt-action/openapi.json | grep '1.3.0'
```

2. Restart the Node project if it returns an older version.
3. In the GPT editor, delete the existing Action schema completely.
4. Import it again from:

```text
https://YOUR_DOMAIN/gpt-action/openapi.json
```

5. Re-enter API-key/Bearer authentication if the editor removed it.
6. Test `Check Knowledge Pilot for pending tasks.` in Preview.

Do not paste a cached schema from an older package. The live endpoint is authoritative.
