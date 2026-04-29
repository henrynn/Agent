const API_BASE = window.location.origin.startsWith("http")
  ? window.location.origin
  : "http://127.0.0.1:4040";
const ringCircumference = 2 * Math.PI * 46;

const state = {
  selectedExecutionId: null,
  tasks: [],
  executions: [],
  executionDetail: null,
  runtimeServices: [],
  runtimeSummary: null,
  isLoading: true,
  isMutating: false,
  lastSyncAt: null,
  connectionError: null,
  actionMessage: "",
  actionTone: ""
};

const ui = {
  clock: document.getElementById("fleet-clock"),
  activeCount: document.getElementById("active-count"),
  cloudCount: document.getElementById("cloud-count"),
  blockedCount: document.getElementById("blocked-count"),
  taskList: document.getElementById("task-list"),
  taskTemplate: document.getElementById("task-item-template"),
  title: document.getElementById("task-title"),
  summary: document.getElementById("task-summary"),
  connectionStatus: document.getElementById("connection-status"),
  actionMessage: document.getElementById("action-message"),
  statusChip: document.getElementById("task-status-chip"),
  progress: document.getElementById("task-progress"),
  runtimeOwner: document.getElementById("runtime-owner"),
  currentStep: document.getElementById("current-step"),
  leaseExpiry: document.getElementById("lease-expiry"),
  checkpointId: document.getElementById("checkpoint-id"),
  readinessChip: document.getElementById("readiness-chip"),
  readinessList: document.getElementById("readiness-list"),
  heartbeatAge: document.getElementById("heartbeat-age"),
  costBurn: document.getElementById("cost-burn"),
  artifactCount: document.getElementById("artifact-count"),
  retryRisk: document.getElementById("retry-risk"),
  planBoard: document.getElementById("plan-board"),
  topology: document.getElementById("topology-card"),
  eventStream: document.getElementById("event-stream"),
  checkpointList: document.getElementById("checkpoint-list"),
  handoffBtn: document.getElementById("handoff-btn"),
  checkpointBtn: document.getElementById("checkpoint-btn"),
  seedDemoBtn: document.getElementById("seed-demo-btn"),
  refreshRuntimeBtn: document.getElementById("refresh-runtime-btn"),
  runtimeServiceGrid: document.getElementById("runtime-service-grid"),
  ring: document.getElementById("progress-ring")
};

ui.ring.style.strokeDasharray = `${ringCircumference}`;
injectRingGradient();
render();

ui.handoffBtn.addEventListener("click", handleHandoff);
ui.checkpointBtn.addEventListener("click", handleCheckpoint);
ui.seedDemoBtn.addEventListener("click", handleSeedDemo);
ui.refreshRuntimeBtn.addEventListener("click", handleRuntimeRefresh);

window.setInterval(tickClock, 1000);
window.setInterval(refreshDashboard, 5000);
tickClock();
refreshDashboard();

function injectRingGradient() {
  const svg = document.querySelector(".progress-ring");
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const gradient = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
  gradient.setAttribute("id", "progressGradient");
  gradient.setAttribute("x1", "0%");
  gradient.setAttribute("y1", "0%");
  gradient.setAttribute("x2", "100%");
  gradient.setAttribute("y2", "100%");

  [
    ["0%", "#5de4c7"],
    ["100%", "#7ab6ff"]
  ].forEach(([offset, color]) => {
    const stop = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("stop-color", color);
    gradient.appendChild(stop);
  });

  defs.appendChild(gradient);
  svg.prepend(defs);
}

async function refreshDashboard() {
  try {
    const [taskResponse, executionResponse, runtimeResponse] = await Promise.all([
      fetchJson("/tasks"),
      fetchJson("/executions"),
      fetchJson("/runtime-services")
    ]);

    state.tasks = taskResponse.data || [];
    state.executions = executionResponse.data || [];
    state.runtimeServices = runtimeResponse.data || [];
    state.runtimeSummary = runtimeResponse.summary || null;
    state.connectionError = null;
    state.lastSyncAt = new Date();

    if (!state.executions.some((execution) => execution.id === state.selectedExecutionId)) {
      state.selectedExecutionId = state.executions[0]?.id || null;
    }

    if (state.selectedExecutionId) {
      state.executionDetail = await fetchJson(`/executions/${state.selectedExecutionId}`);
    }
    else {
      state.executionDetail = null;
    }
  }
  catch (error) {
    state.connectionError = error.message || "Failed to reach the orchestrator API.";
    state.executionDetail = null;
  }
  finally {
    state.isLoading = false;
    render();
  }
}

