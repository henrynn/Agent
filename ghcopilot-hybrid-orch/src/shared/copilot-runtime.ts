import { approveAll, CopilotClient, type AssistantMessageEvent, type SessionEvent } from '@github/copilot-sdk';

import { type AgentMode, type AgentSession, createExecutionLogEntry, createMemoryEntry } from './contracts.js';
import type { ExecutionOptions, ExecutionOutcome, LocalExecutor } from './orchestrator.js';

const mockMode = /^(1|true|yes)$/i.test(process.env.HYBRID_AGENT_MOCK_MODE ?? '');
const defaultSessionTimeoutMs = Number(process.env.COPILOT_SESSION_TIMEOUT_MS ?? 600000);

export class CopilotSdkExecutor implements LocalExecutor {
  private clientPromise: Promise<CopilotClient> | null = null;

  constructor(private readonly role: AgentMode) {}

  async execute(session: AgentSession, task: string, options?: ExecutionOptions): Promise<ExecutionOutcome> {
    if (mockMode) {
      await this.emitLog(options, 'success', 'Using deterministic mock execution because HYBRID_AGENT_MOCK_MODE is enabled.');
      return this.createMockOutcome(session, task, 'mock mode enabled');
    }

    try {
      await this.emitLog(options, 'running', 'Starting Copilot SDK client.');
      const client = await this.getClient();
      const priorCopilotSessionId = this.readCopilotSessionId(session);
      await this.emitLog(
        options,
        'running',
        priorCopilotSessionId
          ? `Resuming existing Copilot session ${priorCopilotSessionId.slice(0, 8)}...`
          : `Creating a new Copilot session with model ${this.resolveModel()}.`
      );
      const copilotSession = priorCopilotSessionId
        ? await client.resumeSession(priorCopilotSessionId, {
            onPermissionRequest: approveAll,
            streaming: true,
            includeSubAgentStreamingEvents: true
          })
        : await client.createSession({
            model: this.resolveModel(),
            onPermissionRequest: approveAll,
            streaming: true,
            includeSubAgentStreamingEvents: true
          });
      const unsubscribeSessionEvents = this.subscribeToSessionEvents(copilotSession, options);

      try {
        await this.emitLog(options, 'running', 'Sending prompt to Copilot and waiting for the response.');
        const response = await waitForCopilotResponse(
          copilotSession,
          { prompt: buildExecutionPrompt(this.role, session, task) },
          defaultSessionTimeoutMs,
          async (message) => {
            await this.emitLog(options, 'info', message);
          }
        );
        const summary = (response?.data.content ?? '').trim();

        if (!summary) {
          throw new Error('Copilot SDK returned an empty assistant response.');
        }

        await this.emitLog(options, 'success', 'Copilot response received and checkpoint summary generated.');

        return {
          summary,
          memoryEntry: createMemoryEntry('agent', summary),
          context: {
            executor: this.role,
            provider: 'copilot-sdk',
            resumedFromVersion: session.checkpoint?.version ?? 0,
            memoryCount: session.memory.length + 1,
            handoffReady: true,
            [this.getSessionContextKey()]: copilotSession.sessionId
          }
        };
      } finally {
        unsubscribeSessionEvents();
        await this.emitLog(options, 'info', 'Disconnecting Copilot session.');
        await copilotSession.disconnect();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Copilot SDK error';
      await this.emitLog(options, 'error', `Copilot SDK execution failed: ${message}`);
      const guidance = isCopilotTimeoutError(message)
        ? [
            'The Copilot agent did not reach session.idle before the timeout window closed.',
            `Increase COPILOT_SESSION_TIMEOUT_MS if this task is expected to run longer than ${Math.round(defaultSessionTimeoutMs / 1000)} seconds.`
          ].join(' ')
        : [
            'Default execution no longer falls back to mock mode.',
            'Authenticate the Copilot SDK with a logged-in user or set COPILOT_GITHUB_TOKEN/GITHUB_TOKEN/GH_TOKEN.',
            'If you intentionally want the deterministic demo path, set HYBRID_AGENT_MOCK_MODE=true.'
          ].join(' ');
      throw new Error(
        [
          `${capitalize(this.role)} Copilot SDK execution failed.`,
          guidance,
          `Underlying error: ${message}`
        ].join(' ')
      );
    }
  }

  async stop(): Promise<void> {
    const client = await this.clientPromise;
    if (client) {
      await client.stop();
      this.clientPromise = null;
    }
  }

  private async getClient(): Promise<CopilotClient> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const token = process.env.COPILOT_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
        const client = new CopilotClient({
          gitHubToken: token,
          useLoggedInUser: !token,
          logLevel: process.env.COPILOT_LOG_LEVEL ?? 'error'
        });
        await client.start();
        return client;
      })();
    }

    return this.clientPromise;
  }

  private readCopilotSessionId(session: AgentSession): string | undefined {
    const value = session.checkpoint?.context[this.getSessionContextKey()];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private getSessionContextKey(): 'localCopilotSessionId' | 'cloudCopilotSessionId' {
    return this.role === 'local' ? 'localCopilotSessionId' : 'cloudCopilotSessionId';
  }

  private resolveModel(): string {
    return this.role === 'local'
      ? process.env.LOCAL_COPILOT_MODEL ?? process.env.COPILOT_MODEL ?? 'auto'
      : process.env.CLOUD_COPILOT_MODEL ?? process.env.COPILOT_MODEL ?? 'auto';
  }

  private createMockOutcome(session: AgentSession, task: string, reason: string): ExecutionOutcome {
    const priorVersion = session.checkpoint?.version ?? 0;
    const summary = [
      `${capitalize(this.role)} agent completed the task: ${task}`,
      priorVersion > 0 ? `Resumed from checkpoint v${priorVersion}.` : 'Started from a fresh session.',
      `Used deterministic fallback execution because ${reason}.`
    ].join(' ');

    return {
      summary,
      memoryEntry: createMemoryEntry('agent', summary),
      context: {
        executor: this.role,
        provider: 'mock-fallback',
        resumedFromVersion: priorVersion,
        memoryCount: session.memory.length + 1,
        handoffReady: true
      }
    };
  }

  private async emitLog(
    options: ExecutionOptions | undefined,
    status: 'info' | 'running' | 'success' | 'error',
    message: string
  ): Promise<void> {
    await options?.onLog?.(createExecutionLogEntry(this.role, status, message));
  }

  private subscribeToSessionEvents(
    copilotSession: { on: (handler: (event: SessionEvent) => void) => () => void },
    options: ExecutionOptions | undefined
  ): () => void {
    const toolNamesByCallId = new Map<string, string>();
    let lastStreamingBucket = -1;

    return copilotSession.on((event) => {
      const mapped = mapSessionEventToLog(event, toolNamesByCallId, lastStreamingBucket);
      if (event.type === 'assistant.streaming_delta') {
        lastStreamingBucket = Math.floor(event.data.totalResponseSizeBytes / 2048);
      }

      if (!mapped) {
        return;
      }

      void this.emitLog(options, mapped.status, mapped.message);
    });
  }
}

