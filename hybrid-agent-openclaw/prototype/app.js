const API_BASE = window.location.origin.startsWith("http")
  ? window.location.origin
  : "http://127.0.0.1:4040";

const state = {
  executions: [],
  tasks: [],
  selectedExecutionId: null,
  selectedExecution: null,
  logs: [],
  isMutating: false,
  lastSyncAt: null,
  connectionError: null,
  actionMessage: "等待输入任务。",
  actionTone: ""
};

const ui = {
  connectionStatus: document.getElementById("connection-status"),
  lastSync: document.getElementById("last-sync"),
  taskForm: document.getElementById("task-form"),
  taskInput: document.getElementById("task-input"),
  createTaskBtn: document.getElementById("create-task-btn"),
  handoffBtn: document.getElementById("handoff-btn"),
  actionMessage: document.getElementById("action-message"),
  statusChip: document.getElementById("status-chip"),
  runTitle: document.getElementById("run-title"),
  runPrompt: document.getElementById("run-prompt"),
  localStepCard: document.getElementById("local-step-card"),
  cloudStepCard: document.getElementById("cloud-step-card"),
  resultStepCard: document.getElementById("result-step-card"),
  localStepCopy: document.getElementById("local-step-copy"),
  cloudStepCopy: document.getElementById("cloud-step-copy"),
  resultStepCopy: document.getElementById("result-step-copy"),
  runtimeOwner: document.getElementById("runtime-owner"),
  progressLabel: document.getElementById("progress-label"),
  checkpointLabel: document.getElementById("checkpoint-label"),
  heartbeatLabel: document.getElementById("heartbeat-label"),
  progressBarValue: document.getElementById("progress-bar-value"),
  logStatus: document.getElementById("log-status"),
  logStream: document.getElementById("log-stream"),
  resultStatus: document.getElementById("result-status"),
  resultContent: document.getElementById("result-content"),
  runList: document.getElementById("run-list"),
  runItemTemplate: document.getElementById("run-item-template")
};

ui.taskForm.addEventListener("submit", handleCreateTask);
ui.handoffBtn.addEventListener("click", handlePauseAndHandoff);

window.setInterval(refreshDashboard, 2000);
refreshDashboard();

async function refreshDashboard() {
  try {
    const [taskResponse, executionResponse] = await Promise.all([
      fetchJson("/tasks"),
      fetchJson("/executions")
    ]);

    state.tasks = taskResponse.data || [];
    state.executions = (executionResponse.data || []).slice().sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
    state.connectionError = null;
    state.lastSyncAt = new Date();

    if (!state.executions.some((execution) => execution.id === state.selectedExecutionId)) {
      state.selectedExecutionId = state.executions[0]?.id || null;
    }

    if (state.selectedExecutionId) {
      const [executionDetail, logResponse] = await Promise.all([
        fetchJson(`/executions/${state.selectedExecutionId}`),
        fetchJson(`/executions/${state.selectedExecutionId}/logs`)
      ]);
      state.selectedExecution = executionDetail;
      state.logs = logResponse.data || [];
    }
    else {
      state.selectedExecution = null;
      state.logs = [];
    }
  }
  catch (error) {
    state.connectionError = error.message || "无法连接到编排服务。";
    state.selectedExecution = null;
    state.logs = [];
  }

  render();
}

function render() {
  renderConnectionState();
  renderActionMessage();
  renderCurrentExecution();
  renderLogs();
  renderResult();
  renderRunList();
  updateButtons();
}

function renderConnectionState() {
  if (state.connectionError) {
    ui.connectionStatus.textContent = `服务离线: ${state.connectionError}`;
    ui.lastSync.textContent = "未同步";
    return;
  }

  ui.connectionStatus.textContent = `已连接 ${API_BASE}`;
  ui.lastSync.textContent = state.lastSyncAt ? `最近同步 ${formatTime(state.lastSyncAt)}` : "等待同步";
}

function renderActionMessage() {
  ui.actionMessage.textContent = state.actionMessage;
  ui.actionMessage.className = "action-message";
  if (state.actionTone === "success") {
    ui.actionMessage.classList.add("action-message--success");
  }
  if (state.actionTone === "error") {
    ui.actionMessage.classList.add("action-message--error");
  }
}

