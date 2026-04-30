import { z } from 'zod';

export const AgentModeSchema = z.enum(['local', 'cloud']);
export type AgentMode = z.infer<typeof AgentModeSchema>;

export const SessionStatusSchema = z.enum(['idle', 'running', 'completed', 'failed']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const MemoryEntrySchema = z.object({
  id: z.string(),
  role: z.enum(['system', 'user', 'agent']),
  content: z.string(),
  createdAt: z.string()
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export const ExecutionLogEntrySchema = z.object({
  id: z.string(),
  scope: z.enum(['orchestrator', 'local', 'cloud']),
  status: z.enum(['info', 'running', 'success', 'error']),
  message: z.string(),
  createdAt: z.string()
});
export type ExecutionLogEntry = z.infer<typeof ExecutionLogEntrySchema>;

export const CheckpointSchema = z.object({
  version: z.number().int().nonnegative(),
  owner: AgentModeSchema,
  task: z.string(),
  summary: z.string(),
  updatedAt: z.string(),
  context: z.record(z.string(), z.unknown())
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const TaskRunSchema = z.object({
  id: z.string(),
  mode: AgentModeSchema,
  task: z.string(),
  summary: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  checkpointVersion: z.number().int().nonnegative()
});
export type TaskRun = z.infer<typeof TaskRunSchema>;

export const AgentSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  mode: AgentModeSchema,
  status: SessionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastResult: z.string().nullable(),
  memory: z.array(MemoryEntrySchema),
  logs: z.array(ExecutionLogEntrySchema).default([]),
  runs: z.array(TaskRunSchema),
  checkpoint: CheckpointSchema.nullable()
});
export type AgentSession = z.infer<typeof AgentSessionSchema>;

export const CreateSessionInputSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  mode: AgentModeSchema.default('local')
});
export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;

export const ExecuteTaskInputSchema = z.object({
  sessionId: z.string(),
  task: z.string().min(1)
});
export type ExecuteTaskInput = z.infer<typeof ExecuteTaskInputSchema>;

export const SwitchModeInputSchema = z.object({
  sessionId: z.string(),
  mode: AgentModeSchema
});
export type SwitchModeInput = z.infer<typeof SwitchModeInputSchema>;

export const CloudTaskRequestSchema = z.object({
  sessionId: z.string(),
  task: z.string(),
  checkpoint: CheckpointSchema.nullable(),
  memory: z.array(MemoryEntrySchema)
});
export type CloudTaskRequest = z.infer<typeof CloudTaskRequestSchema>;

export const CloudTaskResponseSchema = z.object({
  summary: z.string(),
  checkpointContext: z.record(z.string(), z.unknown()),
  memoryEntry: MemoryEntrySchema,
  executionLogs: z.array(ExecutionLogEntrySchema).default([]),
  telemetry: z.record(z.string(), z.unknown())
});
export type CloudTaskResponse = z.infer<typeof CloudTaskResponseSchema>;

export function createMemoryEntry(role: MemoryEntry['role'], content: string): MemoryEntry {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString()
  };
}

export function createExecutionLogEntry(
  scope: ExecutionLogEntry['scope'],
  status: ExecutionLogEntry['status'],
  message: string
): ExecutionLogEntry {
  return {
    id: crypto.randomUUID(),
    scope,
    status,
    message,
    createdAt: new Date().toISOString()
  };
}

export function createSession(input: CreateSessionInput = { mode: 'local' }): AgentSession {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    title: input.title ?? 'Hybrid Agent Session',
    mode: input.mode,
    status: 'idle',
    createdAt: now,
    updatedAt: now,
    lastResult: null,
    memory: [],
    logs: [],
    runs: [],
    checkpoint: null
  };
}