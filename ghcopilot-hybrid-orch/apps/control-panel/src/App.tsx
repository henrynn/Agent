import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

type AgentMode = 'local' | 'cloud';
type SessionStatus = 'idle' | 'running' | 'completed' | 'failed';
type DemoFlowState = 'idle' | 'local-running' | 'local-ready' | 'switching' | 'cloud-running' | 'completed' | 'failed';

interface MemoryEntry {
  id: string;
  role: 'system' | 'user' | 'agent';
  content: string;
  createdAt: string;
}

interface ExecutionLogEntry {
  id: string;
  scope: 'orchestrator' | 'local' | 'cloud';
  status: 'info' | 'running' | 'success' | 'error';
  message: string;
  createdAt: string;
}

interface Checkpoint {
  version: number;
  owner: AgentMode;
  task: string;
  summary: string;
  updatedAt: string;
  context: Record<string, unknown>;
}

interface TaskRun {
  id: string;
  mode: AgentMode;
  task: string;
  summary: string;
  startedAt: string;
  completedAt: string;
  checkpointVersion: number;
}

interface AgentSession {
  id: string;
  title: string;
  mode: AgentMode;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  lastResult: string | null;
  memory: MemoryEntry[];
  logs: ExecutionLogEntry[];
  runs: TaskRun[];
  checkpoint: Checkpoint | null;
}

const apiBaseUrl = import.meta.env.VITE_LOCAL_ORCHESTRATOR_URL ?? 'http://127.0.0.1:7071';
const minimumVisibleRunMs = 1200;
const flowSteps: Array<{ key: DemoFlowState; label: string; shortLabel: string }> = [
  { key: 'local-running', label: 'Local running', shortLabel: 'Local' },
  { key: 'switching', label: 'Switched to cloud', shortLabel: 'Switch' },
  { key: 'cloud-running', label: 'Cloud running', shortLabel: 'Cloud' },
  { key: 'completed', label: 'Completed', shortLabel: 'Done' }
];