function render() {
  renderFleet();
  renderTaskList();
  renderTaskDetail(getSelectedViewModel());
  renderConnectionState();
  renderRuntimeServices();
}

function renderFleet() {
  ui.activeCount.textContent = state.executions.filter((execution) => execution.status.startsWith("running")).length;
  ui.cloudCount.textContent = state.executions.filter((execution) => execution.currentRuntime === "cloud").length;
  ui.blockedCount.textContent = state.executions.filter((execution) => getPrimaryStep(execution)?.status === "blocked").length;
}

function renderRuntimeServices() {
  ui.runtimeServiceGrid.innerHTML = "";

  state.runtimeServices.forEach((service) => {
    const card = document.createElement("article");
    card.className = "runtime-service-card";
    const actions = service.availableActions || [];
    const warnings = service.configurationWarnings || [];
    const actionsMarkup = actions.length > 0
      ? `
        <div class="runtime-service-card__actions">
          ${actions.map((action) => `
            <button
              type="button"
              class="btn ${action.variant === "primary" ? "btn--primary" : "btn--ghost"} runtime-action-btn"
              data-service-key="${service.key}"
              data-action-id="${action.id}"
              ${state.isMutating || action.disabled ? "disabled" : ""}
              title="${action.disabledReason || ""}"
            >
              ${action.label}
            </button>
          `).join("")}
        </div>
      `
      : `<div class="runtime-action-note">This service is self-hosted and does not expose dashboard actions.</div>`;
    const warningsMarkup = warnings.length > 0
      ? `
        <ul class="runtime-service-card__warnings">
          ${warnings.map((warning) => `<li>${warning}</li>`).join("")}
        </ul>
      `
      : "";

    card.innerHTML = `
      <div class="runtime-service-card__top">
        <div>
          <h3>${service.name}</h3>
          <p>${service.deployment}</p>
        </div>
        <div class="runtime-service-card__status-row">
          <span class="runtime-service-badge runtime-service-badge--${service.status}">${service.statusLabel}</span>
          <span class="pill runtime-service-card__control-pill">${service.controlStateLabel || "Unknown"}</span>
        </div>
      </div>
      <div class="runtime-service-card__detail">
        <p>${service.detail}</p>
      </div>
      <div class="runtime-service-card__control-detail">${service.controlDetail || "No control state available."}</div>
      <div class="runtime-service-card__meta">
        <div>
          <strong class="metric__label">Endpoint</strong>
          <p>${service.baseUrl || "Not configured"}</p>
        </div>
        <div>
          <strong class="metric__label">Checked</strong>
          <p>${service.checkedAt ? relativeTime(service.checkedAt) : "--"}</p>
        </div>
      </div>
      ${warningsMarkup}
      ${actionsMarkup}
      <div class="runtime-service-card__hint">${service.hint || ""}</div>
    `;

    card.querySelectorAll(".runtime-action-btn").forEach((button) => {
      button.addEventListener("click", () => {
        handleRuntimeAction(button.dataset.serviceKey, button.dataset.actionId, button.textContent.trim());
      });
    });

    ui.runtimeServiceGrid.appendChild(card);
  });
}

function renderTaskList() {
  ui.taskList.innerHTML = "";

  if (state.executions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "task-item";
    empty.innerHTML = `
      <div class="task-item__top">
        <div>
          <strong class="task-item__title">No executions yet</strong>
          <p class="task-item__meta">Create a demo run or start an execution through the API.</p>
        </div>
      </div>
    `;
    ui.taskList.appendChild(empty);
    return;
  }

  getExecutionCards().forEach((task) => {
    const fragment = ui.taskTemplate.content.cloneNode(true);
    const button = fragment.querySelector(".task-item");
    const title = fragment.querySelector(".task-item__title");
    const meta = fragment.querySelector(".task-item__meta");
    const runtime = fragment.querySelector(".task-item__runtime");
    const progress = fragment.querySelector(".task-item__progress-value");
    const status = fragment.querySelector(".task-item__status");
    const eta = fragment.querySelector(".task-item__eta");

    button.setAttribute("aria-selected", String(task.executionId === state.selectedExecutionId));
    button.dataset.executionId = task.executionId;
    title.textContent = task.title;
    meta.textContent = `${task.requestedBy} · ${task.executionId}`;
    runtime.textContent = task.runtimeLabel;
    progress.style.width = `${task.progress}%`;
    status.textContent = task.statusLabel;
    eta.textContent = task.etaLabel;

    button.addEventListener("click", async () => {
      state.selectedExecutionId = task.executionId;
      state.executionDetail = await fetchJson(`/executions/${task.executionId}`);
      render();
    });

    ui.taskList.appendChild(fragment);
  });
}

