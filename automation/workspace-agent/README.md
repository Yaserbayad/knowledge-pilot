# Knowledge Pilot Workspace Agent bridge

This private bridge exposes Knowledge Pilot's verified-processing queue as eight
authenticated MCP tools and invokes a published ChatGPT Workspace Agent only
when pending work exists.

## Safety properties

- The MCP process listens on loopback only.
- The public Nginx route is unguessable and requires a separate bearer token.
- Knowledge Pilot's own API key never leaves the server.
- Empty queue checks never invoke a Workspace Agent.
- Trigger retries use idempotency keys and a durable local lock.
- Beta run-status polling prevents overlapping runs and detects suspended jobs.
- Logs contain task counts and statuses, not credentials, learner text, or chat IDs.
- Telegram alerts are sent only for automation failures or prolonged suspension.
- The automatic timer remains disabled until end-to-end lesson and book tests pass.

The server has no public UI and does not replace the existing aaPanel Node project.