export function createCopilotSdkExecutor(role: AgentMode): CopilotSdkExecutor {
  const executor = new CopilotSdkExecutor(role);

  const shutdown = () => {
    void executor.stop();
  };

  process.once('exit', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return executor;
}

function buildExecutionPrompt(role: AgentMode, session: AgentSession, task: string): string {
  const memoryWindow = session.memory
    .slice(-6)
    .map((entry) => `- ${entry.role}: ${truncate(entry.content, 240)}`)
    .join('\n');

  const checkpointSummary = session.checkpoint
    ? [
        `version: ${session.checkpoint.version}`,
        `owner: ${session.checkpoint.owner}`,
        `task: ${session.checkpoint.task}`,
        `summary: ${truncate(session.checkpoint.summary, 400)}`
      ].join('\n')
    : 'none';

  return [
    `You are the ${role} executor in a hybrid GitHub Copilot architecture.`,
    'Continue the task using the local checkpoint and memory snapshot below.',
    'Return one concise execution summary and one short next-step recommendation.',
    '',
    `Session title: ${session.title}`,
    `Current mode: ${session.mode}`,
    `Requested task: ${task}`,
    '',
    'Checkpoint:',
    checkpointSummary,
    '',
    'Recent memory:',
    memoryWindow || '- none'
  ].join('\n');
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

async function waitForCopilotResponse(
  copilotSession: {
    send: (options: { prompt: string }) => Promise<string>;
    on: (handler: (event: SessionEvent) => void) => () => void;
  },
  input: { prompt: string },
  timeoutMs: number,
  emitInfo: (message: string) => Promise<void>
): Promise<AssistantMessageEvent | undefined> {
  let lastAssistantMessage: AssistantMessageEvent | undefined;
  let resolveIdle: (() => void) | undefined;
  let rejectWithError: ((error: Error) => void) | undefined;

  const idlePromise = new Promise<void>((resolve, reject) => {
    resolveIdle = resolve;
    rejectWithError = reject;
  });

  const unsubscribe = copilotSession.on((event) => {
    if (event.type === 'assistant.message') {
      lastAssistantMessage = event;
      return;
    }

    if (event.type === 'session.idle') {
      resolveIdle?.();
      return;
    }

    if (event.type === 'session.error') {
      const error = new Error(event.data.message);
      error.stack = event.data.stack;
      rejectWithError?.(error);
    }
  });

  let timeoutId: NodeJS.Timeout | undefined;

  try {
    await copilotSession.send(input);

    await Promise.race([
      idlePromise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Timeout after ${timeoutMs}ms waiting for session.idle`));
        }, timeoutMs);
      })
    ]);

    return lastAssistantMessage;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isCopilotTimeoutError(message) && lastAssistantMessage) {
      await emitInfo('Timed out waiting for session.idle, but a final assistant message was already received. Using the latest assistant response.');
      return lastAssistantMessage;
    }

    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    unsubscribe();
  }
}

function isCopilotTimeoutError(message: string): boolean {
  return /Timeout after \d+ms waiting for session\.idle/i.test(message);
}

function mapSessionEventToLog(
  event: SessionEvent,
  toolNamesByCallId: Map<string, string>,
  lastStreamingBucket: number
): { status: 'info' | 'running' | 'success' | 'error'; message: string } | null {
  switch (event.type) {
    case 'assistant.turn_start':
      return {
        status: 'running',
        message: withAgentPrefix(event.agentId, `Copilot started turn ${event.data.turnId}.`)
      };
    case 'assistant.intent':
      return {
        status: 'running',
        message: withAgentPrefix(event.agentId, `Intent: ${truncate(event.data.intent, 180)}`)
      };
    case 'assistant.reasoning':
      return {
        status: 'info',
        message: withAgentPrefix(event.agentId, `Reasoning: ${truncate(event.data.content, 180)}`)
      };
    case 'assistant.streaming_delta': {
      const bucket = Math.floor(event.data.totalResponseSizeBytes / 2048);
      if (bucket <= lastStreamingBucket) {
        return null;
      }

      return {
        status: 'info',
        message: withAgentPrefix(event.agentId, `Streaming response: ${event.data.totalResponseSizeBytes} bytes received.`)
      };
    }
    case 'assistant.message': {
      const toolCount = event.data.toolRequests?.length ?? 0;
      const suffix = toolCount > 0 ? ` Includes ${toolCount} tool request${toolCount === 1 ? '' : 's'}.` : '';
      return {
        status: 'success',
        message: withAgentPrefix(event.agentId, `Assistant message received.${suffix}`)
      };
    }
    case 'assistant.turn_end':
      return {
        status: 'success',
        message: withAgentPrefix(event.agentId, `Copilot finished turn ${event.data.turnId}.`)
      };
    case 'assistant.usage':
      return {
        status: 'info',
        message: withAgentPrefix(
          event.agentId,
          `Model ${event.data.model} used ${event.data.inputTokens ?? 0} input / ${event.data.outputTokens ?? 0} output tokens in ${event.data.duration ?? 0} ms.`
        )
      };
    case 'tool.execution_start': {
      toolNamesByCallId.set(event.data.toolCallId, event.data.toolName);
      return {
        status: 'running',
        message: withAgentPrefix(
          event.agentId,
          `Tool started: ${event.data.toolName}${event.data.mcpServerName ? ` via ${event.data.mcpServerName}` : ''}.`
        )
      };
    }
    case 'tool.execution_progress': {
      const toolName = toolNamesByCallId.get(event.data.toolCallId) ?? event.data.toolCallId;
      return {
        status: 'running',
        message: withAgentPrefix(event.agentId, `Tool progress (${toolName}): ${truncate(event.data.progressMessage, 180)}`)
      };
    }
    case 'tool.execution_partial_result': {
      const toolName = toolNamesByCallId.get(event.data.toolCallId) ?? event.data.toolCallId;
      return {
        status: 'info',
        message: withAgentPrefix(event.agentId, `Tool output (${toolName}): ${truncate(event.data.partialOutput, 180)}`)
      };
    }
    case 'tool.execution_complete': {
      const toolName = toolNamesByCallId.get(event.data.toolCallId) ?? event.data.toolCallId;
      const content = event.data.result?.detailedContent ?? event.data.result?.content;
      return {
        status: event.data.success ? 'success' : 'error',
        message: withAgentPrefix(
          event.agentId,
          event.data.success
            ? `Tool completed: ${toolName}.${content ? ` ${truncate(content, 160)}` : ''}`
            : `Tool failed: ${toolName}. ${event.data.error?.message ?? 'Unknown tool error.'}`
        )
      };
    }
    case 'subagent.started':
      return {
        status: 'running',
        message: `Sub-agent started: ${event.data.agentDisplayName} (${event.data.agentName}).`
      };
    case 'subagent.completed':
      return {
        status: 'success',
        message: `Sub-agent completed: ${event.data.agentDisplayName} in ${event.data.durationMs ?? 0} ms.`
      };
    case 'subagent.failed':
      return {
        status: 'error',
        message: `Sub-agent failed: ${event.data.agentDisplayName}. ${event.data.error}`
      };
    case 'skill.invoked':
      return {
        status: 'info',
        message: withAgentPrefix(event.agentId, `Skill loaded: ${event.data.name}.`)
      };
    case 'permission.requested':
      return {
        status: 'running',
        message: `Permission requested: ${describePermission(event.data.permissionRequest)}.`
      };
    case 'permission.completed':
      return {
        status: event.data.result.kind.startsWith('approved') ? 'success' : 'error',
        message: `Permission ${event.data.result.kind}.`
      };
    case 'session.info':
      return {
        status: 'info',
        message: `Session info (${event.data.infoType}): ${truncate(event.data.message, 180)}`
      };
    case 'session.warning':
      return {
        status: 'error',
        message: `Session warning: ${truncate(event.data.message, 180)}`
      };
    case 'session.error':
      return {
        status: 'error',
        message: `Session error (${event.data.errorType}): ${truncate(event.data.message, 180)}`
      };
    case 'session.idle':
      return {
        status: 'info',
        message: event.data.aborted ? 'Copilot session became idle after abort.' : 'Copilot session is idle.'
      };
    default:
      return null;
  }
}

function withAgentPrefix(agentId: string | undefined, message: string): string {
  if (!agentId) {
    return message;
  }

  return `[agent ${agentId.slice(0, 8)}] ${message}`;
}

type PermissionRequest = Extract<SessionEvent, { type: 'permission.requested' }>['data']['permissionRequest'];

function describePermission(permissionRequest: PermissionRequest): string {
  switch (permissionRequest.kind) {
    case 'shell':
      return `shell command ${truncate(permissionRequest.fullCommandText, 120)}`;
    case 'write':
      return `write access to ${permissionRequest.fileName}`;
    case 'read':
      return `read access to ${permissionRequest.path}`;
    case 'mcp':
      return `MCP tool ${permissionRequest.serverName}/${permissionRequest.toolName}`;
    case 'url':
      return `URL access to ${permissionRequest.url}`;
    case 'memory':
      return `memory action for ${truncate(permissionRequest.fact, 80)}`;
    case 'custom-tool':
      return `custom tool ${permissionRequest.toolName}`;
    case 'hook':
      return `hook-gated tool ${permissionRequest.toolName}`;
    default:
      return 'additional operation';
  }
}
