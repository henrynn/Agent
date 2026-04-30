import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import {
  CreateSessionInputSchema,
  ExecuteTaskInputSchema,
  SwitchModeInputSchema
} from '../shared/contracts.js';
import { createCopilotSdkExecutor } from '../shared/copilot-runtime.js';
import { HybridOrchestrator } from '../shared/orchestrator.js';
import { FileSessionStore } from '../shared/store.js';

const app = express();
const httpPort = Number(process.env.LOCAL_ORCHESTRATOR_PORT ?? 7071);
const cloudAgentBaseUrl = process.env.CLOUD_AGENT_BASE_URL ?? 'http://127.0.0.1:8787';

const store = new FileSessionStore();
const orchestrator = new HybridOrchestrator(store, {
  cloudAgentBaseUrl,
  localExecutor: createCopilotSdkExecutor('local')
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_request, response) => {
  const sessions = await orchestrator.listSessions();
  response.json({ status: 'ok', service: 'local-orchestrator', sessions: sessions.length });
});

app.get('/api/sessions', async (_request, response) => {
  response.json(await orchestrator.listSessions());
});

app.post('/api/sessions', async (request, response) => {
  const input = CreateSessionInputSchema.parse(request.body ?? {});
  response.status(201).json(await orchestrator.createSession(input));
});

app.get('/api/sessions/:sessionId', async (request, response) => {
  response.json(await orchestrator.getSession(request.params.sessionId));
});

app.post('/api/sessions/:sessionId/mode', async (request, response) => {
  const input = SwitchModeInputSchema.parse({
    sessionId: request.params.sessionId,
    mode: request.body?.mode
  });
  response.json(await orchestrator.switchMode(input));
});

app.post('/api/sessions/:sessionId/execute', async (request, response) => {
  const input = ExecuteTaskInputSchema.parse({
    sessionId: request.params.sessionId,
    task: request.body?.task
  });
  response.json(await orchestrator.executeTask(input));
});

const uiDistPath = path.join(process.cwd(), 'apps', 'control-panel', 'dist');

if (existsSync(uiDistPath)) {
  app.use(express.static(uiDistPath));
  app.get('/', (_request, response) => {
    response.sendFile(path.join(uiDistPath, 'index.html'));
  });
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected error';
  response.status(400).json({ error: message });
});

async function startHttpServer(): Promise<void> {
  await store.ensureReady();

  await new Promise<void>((resolve) => {
    app.listen(httpPort, () => {
      console.error(`[local-orchestrator] listening on ${httpPort}`);
      resolve();
    });
  });
}

async function startMcpServer(): Promise<void> {
  const server = new Server(
    {
      name: 'hybrid-orchestrator',
      version: '0.1.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'create_session',
        description: 'Create a new hybrid-agent session with local or cloud mode.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            mode: { type: 'string', enum: ['local', 'cloud'] }
          },
          additionalProperties: false
        }
      },
      {
        name: 'list_sessions',
        description: 'List all sessions and their latest state.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      },
      {
        name: 'get_session',
        description: 'Get one session and its checkpoint, memory, and status.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' }
          },
          required: ['sessionId'],
          additionalProperties: false
        }
      },
      {
        name: 'switch_mode',
        description: 'Switch the active executor between local and cloud using the same checkpoint and memory.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            mode: { type: 'string', enum: ['local', 'cloud'] }
          },
          required: ['sessionId', 'mode'],
          additionalProperties: false
        }
      },
      {
        name: 'execute_task',
        description: 'Execute a task against the currently selected local or cloud executor.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            task: { type: 'string' }
          },
          required: ['sessionId', 'task'],
          additionalProperties: false
        }
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};

    if (name === 'create_session') {
      const session = await orchestrator.createSession(CreateSessionInputSchema.parse(args));
      return { content: [{ type: 'text', text: JSON.stringify(session, null, 2) }] };
    }

    if (name === 'list_sessions') {
      const sessions = await orchestrator.listSessions();
      return { content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }] };
    }

    if (name === 'get_session') {
      const session = await orchestrator.getSession(String(args.sessionId));
      return { content: [{ type: 'text', text: JSON.stringify(session, null, 2) }] };
    }

    if (name === 'switch_mode') {
      const session = await orchestrator.switchMode(SwitchModeInputSchema.parse(args));
      return { content: [{ type: 'text', text: JSON.stringify(session, null, 2) }] };
    }

    if (name === 'execute_task') {
      const session = await orchestrator.executeTask(ExecuteTaskInputSchema.parse(args));
      return { content: [{ type: 'text', text: JSON.stringify(session, null, 2) }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

await Promise.all([startHttpServer(), startMcpServer()]);