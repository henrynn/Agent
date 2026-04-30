import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryEntry } from './contracts.js';
import { HybridOrchestrator } from './orchestrator.js';
import { FileSessionStore } from './store.js';

describe('HybridOrchestrator', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'hybrid-orch-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('preserves checkpoint and memory across local and cloud handoff', async () => {
    const store = new FileSessionStore(tempDir);
    const orchestrator = new HybridOrchestrator(store, {
      cloudAgentBaseUrl: 'http://cloud-agent.example',
      localExecutor: {
        execute: async (session, task) => ({
          summary: `Local Copilot agent completed: ${task}`,
          memoryEntry: createMemoryEntry('agent', `Local Copilot agent completed: ${task}`),
          context: {
            executor: 'local',
            provider: 'test-double',
            localCopilotSessionId: 'local-session-1',
            resumedFromVersion: session.checkpoint?.version ?? 0,
            handoffReady: true
          }
        })
      }
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            summary: 'Cloud agent completed the task: deploy the package',
            checkpointContext: { executor: 'cloud', deploymentTarget: 'aca', cloudCopilotSessionId: 'cloud-session-1' },
            memoryEntry: {
              id: crypto.randomUUID(),
              role: 'agent',
              content: 'Cloud agent completed the task: deploy the package',
              createdAt: new Date().toISOString()
            },
            telemetry: { region: 'test' }
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      )
    );

    const session = await orchestrator.createSession({ title: 'handoff demo', mode: 'local' });
    const afterLocal = await orchestrator.executeTask({ sessionId: session.id, task: 'analyze the code changes' });

    expect(afterLocal.checkpoint?.version).toBe(1);
    expect(afterLocal.memory).toHaveLength(2);

    await orchestrator.switchMode({ sessionId: session.id, mode: 'cloud' });
    const afterCloud = await orchestrator.executeTask({ sessionId: session.id, task: 'deploy the package' });

    expect(afterCloud.mode).toBe('cloud');
    expect(afterCloud.checkpoint?.version).toBe(2);
    expect(afterCloud.checkpoint?.owner).toBe('cloud');
    expect(afterCloud.checkpoint?.context.localCopilotSessionId).toBe('local-session-1');
    expect(afterCloud.checkpoint?.context.cloudCopilotSessionId).toBe('cloud-session-1');
    expect(afterCloud.memory.length).toBeGreaterThan(afterLocal.memory.length);
    expect(afterCloud.lastResult).toContain('Cloud agent completed');
  });
});