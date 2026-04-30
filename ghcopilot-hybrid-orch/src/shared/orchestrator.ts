import {
  AgentSession,
  AgentMode,
  CloudTaskRequestSchema,
  CloudTaskResponseSchema,
  CreateSessionInput,
  ExecutionLogEntry,
  ExecuteTaskInput,
  SwitchModeInput,
  createExecutionLogEntry,
  createMemoryEntry
} from './contracts.js';
import { FileSessionStore } from './store.js';

export interface HybridOrchestratorOptions {
  cloudAgentBaseUrl: string;
  localExecutor?: LocalExecutor;
}

export interface LocalExecutor {
  execute(session: AgentSession, task: string, options?: ExecutionOptions): Promise<ExecutionOutcome>;
}

export interface ExecutionOptions {
  onLog?: (entry: ExecutionLogEntry) => Promise<void> | void;
}

export class HybridOrchestrator {
  private readonly localExecutor: LocalExecutor;

  constructor(
    private readonly store: FileSessionStore,
    private readonly options: HybridOrchestratorOptions
  ) {
    this.localExecutor = options.localExecutor ?? {
      execute: (session, task) => this.executeLocalFallback(session, task)
    };
  }

  async createSession(input: CreateSessionInput = { mode: 'local' }): Promise<AgentSession> {
    return this.store.create(input);
  }

  async listSessions(): Promise<AgentSession[]> {
    return this.store.list();
  }

  async getSession(sessionId: string): Promise<AgentSession> {
    const session = await this.store.get(sessionId);

    if (!session) {
      throw new Error(`Session ${sessionId} was not found.`);
    }

    return session;
  }

  async switchMode(input: SwitchModeInput): Promise<AgentSession> {
    const session = await this.getSession(input.sessionId);
    session.mode = input.mode;
    session.updatedAt = new Date().toISOString();
    session.memory.push(createMemoryEntry('system', `Execution mode switched to ${input.mode}.`));
    this.pushLog(session, createExecutionLogEntry('orchestrator', 'info', `Execution mode switched to ${input.mode}.`));
    return this.store.save(session);
  }

  async executeTask(input: ExecuteTaskInput): Promise<AgentSession> {
    const session = await this.getSession(input.sessionId);
    const startedAt = new Date().toISOString();

    session.status = 'running';
    session.updatedAt = startedAt;
    session.memory.push(createMemoryEntry('user', input.task));
    this.pushLog(
      session,
      createExecutionLogEntry(session.mode, 'running', `Started ${session.mode} execution for task: ${truncate(input.task, 120)}`)
    );
    await this.store.save(session);

    try {
      const outcome = session.mode === 'local'
        ? await this.executeLocal(session, input.task)
        : await this.executeCloud(session, input.task);

      const completedAt = new Date().toISOString();
      const nextCheckpointVersion = (session.checkpoint?.version ?? 0) + 1;

      session.status = 'completed';
      session.updatedAt = completedAt;
      session.lastResult = outcome.summary;
      session.memory.push(outcome.memoryEntry);
      if (outcome.logs?.length) {
        session.logs = trimLogs([...session.logs, ...outcome.logs]);
      }
      this.pushLog(session, createExecutionLogEntry(session.mode, 'success', `${capitalize(session.mode)} execution completed.`));
      session.runs.push({
        id: crypto.randomUUID(),
        mode: session.mode,
        task: input.task,
        summary: outcome.summary,
        startedAt,
        completedAt,
        checkpointVersion: nextCheckpointVersion
      });
      session.checkpoint = {
        version: nextCheckpointVersion,
        owner: session.mode,
        task: input.task,
        summary: outcome.summary,
        updatedAt: completedAt,
        context: {
          ...(session.checkpoint?.context ?? {}),
          ...outcome.context
        }
      };

      return this.store.save(session);
    } catch (error) {
      session.status = 'failed';
      session.updatedAt = new Date().toISOString();
      session.lastResult = error instanceof Error ? error.message : 'Unknown execution error';
      session.memory.push(createMemoryEntry('agent', `Execution failed: ${session.lastResult}`));
      this.pushLog(session, createExecutionLogEntry(session.mode, 'error', session.lastResult));
      await this.store.save(session);
      throw error;
    }
  }

  private async executeLocal(session: AgentSession, task: string): Promise<ExecutionOutcome> {
    return this.localExecutor.execute(session, task, {
      onLog: async (entry) => {
        this.pushLog(session, entry);
        await this.store.save(session);
      }
    });
  }

  private async executeLocalFallback(session: AgentSession, task: string): Promise<ExecutionOutcome> {
    const priorVersion = session.checkpoint?.version ?? 0;
    const summary = [
      `Local agent completed the task: ${task}`,
      priorVersion > 0 ? `Resumed from local checkpoint v${priorVersion}.` : 'Started from a fresh local context.',
      `Current memory window contains ${session.memory.length + 1} entries.`
    ].join(' ');

    return {
      summary,
      memoryEntry: createMemoryEntry('agent', summary),
      logs: [createExecutionLogEntry('local', 'success', 'Completed deterministic local fallback execution.')],
      context: {
        executor: 'local',
        resumedFromVersion: priorVersion,
        memoryCount: session.memory.length + 1,
        handoffReady: true
      }
    };
  }

  private async executeCloud(session: AgentSession, task: string): Promise<ExecutionOutcome> {
    this.pushLog(session, createExecutionLogEntry('cloud', 'running', 'Preparing checkpoint and memory snapshot for cloud handoff.'));
    await this.store.save(session);

    const payload = CloudTaskRequestSchema.parse({
      sessionId: session.id,
      task,
      checkpoint: session.checkpoint,
      memory: session.memory
    });

    this.pushLog(session, createExecutionLogEntry('cloud', 'running', 'Sending task to cloud agent and waiting for response.'));
    await this.store.save(session);

    const response = await fetch(`${this.options.cloudAgentBaseUrl}/v1/tasks/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const rawError = await response.text();
      const errorMessage = getCloudErrorMessage(rawError);
      throw new Error(
        errorMessage
          ? `Cloud agent request failed with ${response.status}: ${errorMessage}`
          : `Cloud agent request failed with ${response.status}.`
      );
    }

    const raw = await response.json();
    const parsed = CloudTaskResponseSchema.parse(raw);

    return {
      summary: parsed.summary,
      memoryEntry: parsed.memoryEntry,
      logs: parsed.executionLogs,
      context: {
        ...parsed.checkpointContext,
        cloudTelemetry: parsed.telemetry,
        handoffReady: true
      }
    };
  }

  private pushLog(session: AgentSession, entry: ExecutionLogEntry): void {
    session.logs = trimLogs([...(session.logs ?? []), entry]);
    session.updatedAt = entry.createdAt;
  }
}

export interface ExecutionOutcome {
  summary: string;
  memoryEntry: AgentSession['memory'][number];
  logs?: ExecutionLogEntry[];
  context: Record<string, unknown>;
}

export function resolvePreferredMode(task: string): AgentMode {
  return /deploy|scale|integration|load|cloud/i.test(task) ? 'cloud' : 'local';
}

function getCloudErrorMessage(rawError: string): string {
  if (!rawError.trim()) {
    return '';
  }

  try {
    const parsed = JSON.parse(rawError) as { error?: unknown; message?: unknown };

    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      return parsed.error.trim();
    }

    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    return rawError.trim();
  }

  return rawError.trim();
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

function trimLogs(logs: ExecutionLogEntry[]): ExecutionLogEntry[] {
  return logs.slice(-60);
}