function renderCurrentExecution() {
  const execution = state.selectedExecution;
  if (!execution) {
    ui.statusChip.textContent = "空闲";
    ui.runTitle.textContent = "还没有任务";
    ui.runPrompt.textContent = "输入任务后，本地会先启动；当你点击切换时，会暂停 Local 并把执行转到云端。";
    ui.runtimeOwner.textContent = "Local";
    ui.progressLabel.textContent = "0%";
    ui.checkpointLabel.textContent = "暂无";
    ui.heartbeatLabel.textContent = "--";
    ui.progressBarValue.style.width = "0%";
    paintStep(ui.localStepCard, "waiting", "等待开始");
    paintStep(ui.cloudStepCard, "waiting", "等待切换");
    paintStep(ui.resultStepCard, "waiting", "等待执行完成");
    ui.localStepCopy.textContent = "等待开始";
    ui.cloudStepCopy.textContent = "等待切换";
    ui.resultStepCopy.textContent = "执行完成后展示";
    return;
  }

  const task = state.tasks.find((candidate) => candidate.id === execution.taskId);
  const prompt = execution.request?.prompt || task?.goal || execution.summary;
  const localStep = findStep(execution, "step_local");
  const cloudStep = findStep(execution, "step_cloud");
  const resultStep = findStep(execution, "step_result");

  ui.statusChip.textContent = mapExecutionStatus(execution);
  ui.runTitle.textContent = task?.title || "未命名任务";
  ui.runPrompt.textContent = prompt;
  ui.runtimeOwner.textContent = execution.currentRuntime === "cloud" ? "Cloud" : "Local";
  ui.progressLabel.textContent = `${execution.progress || 0}%`;
  ui.checkpointLabel.textContent = execution.currentCheckpointId || "暂无";
  ui.heartbeatLabel.textContent = relativeTime(execution.lastHeartbeatAt);
  ui.progressBarValue.style.width = `${execution.progress || 0}%`;

  paintStep(ui.localStepCard, statusToPhase(localStep?.status, execution.currentRuntime === "local"), localStep?.summary || "等待开始");
  paintStep(ui.cloudStepCard, statusToPhase(cloudStep?.status, execution.currentRuntime === "cloud"), cloudStep?.summary || "等待切换");
  paintStep(ui.resultStepCard, statusToPhase(resultStep?.status, execution.status === "completed"), resultStep?.summary || "等待执行完成");

  ui.localStepCopy.textContent = localStep?.summary || "等待开始";
  ui.cloudStepCopy.textContent = cloudStep?.summary || "等待切换";
  ui.resultStepCopy.textContent = resultStep?.summary || "等待执行完成";
}

function renderLogs() {
  ui.logStream.innerHTML = "";

  if (state.logs.length === 0) {
    ui.logStatus.textContent = "无日志";
    const empty = document.createElement("div");
    empty.className = "log-line";
    empty.textContent = "任务开始后，这里会显示编排器状态和 OpenClaw 当前 runtime 的真实日志。";
    ui.logStream.appendChild(empty);
    return;
  }

  const taskOpenClawLogCount = state.logs.filter((log) => log.source === "openclaw").length;
  const liveOpenClawLogCount = state.logs.filter((log) => log.source === "openclaw-live").length;
  ui.logStatus.textContent = `${state.logs.length} 条日志 · 任务相关 ${taskOpenClawLogCount} 条 · Live ${liveOpenClawLogCount} 条`;

  state.logs.forEach((log) => {
    const line = document.createElement("article");
    line.className = "log-line";
    if (log.level) {
      line.dataset.level = log.level;
    }

    const sourceLabel = log.source === "openclaw-live"
      ? "OPENCLAW LIVE"
      : log.source === "openclaw"
        ? "OPENCLAW TASK"
        : "ORCHESTRATOR";
    const runtimeLabel = log.runtime ? log.runtime.toUpperCase() : "SYSTEM";
    line.innerHTML = `
      <div class="log-line__meta">
        <span class="log-line__runtime">${runtimeLabel}</span>
        <span class="log-line__source">${sourceLabel}</span>
        <span>${formatTime(log.createdAt)}</span>
      </div>
      <div>${log.message}</div>
    `;
    ui.logStream.appendChild(line);
  });

  ui.logStream.scrollTop = ui.logStream.scrollHeight;
}

function renderResult() {
  const execution = state.selectedExecution;
  if (!execution?.result) {
    ui.resultStatus.textContent = execution ? "等待云端完成" : "等待任务开始";
    ui.resultContent.className = "result-content empty-state";
    ui.resultContent.textContent = "云端完成后，结果会显示在这里。";
    return;
  }

  const artifacts = Array.isArray(execution.result.artifacts) ? execution.result.artifacts : [];
  ui.resultStatus.textContent = artifacts.length > 0
    ? `完成于 ${formatTime(execution.result.finishedAt)} · ${artifacts.length} 个产物`
    : `完成于 ${formatTime(execution.result.finishedAt)}`;
  ui.resultContent.className = "result-content";
  ui.resultContent.innerHTML = "";

  const stack = document.createElement("div");
  stack.className = "result-stack";

  if (execution.result.title) {
    const title = document.createElement("h3");
    title.className = "result-title";
    title.textContent = execution.result.title;
    stack.appendChild(title);
  }

  const output = document.createElement("pre");
  output.className = "result-output";
  output.textContent = execution.result.output || "结果为空。";
  stack.appendChild(output);

  if (artifacts.length > 0) {
    const artifactSection = document.createElement("section");
    artifactSection.className = "artifact-list";

    artifacts.forEach((artifact) => {
      const card = document.createElement("article");
      card.className = "artifact-card";

      const meta = document.createElement("div");
      meta.className = "artifact-card__meta";

      const name = document.createElement("strong");
      name.textContent = artifact.name || "未命名产物";
      meta.appendChild(name);

      const detail = document.createElement("span");
      detail.className = "artifact-card__detail";
      detail.textContent = `${artifact.kind || "file"} · ${formatBytes(artifact.sizeBytes)}`;
      meta.appendChild(detail);

      const link = document.createElement("a");
      link.className = "artifact-link";
      link.href = artifact.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = artifact.contentType?.includes("presentation")
        ? "查看 / 下载 PPT"
        : "打开产物";

      card.appendChild(meta);
      card.appendChild(link);
      artifactSection.appendChild(card);
    });

    stack.appendChild(artifactSection);
  }

  ui.resultContent.appendChild(stack);
}