function renderTaskDetail(task) {
  ui.title.textContent = task.title;
  ui.summary.textContent = task.summary;
  ui.statusChip.textContent = task.statusLabel;
  ui.readinessChip.textContent = task.readiness;
  ui.progress.textContent = `${task.progress}%`;
  ui.runtimeOwner.textContent = task.runtimeOwner;
  ui.runtimeOwner.className = task.runtimeClassName;
  ui.currentStep.textContent = task.currentStep;
  ui.leaseExpiry.textContent = task.leaseExpiry;
  ui.checkpointId.textContent = task.checkpointId;
  ui.heartbeatAge.textContent = task.heartbeatAge;
  ui.costBurn.textContent = task.costBurn;
  ui.artifactCount.textContent = task.artifactCount;
  ui.retryRisk.textContent = task.retryRisk;

  const offset = ringCircumference * (1 - task.progress / 100);
  ui.ring.style.strokeDashoffset = `${offset}`;

  renderReadiness(task);
  renderPlan(task);
  renderTopology(task);
  renderEvents(task);
  renderCheckpoints(task);
  decorateStatus(task);
  updateButtons(task);
}

function renderReadiness(task) {
  ui.readinessList.innerHTML = "";

  task.readinessSignals.forEach(([label, detail]) => {
    const item = document.createElement("li");
    item.innerHTML = `<span><strong>${label}</strong><span>${detail}</span></span><span class="pill">${signalPill(label, detail)}</span>`;
    ui.readinessList.appendChild(item);
  });
}

function renderPlan(task) {
  ui.planBoard.innerHTML = "";

  task.plan.forEach(([title, status, detail, confidence], index) => {
    const card = document.createElement("article");
    card.className = "step-card";
    card.dataset.status = status;
    card.innerHTML = `
      <span class="step-card__status">${statusLabel(status)}</span>
      <h3>${String(index + 1).padStart(2, "0")} · ${title}</h3>
      <p>${detail}</p>
      <div class="step-card__footer">
        <span class="step-card__confidence">${confidence}</span>
        <span class="pill">${statusHint(status)}</span>
      </div>
    `;
    ui.planBoard.appendChild(card);
  });
}

function renderTopology(task) {
  ui.topology.innerHTML = "";

  task.topology.forEach(([name, stateText, meta]) => {
    const card = document.createElement("article");
    card.className = "topology-card";
    card.innerHTML = `
      <div>
        <strong>${name}</strong>
        <div class="topology__meta">${meta}</div>
      </div>
      <span class="pill topology-card__state">${stateText}</span>
    `;
    ui.topology.appendChild(card);
  });
}

function renderEvents(task) {
  ui.eventStream.innerHTML = "";

  task.events.forEach(([time, badge, detail]) => {
    const event = document.createElement("article");
    event.className = "event";
    event.innerHTML = `
      <div class="event__body">
        <strong>${badge}</strong>
        <p>${detail}</p>
      </div>
      <div>
        <span class="event__badge">${time}</span>
      </div>
    `;
    ui.eventStream.appendChild(event);
  });
}

function renderCheckpoints(task) {
  ui.checkpointList.innerHTML = "";

  task.checkpoints.forEach(([id, badge, meta]) => {
    const item = document.createElement("article");
    item.className = "checkpoint-item";
    item.innerHTML = `
      <div class="checkpoint-item__header">
        <div>
          <strong>${id}</strong>
          <p>${meta}</p>
        </div>
        <span class="checkpoint-item__badge">${badge}</span>
      </div>
      <div class="checkpoint-item__meta">Recoverable state includes plan pointer, artifact manifest, and side-effect ledger.</div>
    `;
    ui.checkpointList.appendChild(item);
  });
}

