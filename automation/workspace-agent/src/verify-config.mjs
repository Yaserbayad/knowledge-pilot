import { loadConfig, publicConfig } from './config.mjs';
import { KnowledgePilotClient } from './knowledge-pilot-client.mjs';

async function main() {
  const requireTrigger = process.argv.includes('--trigger');
  const config = loadConfig({ requireMcp: true, requireTrigger });
  const client = new KnowledgePilotClient(config.knowledgePilot);
  const health = await client.health();
  if (!health?.ok) throw new Error('Knowledge Pilot health check did not return ok=true');
  process.stdout.write(`${JSON.stringify({
    ok: true,
    config: publicConfig(config),
    knowledgePilot: {
      ok: health.ok,
      mode: health.mode,
      pending: health.pending
    }
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: String(error?.message || 'unknown').slice(0, 1000)
  }, null, 2)}\n`);
  process.exitCode = 1;
});
