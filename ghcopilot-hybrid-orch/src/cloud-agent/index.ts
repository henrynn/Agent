import cors from 'cors';
import express from 'express';
import { ZodError } from 'zod';

import { CloudTaskRequestSchema, CloudTaskResponse, ExecutionLogEntry } from '../shared/contracts.js';
import { createCopilotSdkExecutor } from '../shared/copilot-runtime.js';

const app = express();
const port = Number(process.env.CLOUD_AGENT_PORT ?? process.env.PORT ?? 8787);
const executor = createCopilotSdkExecutor('cloud');

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'cloud-agent' });
});

app.post('/v1/tasks/execute', async (request, response, next) => {
  try {
    const parsed = CloudTaskRequestSchema.parse(request.body);
    const executionLogs: ExecutionLogEntry[] = [];
    const outcome = await executor.execute(
      {
        id: parsed.sessionId,
        title: 'Cloud Handoff Session',
        mode: 'cloud',
        status: 'running',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastResult: null,
        memory: parsed.memory,
        runs: [],
        checkpoint: parsed.checkpoint
      },
      parsed.task,
      {
        onLog: (entry) => {
          executionLogs.push(entry);
        }
      }
    );

    const result: CloudTaskResponse = {
      summary: outcome.summary,
      memoryEntry: outcome.memoryEntry,
      executionLogs,
      checkpointContext: {
        ...outcome.context,
        deploymentTarget: 'aca'
      },
      telemetry: {
        region: process.env.ACA_LOCATION ?? 'local-dev',
        revision: process.env.CONTAINER_APP_REVISION ?? 'dev',
        processedAt: new Date().toISOString()
      }
    };

    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected error';
  console.error('[cloud-agent] request failed', error);

  if (error instanceof ZodError) {
    response.status(400).json({ error: message });
    return;
  }

  if (/timeout/i.test(message)) {
    response.status(504).json({ error: message });
    return;
  }

  response.status(502).json({ error: message });
});

app.listen(port, () => {
  console.error(`[cloud-agent] listening on ${port}`);
});