function renderConnectionState() {
  if (state.connectionError) {
    ui.connectionStatus.textContent = `Orchestrator offline: ${state.connectionError}`;
    paintActionMessage(state.connectionError, "error");
    return;
  }

  if (state.lastSyncAt) {
    ui.connectionStatus.textContent = `Connected to ${API_BASE} · last sync ${formatTime(state.lastSyncAt)}`;
  }
  else {
    ui.connectionStatus.textContent = "Connecting to orchestrator...";
  }

  if (!state.isMutating && state.executions.length > 0) {
    if (!state.actionMessage || state.actionTone === "error" || state.actionMessage.includes("No executions found")) {
      state.actionMessage = "Live execution state is being read from the orchestrator API.";
      state.actionTone = "success";
    }
  }
  else if (!state.isMutating && state.executions.length === 0) {
    if (!state.actionMessage || state.actionTone === "error") {
      state.actionMessage = "No executions found. Use 'Seed demo run' to populate the dashboard.";
      state.actionTone = "";
    }
  }

  paintActionMessage(state.actionMessage, state.actionTone);
}

function decorateStatus(task) {
  ui.statusChip.className = "status-chip";
  if (task.statusLabel === "Blocked") {
    ui.statusChip.classList.add("status-blocked");
  }
  else if (task.statusLabel === "Paused") {
    ui.statusChip.classList.add("status-paused");
  }
  else {
    ui.statusChip.classList.add("status-running");
  }

  ui.readinessChip.className = "pill";
  if (task.readiness === "Attention") {
    ui.readinessChip.classList.add("status-blocked");
  }
}

function updateButtons(task) {
  const hasExecution = Boolean(task.executionId);
  const canHandoff = hasExecution && task.runtime !== "cloud" && task.statusLabel !== "Blocked" && !state.isMutating;
  const canCheckpoint = hasExecution && !state.isMutating;

  ui.handoffBtn.disabled = !canHandoff;
  ui.checkpointBtn.disabled = !canCheckpoint;
  ui.seedDemoBtn.disabled = state.isMutating;

  ui.handoffBtn.textContent = task.runtime === "cloud" ? "Cloud active" : "Switch to cloud";
  ui.handoffBtn.style.opacity = canHandoff ? "1" : "0.55";
  ui.handoffBtn.style.cursor = canHandoff ? "pointer" : "not-allowed";
  ui.checkpointBtn.style.opacity = canCheckpoint ? "1" : "0.55";
  ui.checkpointBtn.style.cursor = canCheckpoint ? "pointer" : "not-allowed";
  ui.seedDemoBtn.style.opacity = state.isMutating ? "0.55" : "1";
  ui.seedDemoBtn.style.cursor = state.isMutating ? "not-allowed" : "pointer";
}

async function handleHandoff() {
  const task = getSelectedViewModel();
  if (!task.executionId || task.runtime === "cloud" || task.statusLabel === "Blocked") {
    return;
  }

  await runMutation("Creating checkpoint and handing execution to cloud...", async () => {
    const checkpoint = await fetchJson(`/executions/${task.executionId}/checkpoint`, {
      method: "POST",
      body: {
        runtime: "local",
        note: "Checkpoint created from the dashboard before cloud transfer."
      }
    });

    const handoff = await fetchJson(`/executions/${task.executionId}/handoff`, {
      method: "POST",
      body: {
        sourceRuntime: "local",
        targetRuntime: "cloud",
        checkpointId: checkpoint.id,
        createCheckpoint: false,
        reason: "Operator requested a cloud continuation from the dashboard.",
        toolCapabilityRequirements: ["portable:model-inference", "shared:artifact-store"],
        environmentRequirements: ["cloud-openclaw-runtime", "shared-state-store"]
      }
    });

    await fetchJson(`/executions/${task.executionId}/resume`, {
      method: "POST",
      body: {
        runtime: "cloud",
        handoffId: handoff.id
      }
    });

    await refreshDashboard();
    setActionMessage("Execution successfully resumed in cloud.", "success");
  });
}

async function handleCheckpoint() {
  const task = getSelectedViewModel();
  if (!task.executionId) {
    return;
  }

  await runMutation("Creating checkpoint...", async () => {
    await fetchJson(`/executions/${task.executionId}/checkpoint`, {
      method: "POST",
      body: {
        runtime: task.runtime,
        note: "Checkpoint requested from the control center UI."
      }
    });
    await refreshDashboard();
    setActionMessage("Checkpoint created successfully.", "success");
  });
}