function renderRunList() {
  ui.runList.innerHTML = "";

  if (state.executions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "还没有任务记录。";
    ui.runList.appendChild(empty);
    return;
  }

  state.executions.forEach((execution) => {
    const task = state.tasks.find((candidate) => candidate.id === execution.taskId);
    const fragment = ui.runItemTemplate.content.cloneNode(true);
    const button = fragment.querySelector(".run-item");
    const title = fragment.querySelector(".run-item__title");
    const status = fragment.querySelector(".run-item__status");
    const summary = fragment.querySelector(".run-item__summary");
    const runtime = fragment.querySelector(".run-item__runtime");
    const time = fragment.querySelector(".run-item__time");

    button.setAttribute("aria-selected", String(execution.id === state.selectedExecutionId));
    title.textContent = task?.title || execution.id;
    status.textContent = mapExecutionStatus(execution);
    summary.textContent = task?.goal || execution.summary || "无摘要";
    runtime.textContent = execution.currentRuntime === "cloud" ? "Cloud" : "Local";
    time.textContent = relativeTime(execution.updatedAt);

    button.addEventListener("click", async () => {
      state.selectedExecutionId = execution.id;
      await refreshDashboard();
    });

    ui.runList.appendChild(fragment);
  });
}

function updateButtons() {
  const execution = state.selectedExecution;
  const canHandoff = Boolean(execution)
    && execution.currentRuntime === "local"
    && execution.status !== "completed"
    && !state.isMutating;

  ui.createTaskBtn.disabled = state.isMutating;
  ui.handoffBtn.disabled = !canHandoff;
}

async function handleCreateTask(event) {
  event.preventDefault();

  const prompt = ui.taskInput.value.trim();
  if (!prompt) {
    setActionMessage("请先输入任务内容。", "error");
    return;
  }

  await runMutation("正在创建本地任务...", async () => {
    const execution = await fetchJson("/guided-runs", {
      method: "POST",
      body: {
        prompt
      }
    });

    state.selectedExecutionId = execution.id;
    setActionMessage("任务已在 Local 启动。准备好后可以切到云端执行。", "success");
    await refreshDashboard();
  });
}

async function handlePauseAndHandoff() {
  const execution = state.selectedExecution;
  if (!execution) {
    setActionMessage("当前没有可切换的任务。", "error");
    return;
  }

  await runMutation("正在在 Local 暂停，并切到云端执行...", async () => {
    await fetchJson(`/executions/${execution.id}/pause-and-handoff`, {
      method: "POST"
    });
    setActionMessage("已暂停 Local，并切换到 Cloud。日志会持续刷新。", "success");
    await refreshDashboard();
  });
}

async function runMutation(message, work) {
  if (state.isMutating) {
    return;
  }

  state.isMutating = true;
  setActionMessage(message, "");
  render();

  try {
    await work();
  }
  catch (error) {
    setActionMessage(error.message || "操作失败。", "error");
  }
  finally {
    state.isMutating = false;
    render();
  }
}

function setActionMessage(message, tone) {
  state.actionMessage = message;
  state.actionTone = tone;
}

function paintStep(element, phase, text) {
  element.dataset.state = phase;
  element.querySelector("p").textContent = text;
}

function mapExecutionStatus(execution) {
  if (!execution) {
    return "空闲";
  }
  if (execution.status === "completed") {
    return "已完成";
  }
  if (execution.currentRuntime === "cloud") {
    return "云端执行中";
  }
  return "本地准备中";
}

function statusToPhase(stepStatus, activeFallback) {
  if (stepStatus === "done") {
    return "done";
  }
  if (stepStatus === "running" || activeFallback) {
    return "active";
  }
  return "waiting";
}

function findStep(execution, id) {
  return (execution.plan || []).find((step) => step.id === id) || null;
}

function relativeTime(value) {
  if (!value) {
    return "--";
  }

  const deltaSeconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (deltaSeconds < 60) {
    return `${deltaSeconds} 秒前`;
  }

  const minutes = Math.round(deltaSeconds / 60);
  return `${minutes} 分钟前`;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "大小未知";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
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