export function App() {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [task, setTask] = useState('Analyze this repository locally, prepare a checkpoint for Azure Container Apps rollout, then continue the same task in cloud mode.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');
  const [demoFlowState, setDemoFlowState] = useState<DemoFlowState>('idle');
  const [currentStepOverride, setCurrentStepOverride] = useState<string | null>(null);
  const logConsoleRef = useRef<HTMLDivElement | null>(null);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null,
    [selectedSessionId, sessions]
  );

  const visibleLogs = useMemo(() => (selectedSession?.logs ?? []).slice(-12), [selectedSession]);
  const activeLog = useMemo(() => getActiveLog(selectedSession), [selectedSession]);
  const latestCloudLog = useMemo(() => getLatestLogByScope(selectedSession, 'cloud'), [selectedSession]);
  const hasCloudResult = useMemo(() => hasCompletedRunForMode(selectedSession, 'cloud'), [selectedSession]);
  const currentStepText = useMemo(
    () => currentStepOverride ?? getCurrentStepText(activeLog, demoFlowState, selectedSession),
    [activeLog, currentStepOverride, demoFlowState, selectedSession]
  );
  const flowIndex = useMemo(() => getFlowIndex(demoFlowState), [demoFlowState]);

  useEffect(() => {
    void refreshSessions();

    const timer = window.setInterval(() => {
      void refreshSessions();
    }, 3000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedSessionId && sessions.length > 0) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    if (!busy) {
      setDemoFlowState(deriveDemoFlowState(selectedSession));
    }
  }, [busy, selectedSession]);

  useEffect(() => {
    const element = logConsoleRef.current;
    if (!element) {
      return;
    }

    element.scrollTop = element.scrollHeight;
  }, [visibleLogs]);

  async function refreshSessions() {
    const response = await fetch(`${apiBaseUrl}/api/sessions`);
    const data = ((await response.json()) as AgentSession[]).map(normalizeSession);
    setSessions(data);
    return data;
  }

  async function createSessionRequest(nextTitle: string) {
    const response = await fetch(`${apiBaseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: nextTitle, mode: 'local' })
    });

    if (!response.ok) {
      throw new Error('Failed to create a session.');
    }

    return normalizeSession((await response.json()) as AgentSession);
  }

  async function executeTaskRequest(sessionId: string, nextTask: string) {
    const response = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: nextTask })
    });

    if (!response.ok) {
      throw new Error('Failed to execute task.');
    }

    return normalizeSession((await response.json()) as AgentSession);
  }

  async function switchModeRequest(sessionId: string, mode: AgentMode) {
    const response = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}/mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode })
    });

    if (!response.ok) {
      throw new Error('Failed to switch execution mode.');
    }

    return normalizeSession((await response.json()) as AgentSession);
  }

  async function createSession(event: FormEvent) {
    event.preventDefault();
    if (!task.trim()) {
      return;
    }

    setBusy(true);
    setError('');
    setCurrentStepOverride('Creating a new local session.');

    try {
      const session = await createSessionRequest(buildSessionTitle(task));
      setSelectedSessionId(session.id);
      setSessions((currentSessions) => upsertSession(currentSessions, session));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unknown error');
    } finally {
      setCurrentStepOverride(null);
      setBusy(false);
    }
  }

  async function switchMode(mode: AgentMode) {
    if (!selectedSession) {
      return;
    }

    setBusy(true);
    setError('');
    setCurrentStepOverride(`Switching execution mode to ${mode}.`);

    try {
      const updatedSession = await switchModeRequest(selectedSession.id, mode);
      setSessions((currentSessions) => upsertSession(currentSessions, updatedSession));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unknown error');
    } finally {
      setCurrentStepOverride(null);
      setBusy(false);
    }
  }

  async function executeTask() {
    if (!task.trim()) {
      return;
    }

    setBusy(true);
    setError('');
    setCurrentStepOverride('Local execution started. Building the first checkpoint now.');
    const runStartedAt = Date.now();

    try {
      let session = await createSessionRequest(buildSessionTitle(task));
      setSelectedSessionId(session.id);
      setSessions((currentSessions) => upsertSession(currentSessions, session));

      setDemoFlowState('local-running');
      session = await executeTaskRequest(session.id, task);
      await ensureMinimumPhaseTime(runStartedAt);
      setSessions((currentSessions) => upsertSession(currentSessions, session));
      setSelectedSessionId(session.id);
      setDemoFlowState('local-ready');
    } catch (requestError) {
      setDemoFlowState('failed');
      setError(requestError instanceof Error ? requestError.message : 'Unknown error');
    } finally {
      setCurrentStepOverride(null);
      setBusy(false);
    }
  }

  async function continueDemoInCloud() {
    if (!selectedSession || !task.trim()) {
      return;
    }

    setBusy(true);
    setError('');
    setDemoFlowState('switching');
    setCurrentStepOverride('Switching the current session from local to cloud.');
    const runStartedAt = Date.now();

    try {
      let session = await switchModeRequest(selectedSession.id, 'cloud');
      setSessions((currentSessions) => upsertSession(currentSessions, session));
      setSelectedSessionId(session.id);
      setDemoFlowState('cloud-running');
      setCurrentStepOverride('Cloud execution started. Waiting for the cloud agent to continue the task.');
      session = await executeTaskRequest(selectedSession.id, buildCloudContinuationTask(task));
      await ensureMinimumPhaseTime(runStartedAt);
      setSessions((currentSessions) => upsertSession(currentSessions, session));
      setSelectedSessionId(session.id);
      setDemoFlowState('completed');
    } catch (requestError) {
      setDemoFlowState('failed');
      setError(requestError instanceof Error ? requestError.message : 'Unknown error');
    } finally {
      setCurrentStepOverride(null);
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <main className="main">
        <section className="hero panel">
          <div>
            <p className="eyebrow">GitHub Copilot SDK</p>
            <h1>Hybrid Handoff Demo</h1>
            <p className="lede">输入一个具体任务，先在本地执行，再把同一个 checkpoint 切到云端继续。</p>
          </div>
          <div className="status-grid">
            <article>
              <span>Session</span>
              <strong>{selectedSession ? 'ready' : 'new'}</strong>
            </article>
            <article>
              <span>Status</span>
              <strong>{selectedSession?.status ?? 'idle'}</strong>
            </article>
            <article>
              <span>Executor</span>
              <strong>{selectedSession?.mode ?? 'local'}</strong>
            </article>
          </div>
        </section>

        <section className="panel demo-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Task handoff</p>
              <h2>Run locally, then continue in cloud</h2>
            </div>
            <span className={demoFlowState === 'failed' ? 'demo-badge error-badge' : 'demo-badge'}>
              {selectedSession ? selectedSession.mode : 'no session'}
            </span>
          </div>

          <form className="task-form" onSubmit={createSession}>
            <label>
              Task prompt
              <textarea
                rows={5}
                value={task}
                onChange={(event) => setTask(event.target.value)}
                placeholder="Describe the concrete task you want the local agent to start, and the cloud agent to continue."
              />
            </label>
          </form>

          <div className="flow-track" aria-label="demo handoff progress">
            <div className="flow-line">
              <div className="flow-line-fill" style={{ width: `${flowIndex}%` }} />
            </div>
            <div className="flow-stops">
              {flowSteps.map((step, index) => {
                const isActive = flowIndex >= index * 33.33 && demoFlowState !== 'failed';
                const isRunning =
                  (demoFlowState === 'local-running' && step.key === 'local-running') ||
                  (demoFlowState === 'switching' && step.key === 'switching') ||
                  (demoFlowState === 'cloud-running' && step.key === 'cloud-running');

                return (
                  <article className={isActive ? 'flow-stop active' : 'flow-stop'} key={step.key}>
                    <span className={isRunning ? 'flow-dot running' : 'flow-dot'} />
                    <strong>{step.shortLabel}</strong>
                    <small>{step.label}</small>
                  </article>
                );
              })}
            </div>
          </div>

          <p className="demo-summary">{getDemoSummary(demoFlowState, selectedSession)}</p>

          <div className="active-log">
            <span>Current step</span>
            <div className="active-log-row">
              {activeLog ? <LogScopeIcon scope={activeLog.scope} status={activeLog.status} /> : null}
              <p>{currentStepText}</p>
            </div>
          </div>

          {latestCloudLog || hasCloudResult ? (
            <div className="cloud-spotlight">
              <article>
                <span>Latest cloud log</span>
                <div className="active-log-row">
                  {latestCloudLog ? <LogScopeIcon scope={latestCloudLog.scope} status={latestCloudLog.status} /> : null}
                  <p>{latestCloudLog?.message ?? 'Cloud execution has not emitted a log yet.'}</p>
                </div>
              </article>
              <article>
                <span>Cloud result</span>
                <p>{hasCloudResult ? truncate(selectedSession?.lastResult ?? 'No cloud result yet.', 280) : 'Cloud result will appear here after the handoff completes.'}</p>
              </article>
            </div>
          ) : null}

          <div className="demo-actions">
            <button disabled={busy || !task.trim()} onClick={() => void executeTask()} type="button">
              Run on local
            </button>
            <button
              className="secondary"
              disabled={!selectedSession || busy || demoFlowState !== 'local-ready'}
              onClick={() => void continueDemoInCloud()}
              type="button"
            >
              Switch to cloud and continue
            </button>
          </div>

          <div className="demo-copy single-column compact">
            <article>
              <span>Current task</span>
              <p>{task}</p>
            </article>
            <article>
              <span>Cloud continuation</span>
              <p>{buildCloudContinuationTask(task)}</p>
            </article>
          </div>
          {error ? <p className="error">{error}</p> : null}
        </section>

        <section className="workspace-grid compact-grid single-panel-grid">
          <div className="panel result-panel">
            <div className="panel-heading">
              <h2>Latest result</h2>
              <span>v{selectedSession?.checkpoint?.version ?? 0}</span>
            </div>
            <div className="summary-list">
              <article>
                <span>Checkpoint summary</span>
                <p>{truncate(selectedSession?.checkpoint?.summary ?? 'No checkpoint yet', 260)}</p>
              </article>
              <article>
                <span>Agent output</span>
                <p>{truncate(selectedSession?.lastResult ?? 'No result yet', 260)}</p>
              </article>
            </div>
          </div>

          <div className="panel">
            <div className="panel-heading">
              <h2>Execution log</h2>
              <span className="console-badge">live {visibleLogs.length}</span>
            </div>
            <div className="timeline console-log" ref={logConsoleRef}>
              {visibleLogs.map((entry) => (
                <article className={`timeline-item log-item ${entry.status}`} key={entry.id}>
                  <div className="log-meta">
                    <LogScopeIcon scope={entry.scope} status={entry.status} />
                    <span>{entry.scope}</span>
                    <small>{new Date(entry.createdAt).toLocaleTimeString()}</small>
                  </div>
                  <p>{truncate(entry.message, 220)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function deriveDemoFlowState(session: AgentSession | null): DemoFlowState {
  if (!session) {
    return 'idle';
  }

  if (session.status === 'failed') {
    return 'failed';
  }

  const runs = session.runs ?? [];
  const hasLocalRun = runs.some((run) => run.mode === 'local');
  const hasCloudRun = runs.some((run) => run.mode === 'cloud');

  if (hasCloudRun) {
    return 'completed';
  }

  if (hasLocalRun) {
    return 'local-ready';
  }

  return 'idle';
}

function getFlowIndex(state: DemoFlowState): number {
  switch (state) {
    case 'local-running':
      return 16;
    case 'local-ready':
      return 33;
    case 'switching':
      return 50;
    case 'cloud-running':
      return 74;
    case 'completed':
      return 100;
    case 'failed':
      return 100;
    default:
      return 0;
  }
}

function getDemoSummary(state: DemoFlowState, session: AgentSession | null): string {
  switch (state) {
    case 'local-running':
      return 'The local agent is running the task and building the first checkpoint for a later handoff.';
    case 'local-ready':
      return 'The local phase is done. You can now switch the same session to cloud and continue from the stored checkpoint.';
    case 'switching':
      return 'The session is being switched to cloud mode while preserving the existing checkpoint and memory.';
    case 'cloud-running':
      return 'The cloud agent is continuing the same task from the local checkpoint. Wait for the final handoff result.';
    case 'completed':
      return 'The handoff is complete. The latest result below reflects the cloud continuation of the same task.';
    case 'failed':
      return session?.lastResult ?? 'The demo failed. Check the current session and retry the handoff.';
    default:
      return 'Enter a concrete task, run it on local, then switch the same session to cloud continuation.';
  }
}

function buildSessionTitle(task: string): string {
  return truncate(task.trim() || 'Hybrid task', 48);
}

function buildCloudContinuationTask(task: string): string {
  const trimmedTask = task.trim();
  if (!trimmedTask) {
    return 'Continue the current task from the existing local checkpoint and finish it in cloud mode.';
  }

  return `Continue this same task from the existing local checkpoint and finish it in cloud mode: ${trimmedTask}`;
}

function normalizeSession(session: AgentSession): AgentSession {
  return {
    ...session,
    memory: session.memory ?? [],
    logs: session.logs ?? [],
    runs: session.runs ?? []
  };
}

function upsertSession(currentSessions: AgentSession[], nextSession: AgentSession): AgentSession[] {
  return [nextSession, ...currentSessions.filter((session) => session.id !== nextSession.id)].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

function getActiveLog(session: AgentSession | null): ExecutionLogEntry | null {
  if (!session) {
    return null;
  }

  const logs = session.logs ?? [];
  const runningLog = [...logs].reverse().find((entry) => entry.status === 'running');
  return runningLog ?? logs.at(-1) ?? null;
}

function getLatestLogByScope(session: AgentSession | null, scope: ExecutionLogEntry['scope']): ExecutionLogEntry | null {
  if (!session) {
    return null;
  }

  const logs = session.logs ?? [];
  return [...logs].reverse().find((entry) => entry.scope === scope) ?? null;
}

function hasCompletedRunForMode(session: AgentSession | null, mode: AgentMode): boolean {
  if (!session) {
    return false;
  }

  return (session.runs ?? []).some((run) => run.mode === mode);
}

function getCurrentStepText(
  activeLog: ExecutionLogEntry | null,
  state: DemoFlowState,
  session: AgentSession | null
): string {
  switch (state) {
    case 'local-running':
      return activeLog?.status === 'running'
        ? activeLog.message
        : 'Local execution started. Building the first checkpoint now.';
    case 'local-ready':
      return activeLog?.status === 'success'
        ? activeLog.message
        : 'Local execution completed. The checkpoint is ready for cloud continuation.';
    case 'switching':
      return activeLog?.status === 'running'
        ? activeLog.message
        : 'Switching the current session from local to cloud.';
    case 'cloud-running':
      return activeLog?.status === 'running'
        ? activeLog.message
        : 'Cloud execution started. Waiting for the cloud agent to continue the task.';
    case 'completed':
      return activeLog?.status === 'success'
        ? activeLog.message
        : session?.lastResult
          ? 'Execution completed. Review the latest result below.'
          : 'Execution completed.';
    case 'failed':
      return session?.lastResult ?? 'Execution failed.';
    default:
      if (activeLog?.message) {
        return activeLog.message;
      }

      return 'No execution has started yet.';
  }
}

function LogScopeIcon({ scope, status }: { scope: ExecutionLogEntry['scope']; status: ExecutionLogEntry['status'] }) {
  return (
    <span className={`scope-icon ${scope} ${status}`} aria-hidden="true">
      <span>{getScopeGlyph(scope)}</span>
    </span>
  );
}

function getScopeGlyph(scope: ExecutionLogEntry['scope']): string {
  switch (scope) {
    case 'local':
      return 'L';
    case 'cloud':
      return 'C';
    default:
      return 'O';
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

async function ensureMinimumPhaseTime(startedAt: number): Promise<void> {
  const elapsed = Date.now() - startedAt;
  const remaining = minimumVisibleRunMs - elapsed;

  if (remaining <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    window.setTimeout(() => resolve(), remaining);
  });
}