async function handleSeedDemo() {
  await runMutation("Creating demo task and execution...", async () => {
    const task = await fetchJson("/tasks", {
      method: "POST",
      body: {
        title: "Hybrid agent UI seed run",
        goal: "Populate the dashboard with a live local execution that can be handed to cloud.",
        requestedBy: "ui-seed"
      }
    });

    const execution = await fetchJson("/executions", {
      method: "POST",
      body: {
        taskId: task.id,
        sourceRuntime: "local",
        progress: 28,
        summary: "Local runtime indexed the workspace and is preparing a cloud-safe synthesis step.",
        artifactRefs: ["artifact://workspace-index", "artifact://prompt-bundle"],
        plan: [
          {
            id: "step_ingest",
            title: "Ingest local workspace",
            status: "done",
            summary: "Workspace files and prompts were indexed on the local runtime.",
            sideEffectClass: "pure_read"
          },
          {
            id: "step_prepare",
            title: "Prepare handoff package",
            status: "running",
            summary: "The runtime is sealing a portable checkpoint boundary.",
            sideEffectClass: "replay_safe_write"
          },
          {
            id: "step_cloud",
            title: "Cloud synthesis",
            status: "queued",
            summary: "Long-running synthesis is ready for cloud continuation.",
            sideEffectClass: "replay_safe_write"
          }
        ]
      }
    });

    state.selectedExecutionId = execution.id;
    await refreshDashboard();
    setActionMessage("Demo execution created. You can checkpoint or switch it to cloud now.", "success");
  });
}

async function handleRuntimeRefresh() {
  await runMutation("Refreshing runtime service probes...", async () => {
    const runtimeResponse = await fetchJson("/runtime-services");
    state.runtimeServices = runtimeResponse.data || [];
    state.runtimeSummary = runtimeResponse.summary || null;
    setActionMessage("Runtime service status refreshed.", "success");
  });
}

async function handleRuntimeAction(serviceKey, actionId, actionLabel) {
  await runMutation(`${actionLabel}...`, async () => {
    const response = await fetchJson(`/runtime-services/${serviceKey}/actions/${actionId}`, {
      method: "POST"
    });

    state.runtimeServices = response.services || [];
    state.runtimeSummary = response.summary || null;
    setActionMessage(buildRuntimeActionMessage(response.action), "success");
  });
}

async function runMutation(message, work) {
  if (state.isMutating) {
    return;
  }

  state.isMutating = true;
  state.actionMessage = message;
  state.actionTone = "";
  render();

  try {
    await work();
  }
  catch (error) {
    state.actionMessage = error.message || "Mutation failed.";
    state.actionTone = "error";
  }
  finally {
    state.isMutating = false;
    render();
  }
}

function getExecutionCards() {
  return state.executions
    .slice()
    .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
    .map((execution) => {
      const task = state.tasks.find((candidate) => candidate.id === execution.taskId);
      const primaryStep = getPrimaryStep(execution);
      return {
        executionId: execution.id,
        title: task?.title || execution.id,
        requestedBy: task?.requestedBy || "operator",
        runtimeLabel: execution.currentRuntime === "cloud" ? "Cloud" : "Local",
        progress: execution.progress || 0,
        statusLabel: executionStatusLabel(execution),
        etaLabel: primaryStep?.status === "blocked" ? "Awaiting action" : relativeLease(execution.leaseExpiresAt)
      };
    });
}

