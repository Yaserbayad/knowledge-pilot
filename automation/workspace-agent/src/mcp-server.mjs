import crypto from 'node:crypto';
import http from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { loadConfig } from './config.mjs';
import { KnowledgePilotClient, safeError } from './knowledge-pilot-client.mjs';

const config = loadConfig({ requireMcp: true });
const client = new KnowledgePilotClient(config.knowledgePilot);
const requestAuthorization = new AsyncLocalStorage();

function secureEqual(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authorized(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') &&
    secureEqual(header.slice('Bearer '.length), config.mcp.bearerToken);
}

function toolResult(data, summary) {
  const structuredContent = Array.isArray(data) ? { items: data } : (data || {});
  return {
    structuredContent,
    content: [{ type: 'text', text: summary || JSON.stringify(structuredContent) }]
  };
}

function toolFailure(error) {
  const payload = safeError(error);
  return {
    isError: true,
    structuredContent: payload,
    content: [{ type: 'text', text: JSON.stringify(payload) }]
  };
}

function register(server, name, definition, handler) {
  server.registerTool(name, definition, async (input) => {
    try {
      if (!requestAuthorization.getStore()) {
        return toolFailure(Object.assign(new Error('Authentication required'), { status: 401 }));
      }
      return await handler(input);
    } catch (error) {
      return toolFailure(error);
    }
  });
}

function createMcpServer() {
  const server = new McpServer(
    { name: 'knowledge-pilot', version: '1.0.0' },
    {
      instructions:
        'List pending Knowledge Pilot tasks, inspect each context, then claim before work. ' +
        'Submit book_analysis only with submit_book_analysis_result; submit all other task types ' +
        'with submit_knowledge_task_result. Correct HTTP 422 contract errors and resubmit. ' +
        'Use get_owned_book_source_text only when the task context authorizes it.'
    }
  );

  register(server, 'get_knowledge_pilot_health', {
    title: 'Check Knowledge Pilot',
    description: 'Check whether Knowledge Pilot is reachable and count currently pending verified-processing tasks.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => {
    const result = await client.health();
    return toolResult(result, `Knowledge Pilot is ${result.ok ? 'available' : 'unavailable'} with ${result.pending} pending task(s).`);
  });

  register(server, 'list_knowledge_tasks', {
    title: 'List Knowledge Pilot tasks',
    description: 'List Knowledge Pilot task summaries, normally pending tasks ordered by priority.',
    inputSchema: {
      status: z.enum(['pending', 'claimed', 'completed', 'failed', 'all']).default('pending'),
      limit: z.number().int().min(1).max(100).default(20)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async (input) => {
    const tasks = await client.listTasks(input);
    return toolResult(tasks, `Found ${tasks.length} ${input.status} Knowledge Pilot task(s).`);
  });

  register(server, 'get_knowledge_task_context', {
    title: 'Get Knowledge Pilot task context',
    description: 'Retrieve the complete learner context, workflow, restrictions, and dynamic result contract for one task.',
    inputSchema: { task_id: z.string().min(1).max(160) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ task_id }) => {
    const context = await client.getTask(task_id);
    return toolResult(context, `Loaded the complete context for task ${task_id}.`);
  });

  register(server, 'claim_knowledge_task', {
    title: 'Claim Knowledge Pilot task',
    description: 'Claim a pending task immediately before substantive research or generation. Repeated claims are handled by Knowledge Pilot lifecycle guards.',
    inputSchema: { task_id: z.string().min(1).max(160) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  }, async ({ task_id }) => {
    const task = await client.claimTask(task_id);
    return toolResult(task, `Claimed Knowledge Pilot task ${task_id}.`);
  });

  register(server, 'submit_knowledge_task_result', {
    title: 'Submit Knowledge Pilot task result',
    description: 'Submit the final validated result for a claimed task other than book_analysis. The result object must exactly follow the dynamic resultContract returned by get_knowledge_task_context.',
    inputSchema: {
      task_id: z.string().min(1).max(160),
      result: z.record(z.string(), z.unknown())
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  }, async ({ task_id, result }) => {
    const output = await client.submitTask(task_id, result);
    return toolResult(output, `Knowledge Pilot accepted the result for task ${task_id}.`);
  });

  register(server, 'submit_book_analysis_result', {
    title: 'Submit Knowledge Pilot book analysis',
    description: 'Submit a strict book-analysis.v2 result for a claimed book_analysis task. Pass metadata, sourceAssessment, plan, sources, verification, and contractVersion inside result without additional wrappers.',
    inputSchema: {
      task_id: z.string().min(1).max(160),
      result: z.record(z.string(), z.unknown())
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  }, async ({ task_id, result }) => {
    const output = await client.submitBookAnalysis(task_id, result);
    return toolResult(output, `Knowledge Pilot accepted the book analysis for task ${task_id}.`);
  });

  register(server, 'report_knowledge_task_failure', {
    title: 'Report Knowledge Pilot task failure',
    description: 'Mark a task failed only when accurate completion is impossible for substantive evidence or safety reasons. Never use this for retryable schema, parsing, HTTP 422, or integration errors.',
    inputSchema: {
      task_id: z.string().min(1).max(160),
      reason: z.string().min(10).max(2000)
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  }, async ({ task_id, reason }) => {
    const task = await client.failTask(task_id, reason);
    return toolResult(task, `Reported a substantive failure for task ${task_id}.`);
  });

  register(server, 'get_owned_book_source_text', {
    title: 'Read learner-owned book text',
    description: 'Read one bounded chunk of extracted learner-owned book text. Use only when the task context provides and authorizes the book and continue with nextOffset only as needed.',
    inputSchema: {
      book_id: z.string().min(1).max(160),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1000).max(24000).default(16000)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ book_id, offset, limit }) => {
    const chunk = await client.getBookText(book_id, { offset, limit });
    return toolResult(chunk, `Read ${chunk.text?.length || 0} characters from the learner-owned book source.`);
  });

  return server;
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health' && req.method === 'GET') {
    return json(res, 200, { ok: true, service: 'knowledgepilot-workspace-agent-bridge' });
  }

  if (url.pathname !== '/mcp') return json(res, 404, { error: 'Not found' });
  if (!['POST', 'GET', 'DELETE'].includes(req.method || '')) {
    res.setHeader('allow', 'POST, GET, DELETE');
    return json(res, 405, { error: 'Method not allowed' });
  }

  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  try {
    await requestAuthorization.run(authorized(req), async () => {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });
  } catch (error) {
    if (!res.headersSent) json(res, 500, { error: 'MCP request failed' });
    else if (!res.writableEnded) res.end();
    process.stderr.write(`${JSON.stringify({
      level: 'error',
      event: 'mcp_request_failed',
      message: String(error?.message || 'unknown').slice(0, 500)
    })}\n`);
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

httpServer.requestTimeout = 120000;
httpServer.headersTimeout = 15000;
httpServer.keepAliveTimeout = 5000;
httpServer.maxRequestsPerSocket = 100;

httpServer.listen(config.mcp.port, config.mcp.host, () => {
  process.stdout.write(`${JSON.stringify({
    level: 'info',
    event: 'mcp_listening',
    host: config.mcp.host,
    port: config.mcp.port
  })}\n`);
});

function shutdown(signal) {
  process.stdout.write(`${JSON.stringify({ level: 'info', event: 'shutdown', signal })}\n`);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