function getSelectedViewModel() {
  if (state.connectionError) {
    return emptyViewModel("Orchestrator unavailable", "Start services/orchestrator/server.js and refresh the dashboard.");
  }

  if (!state.executionDetail) {
    return emptyViewModel("No execution selected", "Use 'Seed demo run' or create an execution through the orchestrator API.");
  }

  const execution = state.executionDetail;
  const task = state.tasks.find((candidate) => candidate.id === execution.taskId);
  const currentStep = getPrimaryStep(execution);
  const checkpoints = (execution.checkpoints || []).slice().sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  const recentEvents = (execution.recentEvents || []).slice().sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  const runtime = execution.currentRuntime || execution.owner || "local";
  const artifactCount = execution.artifactRefs?.length || 0;

  return {
    executionId: execution.id,
    title: task?.title || execution.id,
    summary: task?.goal || execution.summary || "Execution loaded from orchestrator.",
    statusLabel: executionStatusLabel(execution),
    readiness: deriveReadiness(execution, currentStep),
    progress: execution.progress || 0,
    runtime,
    runtimeOwner: runtime === "cloud" ? "Cloud Runtime" : "Local Runtime",
    runtimeClassName: runtime === "cloud" ? "runtime-cloud" : "runtime-local",
    currentStep: currentStep?.title || "Completed",
    leaseExpiry: execution.leaseExpiresAt ? formatTime(execution.leaseExpiresAt) : "Pending transfer",
    checkpointId: execution.currentCheckpointId || "None yet",
    heartbeatAge: relativeTime(execution.lastHeartbeatAt),
    costBurn: `$${estimateCost(execution).toFixed(2)}`,
    artifactCount: String(artifactCount),
    retryRisk: deriveRetryRisk(execution, currentStep),
    readinessSignals: deriveReadinessSignals(execution, currentStep, checkpoints),
    topology: deriveTopology(execution, checkpoints),
    plan: (execution.plan || []).map((step) => [
      step.title,
      step.status,
      step.summary || "No summary recorded yet.",
      confidenceLabel(step)
    ]),
    checkpoints: checkpoints.map((checkpoint) => [
      checkpoint.id,
      checkpoint.status === "stable" ? "Stable" : checkpoint.status,
      `${checkpoint.runtime} runtime · ${checkpoint.note}`
    ]),
    events: recentEvents.map((event) => [
      relativeTime(event.createdAt),
      event.title,
      event.detail
    ])
  };
}

function emptyViewModel(title, summary) {
  return {
    executionId: null,
    title,
    summary,
    statusLabel: "Idle",
    readiness: "Waiting",
    progress: 0,
    runtime: "local",
    runtimeOwner: "No active runtime",
    runtimeClassName: "runtime-local",
    currentStep: "None",
    leaseExpiry: "--",
    checkpointId: "--",
    heartbeatAge: "--",
    costBurn: "$0.00",
    artifactCount: "0",
    retryRisk: "Low",
    readinessSignals: [
      ["Connection", state.connectionError || "No active execution loaded yet."],
      ["Next step", "Seed a demo run or create an execution through the API."]
    ],
    topology: [
      ["Local runtime", "Idle", "No lease claimed"],
      ["Cloud runtime", "Idle", "No handoff package pending"],
      ["State store", "Ready", "File-backed orchestrator state is available"],
      ["Artifact sync", "Ready", "No artifacts tracked yet"]
    ],
    plan: [["Waiting for execution", "queued", "Create or select an execution to populate the dashboard.", "No data"]],
    checkpoints: [["No checkpoints", "Waiting", "Checkpoints appear here once created."]],
    events: [["Now", "Idle", "No execution activity yet."]]
  };
}

function deriveReadinessSignals(execution, currentStep, checkpoints) {
  return [
    ["Checkpoint integrity", checkpoints[0] ? `Latest checkpoint ${checkpoints[0].id} is available for resume.` : "No checkpoint created yet."],
    ["Ownership lease", execution.owner === "none" ? "Lease released for handoff." : `${execution.owner} runtime currently owns the execution.`],
    ["Current step", currentStep ? `${currentStep.title} is ${currentStep.status}.` : "No active step is recorded."],
    ["Transfer gate", execution.currentRuntime === "cloud" ? "Cloud runtime already has the lease." : currentStep?.status === "blocked" ? "Resolve the blocked step before transfer." : "Execution can be moved after checkpointing."]
  ];
}

function deriveTopology(execution, checkpoints) {
  return [
    ["Local runtime", execution.currentRuntime === "local" ? "Attached" : execution.owner === "none" ? "Released" : "Observer", execution.currentRuntime === "local" ? "Local runtime currently owns execution progress" : "Local side is not the active owner"],
    ["Cloud runtime", execution.currentRuntime === "cloud" ? "Executing" : execution.targetRuntime === "cloud" ? "Pending takeover" : "Warm standby", execution.currentRuntime === "cloud" ? "Cloud runtime resumed from the latest checkpoint" : "Ready to claim the next handoff"],
    ["State store", "Healthy", `${checkpoints.length} checkpoint(s) tracked in orchestrator state`],
    ["Artifact sync", execution.artifactRefs?.length ? "Tracked" : "Idle", `${execution.artifactRefs?.length || 0} artifact reference(s) attached to this execution`]
  ];
}

function deriveReadiness(execution, currentStep) {
  if (currentStep?.status === "blocked") {
    return "Attention";
  }
  if (execution.currentRuntime === "cloud") {
    return "In cloud";
  }
  if (execution.pendingHandoffId || execution.status === "handoff_pending") {
    return "Transfer pending";
  }
  return "Stable";
}

function deriveRetryRisk(execution, currentStep) {
  if (currentStep?.status === "blocked") {
    return "High";
  }
  if (!execution.currentCheckpointId) {
    return "Medium";
  }
  return "Low";
}

function getPrimaryStep(execution) {
  return (execution.plan || []).find((step) => step.id === execution.currentStepId)
    || (execution.plan || []).find((step) => step.status === "running" || step.status === "blocked")
    || (execution.plan || [])[0]
    || null;
}

function executionStatusLabel(execution) {
  const primaryStep = getPrimaryStep(execution);
  if (primaryStep?.status === "blocked") {
    return "Blocked";
  }
  if (execution.status === "handoff_pending") {
    return "Handoff pending";
  }
  if (execution.status === "completed") {
    return "Completed";
  }
  return "Running";
}

function confidenceLabel(step) {
  if (step.status === "done") {
    return "Recovered from persisted state";
  }
  if (step.status === "running") {
    return "Live in active runtime";
  }
  if (step.status === "blocked") {
    return "Operator input required";
  }
  return "Ready to schedule";
}

function estimateCost(execution) {
  const base = execution.plan.length * 1.35;
  const runtimeMultiplier = execution.currentRuntime === "cloud" ? 1.4 : 1.0;
  return base * runtimeMultiplier + (execution.artifactRefs?.length || 0) * 0.18 + (execution.progress || 0) * 0.04;
}

function statusLabel(status) {
  if (status === "done") {
    return "Complete";
  }
  if (status === "running") {
    return "Live";
  }
  if (status === "blocked") {
    return "Blocked";
  }
  return "Queued";
}

function statusHint(status) {
  if (status === "done") {
    return "Re-play safe";
  }
  if (status === "running") {
    return "Checkpoint aware";
  }
  if (status === "blocked") {
    return "Human gate";
  }
  return "Waiting";
}

function signalPill(label, detail) {
  const lowered = `${label} ${detail}`.toLowerCase();
  if (lowered.includes("blocked") || lowered.includes("no checkpoint") || lowered.includes("resolve")) {
    return "Attention";
  }
  if (lowered.includes("lease")) {
    return "Leased";
  }
  if (lowered.includes("cloud")) {
    return "Live";
  }
  return "Ready";
}

function relativeLease(leaseExpiresAt) {
  if (!leaseExpiresAt) {
    return "Pending";
  }

  const delta = new Date(leaseExpiresAt).getTime() - Date.now();
  if (delta <= 0) {
    return "Lease expired";
  }

  const minutes = Math.round(delta / 60000);
  return `${minutes} min lease`;
}

function relativeTime(value) {
  if (!value) {
    return "--";
  }

  const deltaSeconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (deltaSeconds < 60) {
    return `${deltaSeconds}s ago`;
  }

  const minutes = Math.round(deltaSeconds / 60);
  return `${minutes}m ago`;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function tickClock() {
  ui.clock.textContent = new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function setActionMessage(message, tone) {
  state.actionMessage = message;
  state.actionTone = tone;
  paintActionMessage(message, tone);
}

function buildRuntimeActionMessage(action) {
  if (!action) {
    return "Runtime action completed.";
  }

  return [action.message, action.output].filter(Boolean).join(" ");
}

function paintActionMessage(message, tone) {
  ui.actionMessage.textContent = message;
  ui.actionMessage.className = "action-message";
  if (tone === "success") {
    ui.actionMessage.classList.add("action-message--success");
  }
  else if (tone === "error") {
    ui.actionMessage.classList.add("action-message--error");
  }
}

async function fetchJson(path, options = {}) {
  const request = {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json"
    }
  };

  if (options.body !== undefined) {
    request.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${API_BASE}${path}`, request);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error?.message || `Request failed for ${path}`);
  }

  return payload;
}
