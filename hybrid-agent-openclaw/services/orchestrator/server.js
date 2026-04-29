import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = "127.0.0.1";
const PORT = 4040;
const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "orchestrator-state.json");
const UI_DIR = path.join(__dirname, "..", "..", "prototype");
const ROOT_DIR = path.join(__dirname, "..", "..");
const LOCAL_OPENCLAW_DIR = path.join(ROOT_DIR, "deploy", "openclaw", "local");
const LOCAL_OPENCLAW_ENV_FILE = path.join(LOCAL_OPENCLAW_DIR, ".env");
const LOCAL_OPENCLAW_ENV_EXAMPLE = path.join(LOCAL_OPENCLAW_DIR, ".env.example");
const LOCAL_OPENCLAW_START_SCRIPT = path.join(LOCAL_OPENCLAW_DIR, "start.ps1");
const LOCAL_OPENCLAW_STOP_SCRIPT = path.join(LOCAL_OPENCLAW_DIR, "stop.ps1");
const CLOUD_OPENCLAW_ENV_FILE = path.join(ROOT_DIR, "deploy", "openclaw", ".env.cloud");
const CLOUD_OPENCLAW_DEPLOY_SCRIPT = path.join(ROOT_DIR, "deploy", "openclaw", "aca", "deploy.ps1");
const CLOUD_OPENCLAW_RUN_SCRIPT = path.join(ROOT_DIR, "deploy", "openclaw", "run-poc.ps1");
const CLOUD_DEPLOYMENT_ENV_VARS = {
  resourceGroup: "CLOUD_OPENCLAW_RESOURCE_GROUP",
  location: "CLOUD_OPENCLAW_LOCATION",
  managedEnvironmentName: "CLOUD_OPENCLAW_MANAGED_ENVIRONMENT",
  containerAppName: "CLOUD_OPENCLAW_CONTAINER_APP",
  storageAccountName: "CLOUD_OPENCLAW_STORAGE_ACCOUNT",
  fileShareName: "CLOUD_OPENCLAW_FILE_SHARE",
  acrName: "CLOUD_OPENCLAW_ACR_NAME",
  imageRepository: "CLOUD_OPENCLAW_IMAGE_REPOSITORY",
  imageTag: "CLOUD_OPENCLAW_IMAGE_TAG",
  userAssignedIdentityName: "CLOUD_OPENCLAW_IDENTITY_NAME",
  gatewayToken: "CLOUD_OPENCLAW_GATEWAY_TOKEN",
  openAiApiKey: "CLOUD_OPENCLAW_OPENAI_API_KEY",
  baseUrl: "CLOUD_OPENCLAW_URL"
};
const RUNTIME_SERVICES = [
  {
    key: "orchestrator",
    name: "Orchestrator",
    kind: "control-plane",
    deployment: "Node.js service in the local workspace",
    baseUrl: `http://${HOST}:${PORT}`,
    probe: "health",
    hint: "This service hosts both the UI and the handoff/checkpoint API."
  },
  {
    key: "local-openclaw",
    name: "Local OpenClaw",
    kind: "agent-runtime",
    deployment: "Docker Compose on the developer machine",
    baseUrl: process.env.LOCAL_OPENCLAW_URL || "http://127.0.0.1:18789",
    probe: "openclaw-models",
    tokenEnv: "LOCAL_OPENCLAW_TOKEN",
    hint: "The dashboard can start or stop the local Compose stack directly."
  },
  {
    key: "cloud-openclaw",
    name: "Cloud OpenClaw",
    kind: "agent-runtime",
    deployment: "Azure Container Apps",
    baseUrl: process.env.CLOUD_OPENCLAW_URL || null,
    probe: "openclaw-models",
    tokenEnv: "CLOUD_OPENCLAW_TOKEN",
    hint: "Set CLOUD_OPENCLAW_* deployment variables so the dashboard can deploy or refresh the ACA runtime."
  }
];

ensureStateFile();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    const method = req.method || "GET";

    if (method === "OPTIONS") {
      return sendNoContent(res);
    }

    if (method === "GET" && url.pathname === "/") {
      return sendStaticFile(res, path.join(UI_DIR, "index.html"));
    }

    if (method === "GET" && url.pathname === "/app.js") {
      return sendStaticFile(res, path.join(UI_DIR, "app.js"));
    }

    if (method === "GET" && url.pathname === "/styles.css") {
      return sendStaticFile(res, path.join(UI_DIR, "styles.css"));
    }

    if (method === "GET" && url.pathname === "/runtime-services") {
      const services = await getRuntimeServices();
      return sendJson(res, 200, {
        data: services,
        summary: buildRuntimeSummary(services)
      });
    }

    const runtimeActionMatch = url.pathname.match(/^\/runtime-services\/([^/]+)\/actions\/([^/]+)$/);
    if (method === "POST" && runtimeActionMatch) {
      const action = await invokeRuntimeAction(runtimeActionMatch[1], runtimeActionMatch[2]);
      const services = await getRuntimeServices();
      const service = services.find((candidate) => candidate.key === runtimeActionMatch[1]) || null;
      return sendJson(res, 200, {
        data: service,
        services,
        summary: buildRuntimeSummary(services),
        action
      });
    }

    if (method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, getHealth());
    }

    if (method === "GET" && url.pathname === "/tasks") {
      return sendJson(res, 200, { data: readState().tasks });
    }

    if (method === "POST" && url.pathname === "/tasks") {
      const body = await readJsonBody(req);
      const task = createTask(body);
      return sendJson(res, 201, task);
    }

    if (method === "GET" && url.pathname === "/executions") {
      return sendJson(res, 200, { data: readState().executions });
    }

    if (method === "POST" && url.pathname === "/executions") {
      const body = await readJsonBody(req);
      const execution = createExecution(body);
      return sendJson(res, 201, execution);
    }

    const taskMatch = url.pathname.match(/^\/tasks\/([^/]+)$/);
    if (method === "GET" && taskMatch) {
      const task = findTask(taskMatch[1]);
      return sendJson(res, 200, task);
    }

    const executionMatch = url.pathname.match(/^\/executions\/([^/]+)$/);
    if (method === "GET" && executionMatch) {
      const execution = enrichExecution(findExecution(executionMatch[1]));
      return sendJson(res, 200, execution);
    }

    const eventsMatch = url.pathname.match(/^\/executions\/([^/]+)\/events$/);
    if (method === "GET" && eventsMatch) {
      const execution = findExecution(eventsMatch[1]);
      const state = readState();
      const events = state.events.filter((event) => event.executionId === execution.id);
      return sendJson(res, 200, { data: events });
    }

    const checkpointsMatch = url.pathname.match(/^\/executions\/([^/]+)\/checkpoints$/);
    if (method === "GET" && checkpointsMatch) {
      const execution = findExecution(checkpointsMatch[1]);
      const state = readState();
      const checkpoints = state.checkpoints.filter((checkpoint) => checkpoint.executionId === execution.id);
      return sendJson(res, 200, { data: checkpoints });
    }

    const checkpointCreateMatch = url.pathname.match(/^\/executions\/([^/]+)\/checkpoint$/);
    if (method === "POST" && checkpointCreateMatch) {
      const body = await readJsonBody(req);
      const checkpoint = createCheckpoint(checkpointCreateMatch[1], body);
      return sendJson(res, 201, checkpoint);
    }

    const handoffMatch = url.pathname.match(/^\/executions\/([^/]+)\/handoff$/);
    if (method === "POST" && handoffMatch) {
      const body = await readJsonBody(req);
      const handoff = createHandoff(handoffMatch[1], body);
      return sendJson(res, 201, handoff);
    }

    const resumeMatch = url.pathname.match(/^\/executions\/([^/]+)\/resume$/);
    if (method === "POST" && resumeMatch) {
      const body = await readJsonBody(req);
      const execution = resumeExecution(resumeMatch[1], body);
      return sendJson(res, 200, execution);
    }

    const stepMatch = url.pathname.match(/^\/executions\/([^/]+)\/steps\/([^/]+)$/);
    if (method === "POST" && stepMatch) {
      const body = await readJsonBody(req);
      const execution = updateStep(stepMatch[1], stepMatch[2], body);
      return sendJson(res, 200, execution);
    }

    const heartbeatMatch = url.pathname.match(/^\/executions\/([^/]+)\/heartbeat$/);
    if (method === "POST" && heartbeatMatch) {
      const body = await readJsonBody(req);
      const execution = recordHeartbeat(heartbeatMatch[1], body);
      return sendJson(res, 200, execution);
    }

    sendJson(res, 404, {
      error: {
        code: "not_found",
        message: `No route for ${method} ${url.pathname}`
      }
    });
  }
  catch (error) {
    const status = error.statusCode || 500;
    sendJson(res, status, {
      error: {
        code: error.code || "internal_error",
        message: error.message || "Unexpected error"
      }
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Hybrid orchestrator listening on http://${HOST}:${PORT}`);
});

function ensureStateFile() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!existsSync(STATE_FILE)) {
    writeState({
      tasks: [],
      executions: [],
      checkpoints: [],
      handoffs: [],
      events: []
    });
  }
}

function readState() {
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

function writeState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getHealth() {
  const state = readState();
  return {
    status: "ok",
    service: "hybrid-orchestrator",
    counts: {
      tasks: state.tasks.length,
      executions: state.executions.length,
      checkpoints: state.checkpoints.length,
      handoffs: state.handoffs.length
    },
    storage: {
      stateFile: STATE_FILE
    }
  };
}

async function getRuntimeServices() {
  const checks = await Promise.all(RUNTIME_SERVICES.map((service) => buildRuntimeServiceView(service)));
  return checks;
}

function buildRuntimeSummary(services) {
  return {
    up: services.filter((service) => service.status === "up").length,
    down: services.filter((service) => service.status === "down").length,
    authRequired: services.filter((service) => service.status === "auth_required").length,
    unconfigured: services.filter((service) => service.status === "unconfigured").length
  };
}

async function probeRuntimeService(service) {
  return probeRuntimeServiceWithOverrides(service, {});
}

async function buildRuntimeServiceView(service) {
  if (service.key === "orchestrator") {
    return buildOrchestratorRuntimeView(service);
  }

  if (service.key === "local-openclaw") {
    return buildLocalOpenClawRuntimeView(service);
  }

  if (service.key === "cloud-openclaw") {
    return buildCloudOpenClawRuntimeView(service);
  }

  return probeRuntimeServiceWithOverrides(service, {});
}

async function probeRuntimeServiceWithOverrides(service, overrides) {
  const checkedAt = new Date().toISOString();
  const baseUrl = overrides.baseUrl === undefined ? service.baseUrl : overrides.baseUrl;
  const token = overrides.token === undefined
    ? getRuntimeTokenForService(service)
    : overrides.token;

  if (!baseUrl) {
    return {
      ...baseRuntimeView(service, checkedAt),
      baseUrl,
      status: "unconfigured",
      statusLabel: "Unconfigured",
      detail: "No base URL is configured for this runtime.",
      hint: service.hint,
      probeTarget: null
    };
  }

  if (service.probe === "health") {
    return {
      ...baseRuntimeView(service, checkedAt),
      baseUrl,
      status: "up",
      statusLabel: "Running",
      detail: "The control-plane service is serving health checks and UI traffic.",
      hint: service.hint,
      probeTarget: `${baseUrl}/health`
    };
  }

  const probeTarget = `${baseUrl}/v1/models`;
  try {
    const response = await fetch(probeTarget, {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(3000)
    });

    if (response.status === 401 || response.status === 403) {
      return {
        ...baseRuntimeView(service, checkedAt),
        baseUrl,
        status: "auth_required",
        statusLabel: "Auth required",
        detail: "The runtime is reachable but refused the health probe without a valid bearer token.",
        hint: service.hint,
        probeTarget
      };
    }

    if (!response.ok) {
      return {
        ...baseRuntimeView(service, checkedAt),
        baseUrl,
        status: "down",
        statusLabel: "Unavailable",
        detail: `Probe returned HTTP ${response.status}.`,
        hint: service.hint,
        probeTarget
      };
    }

    const payload = await response.json().catch(() => ({}));
    const modelCount = Array.isArray(payload?.data) ? payload.data.length : null;
    return {
      ...baseRuntimeView(service, checkedAt),
      baseUrl,
      status: "up",
      statusLabel: "Running",
      detail: modelCount === null
        ? "The runtime responded successfully to the model probe."
        : `The runtime responded successfully and exposed ${modelCount} model(s).`,
      hint: service.hint,
      probeTarget
    };
  }
  catch (error) {
    return {
      ...baseRuntimeView(service, checkedAt),
      baseUrl,
      status: "down",
      statusLabel: "Unavailable",
      detail: error?.name === "TimeoutError"
        ? "The probe timed out before the runtime responded."
        : "The probe could not reach the configured runtime endpoint.",
      hint: service.hint,
      probeTarget
    };
  }
}

function baseRuntimeView(service, checkedAt) {
  return {
    key: service.key,
    name: service.name,
    kind: service.kind,
    deployment: service.deployment,
    baseUrl: service.baseUrl,
    checkedAt,
    controlState: "unknown",
    controlStateLabel: "Unknown",
    controlDetail: "Runtime ownership has not been inspected yet.",
    configurationWarnings: [],
    availableActions: []
  };
}

function buildOrchestratorRuntimeView(service) {
  const checkedAt = new Date().toISOString();
  return {
    ...baseRuntimeView(service, checkedAt),
    status: "up",
    statusLabel: "Running",
    detail: "The control plane is online and serving the dashboard, API, and orchestration state.",
    hint: service.hint,
    probeTarget: `${service.baseUrl}/health`,
    controlState: "running",
    controlStateLabel: "Hosted here",
    controlDetail: `PID ${process.pid} · uptime ${formatDuration(process.uptime())}`
  };
}

async function buildLocalOpenClawRuntimeView(service) {
  const checkedAt = new Date().toISOString();
  const composeState = await inspectLocalOpenClaw();
  const configurationWarnings = getLocalOpenClawWarnings();
  const probe = await probeRuntimeServiceWithOverrides(service, { baseUrl: service.baseUrl });
  const availableActions = [];

  if (composeState.commandMissing) {
    availableActions.push(createRuntimeAction("start", "Start local", "primary", "Install Docker Desktop or make the docker CLI available on PATH."));
  }
  else if (composeState.running) {
    availableActions.push(createRuntimeAction("stop", "Stop local", "ghost"));
  }
  else {
    availableActions.push(createRuntimeAction("start", existsSync(LOCAL_OPENCLAW_ENV_FILE) ? "Start local" : "Seed .env and start", "primary"));
  }

  if (composeState.running && probe.status === "up") {
    return {
      ...probe,
      checkedAt,
      hint: `${service.hint} ${configurationWarnings.length ? `Config note: ${configurationWarnings[0]}` : ""}`.trim(),
      controlState: "running",
      controlStateLabel: "Compose active",
      controlDetail: composeState.detail,
      configurationWarnings,
      availableActions
    };
  }

  if (composeState.running) {
    return {
      ...probe,
      checkedAt,
      status: probe.status,
      statusLabel: probe.statusLabel,
      detail: `Docker reports the local stack as running, but the gateway probe is not healthy yet. ${probe.detail}`,
      hint: `${service.hint} ${configurationWarnings.length ? `Config note: ${configurationWarnings[0]}` : ""}`.trim(),
      controlState: "running",
      controlStateLabel: "Compose active",
      controlDetail: composeState.detail,
      configurationWarnings,
      availableActions
    };
  }

  if (composeState.commandMissing) {
    return {
      ...baseRuntimeView(service, checkedAt),
      status: "down",
      statusLabel: "Docker unavailable",
      detail: "The dashboard could not find the docker CLI, so it cannot inspect or start the local runtime.",
      hint: service.hint,
      probeTarget: probe.probeTarget,
      controlState: "blocked",
      controlStateLabel: "CLI missing",
      controlDetail: composeState.detail,
      configurationWarnings,
      availableActions
    };
  }

  return {
    ...baseRuntimeView(service, checkedAt),
    baseUrl: service.baseUrl,
    status: "down",
    statusLabel: "Stopped",
    detail: "The local Compose stack is not running. Start it from the dashboard to attach the local runtime.",
    hint: `${service.hint} ${configurationWarnings.length ? `Config note: ${configurationWarnings[0]}` : ""}`.trim(),
    probeTarget: probe.probeTarget,
    controlState: "stopped",
    controlStateLabel: "Compose stopped",
    controlDetail: composeState.detail,
    configurationWarnings,
    availableActions
  };
}

async function buildCloudOpenClawRuntimeView(service) {
  const checkedAt = new Date().toISOString();
  const deploymentConfig = getCloudOpenClawDeploymentConfig();
  const acaState = await inspectCloudOpenClawDeployment(deploymentConfig);
  const baseUrl = service.baseUrl || acaState.baseUrl || null;
  const probe = await probeRuntimeServiceWithOverrides(service, { baseUrl });
  const configurationWarnings = [...deploymentConfig.missing.map((name) => `Missing ${name}.`)];
  const deployActionReason = deploymentConfig.missing.length > 0
    ? `Set ${deploymentConfig.missing.join(", ")} before deploying from the dashboard.`
    : acaState.commandMissing
      ? "Install Azure CLI and sign in with az login to deploy from the dashboard."
      : null;

  const availableActions = [
    createRuntimeAction(acaState.exists ? "deploy" : "deploy", acaState.exists ? "Redeploy cloud" : "Deploy cloud", "primary", deployActionReason)
  ];

  if (!baseUrl && deploymentConfig.missing.length > 0 && !acaState.exists) {
    return {
      ...baseRuntimeView(service, checkedAt),
      baseUrl,
      status: "unconfigured",
      statusLabel: "Needs config",
      detail: "The cloud runtime is not configured yet. Provide the ACA deployment variables so the dashboard can deploy it.",
      hint: service.hint,
      probeTarget: null,
      controlState: "unconfigured",
      controlStateLabel: "Deploy inputs missing",
      controlDetail: `Required: ${deploymentConfig.missing.join(", ")}`,
      configurationWarnings,
      availableActions
    };
  }

  if (acaState.exists) {
    return {
      ...probe,
      checkedAt,
      baseUrl,
      detail: probe.status === "up"
        ? probe.detail
        : `${acaState.detail} ${probe.detail}`.trim(),
      hint: acaState.commandMissing ? `${service.hint} Azure CLI is not available for deployment actions.` : service.hint,
      controlState: acaState.running ? "running" : "provisioned",
      controlStateLabel: acaState.running ? "ACA ready" : "ACA provisioned",
      controlDetail: acaState.detail,
      configurationWarnings,
      availableActions
    };
  }

  if (acaState.commandMissing && baseUrl) {
    return {
      ...probe,
      checkedAt,
      baseUrl,
      hint: `${service.hint} Azure CLI is not available for deployment actions.`,
      controlState: "external",
      controlStateLabel: "Probe only",
      controlDetail: "The dashboard can probe the runtime URL, but az is not available to inspect or deploy the ACA app.",
      configurationWarnings,
      availableActions
    };
  }

  return {
    ...probe,
    checkedAt,
    baseUrl,
    status: baseUrl ? probe.status : "down",
    statusLabel: baseUrl ? probe.statusLabel : "Not deployed",
    detail: baseUrl ? probe.detail : "The configured ACA app was not found yet. Deploy it from the dashboard to activate the cloud runtime.",
    hint: service.hint,
    controlState: "stopped",
    controlStateLabel: acaState.commandMissing ? "CLI missing" : "Not deployed",
    controlDetail: acaState.detail,
    configurationWarnings,
    availableActions
  };
}

async function invokeRuntimeAction(serviceKey, actionId) {
  if (serviceKey === "local-openclaw" && actionId === "start") {
    return startLocalOpenClaw();
  }

  if (serviceKey === "local-openclaw" && actionId === "stop") {
    return stopLocalOpenClaw();
  }

  if (serviceKey === "cloud-openclaw" && actionId === "deploy") {
    return deployCloudOpenClaw();
  }

  throw httpError(400, "runtime_action_not_supported", `Unsupported runtime action '${actionId}' for '${serviceKey}'.`);
}

async function startLocalOpenClaw() {
  const result = await runPowerShell(["-File", LOCAL_OPENCLAW_START_SCRIPT], { cwd: ROOT_DIR });
  return {
    serviceKey: "local-openclaw",
    actionId: "start",
    message: "Local OpenClaw start script completed.",
    output: summarizeCommandOutput(result)
  };
}

async function stopLocalOpenClaw() {
  const result = await runPowerShell(["-File", LOCAL_OPENCLAW_STOP_SCRIPT], { cwd: ROOT_DIR });
  return {
    serviceKey: "local-openclaw",
    actionId: "stop",
    message: "Local OpenClaw stopped.",
    output: summarizeCommandOutput(result)
  };
}

async function deployCloudOpenClaw() {
  const config = getCloudOpenClawDeploymentConfig();
  if (config.missing.length > 0) {
    throw httpError(400, "cloud_runtime_not_configured", `Set ${config.missing.join(", ")} before deploying the cloud runtime.`);
  }

  const scriptPath = config.skipBuild ? CLOUD_OPENCLAW_DEPLOY_SCRIPT : CLOUD_OPENCLAW_RUN_SCRIPT;
  const args = [
    "-File",
    scriptPath,
    "-ResourceGroup",
    config.resourceGroup,
    "-Location",
    config.location,
    "-AcrName",
    config.acrName,
    "-ManagedEnvironmentName",
    config.managedEnvironmentName,
    "-ContainerAppName",
    config.containerAppName,
    "-StorageAccountName",
    config.storageAccountName,
    "-FileShareName",
    config.fileShareName,
    "-UserAssignedIdentityName",
    config.userAssignedIdentityName,
    "-GatewayToken",
    config.gatewayToken,
    "-OpenAiApiKey",
    config.openAiApiKey,
    "-ImageRepository",
    config.imageRepository
  ];

  if (config.imageTag) {
    args.push("-ImageTag", config.imageTag);
  }

  if (!config.skipBuild && config.sourceContext) {
    args.push("-SourceContext", config.sourceContext);
  }

  if (!config.skipBuild && config.dockerfile) {
    args.push("-Dockerfile", config.dockerfile);
  }

  if (!config.skipBuild && config.useLocalContext) {
    args.push("-UseLocalContext");
    if (config.localContextPath) {
      args.push("-LocalContextPath", config.localContextPath);
    }
  }

  if (existsSync(CLOUD_OPENCLAW_ENV_FILE)) {
    args.push("-EnvFile", CLOUD_OPENCLAW_ENV_FILE);
  }

  const result = await runPowerShell(args, { cwd: ROOT_DIR });
  const deployedUrl = result.stdout.match(/Control UI \/ Gateway URL:\s+(https?:\/\/\S+)/i)?.[1] || null;

  return {
    serviceKey: "cloud-openclaw",
    actionId: "deploy",
    message: deployedUrl
      ? `Cloud OpenClaw deployed or updated at ${deployedUrl}.`
      : "Cloud OpenClaw deployment finished.",
    output: summarizeCommandOutput(result)
  };
}

async function inspectLocalOpenClaw() {
  const result = await runCommand("docker", ["compose", "ps", "--all", "--format", "json"], {
    cwd: LOCAL_OPENCLAW_DIR,
    allowFailure: true
  });

  if (result.errorCode === "command_not_found") {
    return {
      commandMissing: true,
      running: false,
      detail: "docker compose is not available on PATH."
    };
  }

  const containers = parseComposePsOutput(result.stdout)
    .filter((entry) => [entry?.Service, entry?.Name].some((value) => String(value || "").includes("openclaw")));
  const runningContainers = containers.filter((entry) => /running/i.test(`${entry?.State || ""} ${entry?.Status || ""}`));

  if (runningContainers.length > 0) {
    const active = runningContainers[0];
    return {
      commandMissing: false,
      running: true,
      detail: `${active?.Name || active?.Service || "openclaw"} is ${active?.State || active?.Status || "running"}.`
    };
  }

  if (containers.length > 0) {
    return {
      commandMissing: false,
      running: false,
      detail: `${containers[0]?.Name || containers[0]?.Service || "openclaw"} is ${containers[0]?.State || containers[0]?.Status || "stopped"}.`
    };
  }

  return {
    commandMissing: false,
    running: false,
    detail: "No local Compose containers are running for the OpenClaw project."
  };
}

function getLocalOpenClawWarnings() {
  const warnings = [];

  if (!existsSync(LOCAL_OPENCLAW_ENV_FILE) && existsSync(LOCAL_OPENCLAW_ENV_EXAMPLE)) {
    warnings.push("No .env file exists yet; the dashboard will seed one from .env.example on first start.");
  }

  if (existsSync(LOCAL_OPENCLAW_ENV_FILE)) {
    const envText = readFileSync(LOCAL_OPENCLAW_ENV_FILE, "utf8");
    if (envText.includes("replace-with-a-long-random-token")) {
      warnings.push("OPENCLAW_GATEWAY_TOKEN is still using the example placeholder.");
    }
    if (envText.includes("replace-with-your-openai-api-key")) {
      warnings.push("OPENAI_API_KEY is still using the example placeholder.");
    }
  }

  return warnings;
}

function getCloudOpenClawDeploymentConfig() {
  const fileValues = readKeyValueFile(CLOUD_OPENCLAW_ENV_FILE);
  const skipBuild = parseBooleanString(resolveConfigValue("CLOUD_OPENCLAW_SKIP_BUILD", fileValues, "false"));
  const config = {
    resourceGroup: resolveConfigValue(CLOUD_DEPLOYMENT_ENV_VARS.resourceGroup, fileValues, fileValues.RESOURCE_GROUP || ""),
    location: resolveConfigValue(CLOUD_DEPLOYMENT_ENV_VARS.location, fileValues, fileValues.LOCATION || ""),
    managedEnvironmentName: resolveConfigValue(CLOUD_DEPLOYMENT_ENV_VARS.managedEnvironmentName, fileValues, fileValues.MANAGED_ENVIRONMENT_NAME || ""),
    containerAppName: resolveConfigValue(CLOUD_DEPLOYMENT_ENV_VARS.containerAppName, fileValues, fileValues.CONTAINER_APP_NAME || ""),
    storageAccountName: resolveConfigValue(CLOUD_DEPLOYMENT_ENV_VARS.storageAccountName, fileValues, fileValues.STORAGE_ACCOUNT_NAME || ""),
    fileShareName: resolveConfigValue(CLOUD_DEPLOYMENT_ENV_VARS.fileShareName, fileValues, fileValues.FILE_SHARE_NAME || ""),
    acrName: resolveConfigValue(CLOUD_DEPLOYMENT_ENV_VARS.acrName, fileValues, fileValues.ACR_NAME || ""),
    imageRepository: resolveConfigValue(CLOUD_DEPLOYMENT_ENV_VARS.imageRepository, fileValues, fileValues.IMAGE_REPOSITORY || "openclaw"),
    imageTag: resolveConfigValue(CLOUD_DEPLOYMENT_ENV_VARS.imageTag, fileValues, fileValues.IMAGE_TAG || ""),
    userAssignedIdentityName: resolveConfigValue(CLOUD_DEPLOYMENT_ENV_VARS.userAssignedIdentityName, fileValues, fileValues.USER_ASSIGNED_IDENTITY_NAME || ""),
    gatewayToken: resolveConfigValue(CLOUD_DEPLOYMENT_ENV_VARS.gatewayToken, fileValues, process.env.CLOUD_OPENCLAW_TOKEN || fileValues.GATEWAY_TOKEN || ""),
    openAiApiKey: resolveConfigValue(CLOUD_DEPLOYMENT_ENV_VARS.openAiApiKey, fileValues, process.env.OPENAI_API_KEY || fileValues.OPENAI_API_KEY || ""),
    baseUrl: resolveConfigValue(CLOUD_DEPLOYMENT_ENV_VARS.baseUrl, fileValues, process.env.CLOUD_OPENCLAW_URL || ""),
    sourceContext: resolveConfigValue("CLOUD_OPENCLAW_SOURCE_CONTEXT", fileValues, fileValues.SOURCE_CONTEXT || "https://github.com/openclaw/openclaw.git#main"),
    dockerfile: resolveConfigValue("CLOUD_OPENCLAW_DOCKERFILE", fileValues, fileValues.DOCKERFILE || "Dockerfile"),
    useLocalContext: parseBooleanString(resolveConfigValue("CLOUD_OPENCLAW_USE_LOCAL_CONTEXT", fileValues, fileValues.USE_LOCAL_CONTEXT || "false")),
    localContextPath: resolveConfigValue("CLOUD_OPENCLAW_LOCAL_CONTEXT_PATH", fileValues, fileValues.LOCAL_CONTEXT_PATH || ""),
    skipBuild
  };

  const required = [
    { name: CLOUD_DEPLOYMENT_ENV_VARS.resourceGroup, value: config.resourceGroup },
    { name: CLOUD_DEPLOYMENT_ENV_VARS.location, value: config.location },
    { name: CLOUD_DEPLOYMENT_ENV_VARS.managedEnvironmentName, value: config.managedEnvironmentName },
    { name: CLOUD_DEPLOYMENT_ENV_VARS.containerAppName, value: config.containerAppName },
    { name: CLOUD_DEPLOYMENT_ENV_VARS.storageAccountName, value: config.storageAccountName },
    { name: CLOUD_DEPLOYMENT_ENV_VARS.fileShareName, value: config.fileShareName },
    { name: CLOUD_DEPLOYMENT_ENV_VARS.acrName, value: config.acrName },
    { name: CLOUD_DEPLOYMENT_ENV_VARS.userAssignedIdentityName, value: config.userAssignedIdentityName },
    { name: CLOUD_DEPLOYMENT_ENV_VARS.gatewayToken, value: config.gatewayToken },
    { name: CLOUD_DEPLOYMENT_ENV_VARS.openAiApiKey, value: config.openAiApiKey }
  ];

  if (skipBuild) {
    required.push({ name: CLOUD_DEPLOYMENT_ENV_VARS.imageTag, value: config.imageTag });
  }

  const missing = required
    .filter((entry) => !String(entry.value || "").trim())
    .map((entry) => entry.name);

  return {
    ...config,
    missing
  };
}

async function inspectCloudOpenClawDeployment(config) {
  if (!config.resourceGroup || !config.containerAppName) {
    return {
      commandMissing: false,
      exists: false,
      running: false,
      baseUrl: config.baseUrl || null,
      detail: "Set CLOUD_OPENCLAW_RESOURCE_GROUP and CLOUD_OPENCLAW_CONTAINER_APP to inspect ACA deployment state."
    };
  }

  const result = await runCommand("az", [
    "containerapp",
    "show",
    "--name",
    config.containerAppName,
    "--resource-group",
    config.resourceGroup,
    "--query",
    "{fqdn:properties.configuration.ingress.fqdn,provisioningState:properties.provisioningState,runningStatus:properties.runningStatus,latestRevisionName:properties.latestRevisionName}",
    "--output",
    "json"
  ], { allowFailure: true });

  if (result.errorCode === "command_not_found") {
    return {
      commandMissing: true,
      exists: false,
      running: false,
      baseUrl: config.baseUrl || null,
      detail: "Azure CLI is not available on PATH."
    };
  }

  if (result.exitCode !== 0) {
    return {
      commandMissing: false,
      exists: false,
      running: false,
      baseUrl: config.baseUrl || null,
      detail: "The configured ACA app does not exist yet, or az could not read it."
    };
  }

  const payload = parseJsonObject(result.stdout);
  const runningStatus = String(payload?.runningStatus || payload?.provisioningState || "");
  const fqdn = payload?.fqdn || null;

  return {
    commandMissing: false,
    exists: true,
    running: /running|succeeded/i.test(runningStatus),
    baseUrl: config.baseUrl || (fqdn ? `https://${fqdn}` : null),
    detail: payload?.latestRevisionName
      ? `Revision ${payload.latestRevisionName} · ${payload?.provisioningState || payload?.runningStatus || "ready"}`
      : `ACA app found · ${payload?.provisioningState || payload?.runningStatus || "state unavailable"}`
  };
}

function createRuntimeAction(id, label, variant, disabledReason = null) {
  return {
    id,
    label,
    variant,
    disabled: Boolean(disabledReason),
    disabledReason
  };
}

function parseComposePsOutput(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    return parseJsonObject(trimmed) || [];
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseJsonObject(line))
    .filter(Boolean);
}

function getRuntimeTokenForService(service) {
  if (!service?.tokenEnv) {
    return null;
  }

  if (process.env[service.tokenEnv]) {
    return process.env[service.tokenEnv];
  }

  if (service.key === "local-openclaw") {
    const localValues = readKeyValueFile(LOCAL_OPENCLAW_ENV_FILE);
    return localValues.OPENCLAW_GATEWAY_TOKEN || null;
  }

  if (service.key === "cloud-openclaw") {
    const cloudValues = readKeyValueFile(CLOUD_OPENCLAW_ENV_FILE);
    return process.env.CLOUD_OPENCLAW_TOKEN || cloudValues.GATEWAY_TOKEN || null;
  }

  return null;
}

function readKeyValueFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return {};
  }

  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((values, line) => {
      const trimmed = String(line || "").trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return values;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) {
        return values;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      values[key] = value;
      return values;
    }, {});
}

function resolveConfigValue(primaryEnvName, fileValues, fallback = "") {
  if (process.env[primaryEnvName]) {
    return process.env[primaryEnvName];
  }

  if (Object.prototype.hasOwnProperty.call(fileValues, primaryEnvName) && fileValues[primaryEnvName]) {
    return fileValues[primaryEnvName];
  }

  return fallback;
}

function parseBooleanString(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function parseJsonObject(text) {
  try {
    return JSON.parse(text);
  }
  catch {
    return null;
  }
}

async function runPowerShell(args, options = {}) {
  const pwshResult = await runCommand("pwsh", args, {
    ...options,
    allowFailure: true
  });

  if (pwshResult.errorCode !== "command_not_found") {
    if (pwshResult.exitCode !== 0) {
      throw httpError(500, "powershell_command_failed", formatCommandFailure("pwsh", args, pwshResult));
    }
    return pwshResult;
  }

  const windowsPowerShellResult = await runCommand("powershell", args, {
    ...options,
    allowFailure: true
  });

  if (windowsPowerShellResult.errorCode === "command_not_found") {
    throw httpError(500, "powershell_not_found", "Neither pwsh nor powershell is available on PATH.");
  }

  if (windowsPowerShellResult.exitCode !== 0) {
    throw httpError(500, "powershell_command_failed", formatCommandFailure("powershell", args, windowsPowerShellResult));
  }

  return windowsPowerShellResult;
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT_DIR,
      env: { ...process.env, ...(options.env || {}) },
      shell: false,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      if (options.allowFailure && error?.code === "ENOENT") {
        resolve({ exitCode: null, stdout: stdout.trim(), stderr: stderr.trim(), errorCode: "command_not_found" });
        return;
      }

      if (error?.code === "ENOENT") {
        reject(httpError(500, "command_not_found", `${command} is not available on PATH.`));
        return;
      }

      reject(httpError(500, "command_spawn_failed", error.message || `Failed to spawn ${command}.`));
    });

    child.on("close", (exitCode) => {
      const result = {
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      };

      if (exitCode === 0 || options.allowFailure) {
        resolve(result);
        return;
      }

      reject(httpError(500, "command_failed", formatCommandFailure(command, args, result)));
    });
  });
}

function formatCommandFailure(command, args, result) {
  const summary = summarizeCommandOutput(result);
  return `${command} ${args.join(" ")} exited with code ${result.exitCode ?? "unknown"}.${summary ? ` ${summary}` : ""}`;
}

function summarizeCommandOutput(result) {
  const combined = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!combined) {
    return "";
  }

  return combined
    .split(/\r?\n/)
    .slice(-6)
    .join(" | ");
}

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainder}s`;
  }

  return `${remainder}s`;
}

function createTask(body) {
  if (!body?.title || !body?.goal) {
    throw httpError(400, "invalid_task_payload", "Task title and goal are required.");
  }

  const now = new Date().toISOString();
  const task = {
    id: nextId("task"),
    title: body.title,
    goal: body.goal,
    requestedBy: body.requestedBy || "operator",
    metadata: body.metadata || {},
    createdAt: now,
    updatedAt: now
  };

  const state = readState();
  state.tasks.push(task);
  writeState(state);

  return task;
}

function createExecution(body) {
  if (!body?.taskId) {
    throw httpError(400, "invalid_execution_payload", "taskId is required.");
  }

  const task = findTask(body.taskId);
  const sourceRuntime = body.sourceRuntime || "local";
  assertRuntime(sourceRuntime, "sourceRuntime");
  const now = new Date().toISOString();
  const steps = normalizePlan(body.plan || []);
  const firstActiveStep = steps.find((step) => step.status === "running") || steps.find((step) => step.status === "queued");

  const execution = {
    id: nextId("exec"),
    taskId: task.id,
    status: sourceRuntime === "cloud" ? "running_cloud" : "running_local",
    owner: sourceRuntime,
    currentRuntime: sourceRuntime,
    targetRuntime: null,
    leaseExpiresAt: minutesFromNow(15),
    currentCheckpointId: null,
    resumeFromCheckpointId: null,
    pendingHandoffId: null,
    progress: body.progress || 0,
    currentStepId: firstActiveStep?.id || null,
    summary: body.summary || "",
    artifactRefs: body.artifactRefs || [],
    planVersion: 1,
    plan: steps,
    createdAt: now,
    updatedAt: now,
    lastHeartbeatAt: now
  };

  const state = readState();
  state.executions.push(execution);
  state.events.push(buildEvent(execution.id, "execution.created", "Execution created", `${sourceRuntime} runtime claimed the execution lease.`, { owner: sourceRuntime }));
  writeState(state);

  return enrichExecution(execution);
}

function createCheckpoint(executionId, body) {
  const note = body?.note || "Manual checkpoint created.";
  const runtime = body?.runtime || findExecution(executionId).owner || "none";
  const execution = findExecution(executionId);
  const task = findTask(execution.taskId);
  const state = readState();
  const now = new Date().toISOString();

  const checkpoint = {
    id: nextId("cp"),
    executionId,
    taskId: task.id,
    runtime,
    note,
    status: "stable",
    snapshot: {
      executionId: execution.id,
      taskId: execution.taskId,
      taskTitle: task.title,
      currentRuntime: execution.currentRuntime,
      owner: execution.owner,
      status: execution.status,
      currentStepId: execution.currentStepId,
      progress: execution.progress,
      summary: execution.summary,
      artifactRefs: execution.artifactRefs,
      planVersion: execution.planVersion,
      plan: execution.plan,
      leaseExpiresAt: execution.leaseExpiresAt,
      lastHeartbeatAt: execution.lastHeartbeatAt
    },
    createdAt: now
  };

  mutateExecution(state, executionId, (draft) => {
    draft.currentCheckpointId = checkpoint.id;
    draft.updatedAt = now;
  });

  state.checkpoints.push(checkpoint);
  state.events.push(buildEvent(executionId, "checkpoint.created", "Checkpoint created", note, { checkpointId: checkpoint.id, runtime }));
  writeState(state);

  return checkpoint;
}

function createHandoff(executionId, body) {
  if (!body?.targetRuntime) {
    throw httpError(400, "invalid_handoff_payload", "targetRuntime is required.");
  }

  const sourceRuntime = body.sourceRuntime || "local";
  const targetRuntime = body.targetRuntime;
  assertRuntime(sourceRuntime, "sourceRuntime");
  assertRuntime(targetRuntime, "targetRuntime");

  if (sourceRuntime === targetRuntime) {
    throw httpError(400, "invalid_handoff_payload", "sourceRuntime and targetRuntime must be different.");
  }

  const state = readState();
  const execution = findExecution(executionId, state);
  if (execution.owner !== sourceRuntime) {
    throw httpError(409, "lease_conflict", `Execution is currently owned by ${execution.owner}, not ${sourceRuntime}.`);
  }

  let checkpointId = body.checkpointId || execution.currentCheckpointId;
  if (!checkpointId || body.createCheckpoint !== false) {
    checkpointId = createCheckpoint(executionId, {
      note: body.checkpointNote || `Automatic checkpoint before handoff to ${targetRuntime}.`,
      runtime: sourceRuntime
    }).id;
  }

  const refreshedState = readState();
  const refreshedExecution = findExecution(executionId, refreshedState);
  const task = findTask(refreshedExecution.taskId, refreshedState);
  const checkpoint = findCheckpoint(checkpointId, refreshedState);
  const now = new Date().toISOString();

  const handoff = {
    id: nextId("handoff"),
    executionId,
    taskId: task.id,
    sourceRuntime,
    targetRuntime,
    checkpointId,
    reason: body.reason || "Operator requested runtime transfer.",
    status: "pending_resume",
    package: {
      task: {
        id: task.id,
        title: task.title,
        goal: task.goal
      },
      execution: {
        id: refreshedExecution.id,
        status: refreshedExecution.status,
        owner: refreshedExecution.owner,
        currentRuntime: refreshedExecution.currentRuntime,
        currentStepId: refreshedExecution.currentStepId,
        progress: refreshedExecution.progress,
        planVersion: refreshedExecution.planVersion,
        summary: refreshedExecution.summary
      },
      checkpoint: {
        id: checkpoint.id,
        createdAt: checkpoint.createdAt,
        snapshot: checkpoint.snapshot
      },
      artifactRefs: refreshedExecution.artifactRefs,
      environmentRequirements: body.environmentRequirements || [],
      toolCapabilityRequirements: body.toolCapabilityRequirements || [],
      operatorNotes: body.operatorNotes || ""
    },
    createdAt: now,
    updatedAt: now
  };

  mutateExecution(refreshedState, executionId, (draft) => {
    draft.status = "handoff_pending";
    draft.owner = "none";
    draft.targetRuntime = targetRuntime;
    draft.pendingHandoffId = handoff.id;
    draft.resumeFromCheckpointId = checkpointId;
    draft.leaseExpiresAt = null;
    draft.updatedAt = now;
  });

  refreshedState.handoffs.push(handoff);
  refreshedState.events.push(buildEvent(executionId, "handoff.created", "Handoff package created", `Execution prepared for ${targetRuntime} takeover.`, {
    handoffId: handoff.id,
    checkpointId,
    sourceRuntime,
    targetRuntime
  }));
  writeState(refreshedState);

  return handoff;
}

function resumeExecution(executionId, body) {
  const runtime = body?.runtime;
  assertRuntime(runtime, "runtime");

  const state = readState();
  const execution = findExecution(executionId, state);
  const now = new Date().toISOString();
  let checkpointId = body.checkpointId || execution.resumeFromCheckpointId || execution.currentCheckpointId;

  if (!checkpointId) {
    throw httpError(400, "resume_requires_checkpoint", "No checkpoint is available to resume from.");
  }

  if (body.handoffId) {
    const handoff = findHandoff(body.handoffId, state);
    if (handoff.executionId !== executionId) {
      throw httpError(400, "invalid_handoff", "handoffId does not belong to this execution.");
    }
    if (handoff.targetRuntime !== runtime) {
      throw httpError(409, "handoff_target_mismatch", `Handoff target is ${handoff.targetRuntime}, not ${runtime}.`);
    }

    checkpointId = handoff.checkpointId;
    handoff.status = "resumed";
    handoff.updatedAt = now;
    handoff.resumedAt = now;
  }

  const checkpoint = findCheckpoint(checkpointId, state);
  mutateExecution(state, executionId, (draft) => {
    draft.owner = runtime;
    draft.currentRuntime = runtime;
    draft.targetRuntime = null;
    draft.status = runtime === "cloud" ? "running_cloud" : "running_local";
    draft.currentCheckpointId = checkpoint.id;
    draft.resumeFromCheckpointId = checkpoint.id;
    draft.pendingHandoffId = null;
    draft.progress = checkpoint.snapshot.progress;
    draft.currentStepId = checkpoint.snapshot.currentStepId;
    draft.summary = checkpoint.snapshot.summary;
    draft.artifactRefs = checkpoint.snapshot.artifactRefs;
    draft.planVersion = checkpoint.snapshot.planVersion;
    draft.plan = checkpoint.snapshot.plan;
    draft.lastHeartbeatAt = now;
    draft.leaseExpiresAt = minutesFromNow(15);
    draft.updatedAt = now;
  });

  state.events.push(buildEvent(executionId, "execution.resumed", "Execution resumed", `${runtime} runtime claimed the execution and resumed from ${checkpoint.id}.`, {
    runtime,
    checkpointId: checkpoint.id
  }));
  writeState(state);

  return enrichExecution(findExecution(executionId));
}

function updateStep(executionId, stepId, body) {
  const state = readState();
  const execution = findExecution(executionId, state);
  const now = new Date().toISOString();
  const step = execution.plan.find((candidate) => candidate.id === stepId);
  if (!step) {
    throw httpError(404, "step_not_found", `Step '${stepId}' was not found on execution ${executionId}.`);
  }

  if (body?.status) {
    assertStepStatus(body.status);
    step.status = body.status;
  }

  if (body?.summary !== undefined) {
    step.summary = body.summary;
  }

  if (body?.sideEffectClass !== undefined) {
    step.sideEffectClass = body.sideEffectClass;
  }

  if (typeof body?.progress === "number") {
    execution.progress = clamp(body.progress, 0, 100);
  }

  if (body?.status === "running" || body?.status === "blocked") {
    execution.currentStepId = step.id;
  }

  execution.updatedAt = now;
  state.events.push(buildEvent(executionId, "step.updated", "Step updated", `${step.title} marked as ${step.status}.`, {
    stepId,
    status: step.status
  }));
  writeState(state);

  return enrichExecution(execution);
}

function recordHeartbeat(executionId, body) {
  const state = readState();
  const execution = findExecution(executionId, state);
  const now = new Date().toISOString();

  execution.lastHeartbeatAt = now;
  execution.updatedAt = now;

  if (body?.summary) {
    execution.summary = body.summary;
  }

  if (Array.isArray(body?.artifactRefs)) {
    execution.artifactRefs = body.artifactRefs;
  }

  if (typeof body?.progress === "number") {
    execution.progress = clamp(body.progress, 0, 100);
  }

  state.events.push(buildEvent(executionId, "heartbeat.recorded", "Heartbeat recorded", body?.message || "Runtime heartbeat received.", {
    runtime: body?.runtime || execution.owner || "unknown"
  }));
  writeState(state);

  return enrichExecution(execution);
}

function findTask(taskId, state = readState()) {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    throw httpError(404, "task_not_found", `Task '${taskId}' was not found.`);
  }
  return task;
}

function findExecution(executionId, state = readState()) {
  const execution = state.executions.find((candidate) => candidate.id === executionId);
  if (!execution) {
    throw httpError(404, "execution_not_found", `Execution '${executionId}' was not found.`);
  }
  return execution;
}

function findCheckpoint(checkpointId, state = readState()) {
  const checkpoint = state.checkpoints.find((candidate) => candidate.id === checkpointId);
  if (!checkpoint) {
    throw httpError(404, "checkpoint_not_found", `Checkpoint '${checkpointId}' was not found.`);
  }
  return checkpoint;
}

function findHandoff(handoffId, state = readState()) {
  const handoff = state.handoffs.find((candidate) => candidate.id === handoffId);
  if (!handoff) {
    throw httpError(404, "handoff_not_found", `Handoff '${handoffId}' was not found.`);
  }
  return handoff;
}

function mutateExecution(state, executionId, mutate) {
  const execution = findExecution(executionId, state);
  mutate(execution);
}

function enrichExecution(execution) {
  const state = readState();
  const checkpoints = state.checkpoints.filter((candidate) => candidate.executionId === execution.id);
  const handoffs = state.handoffs.filter((candidate) => candidate.executionId === execution.id);
  const events = state.events.filter((candidate) => candidate.executionId === execution.id).slice(-10);

  return {
    ...execution,
    checkpoints,
    handoffs,
    recentEvents: events
  };
}

function normalizePlan(plan) {
  if (!Array.isArray(plan) || plan.length === 0) {
    return [
      {
        id: nextId("step"),
        title: "Initial execution step",
        status: "running",
        summary: "No explicit plan was provided, so the orchestrator created a placeholder step.",
        sideEffectClass: "pure_read"
      }
    ];
  }

  return plan.map((step, index) => {
    const status = step.status || (index === 0 ? "running" : "queued");
    assertStepStatus(status);
    return {
      id: step.id || nextId("step"),
      title: step.title || `Step ${index + 1}`,
      status,
      summary: step.summary || "",
      sideEffectClass: step.sideEffectClass || "pure_read"
    };
  });
}

function buildEvent(executionId, type, title, detail, metadata = {}) {
  return {
    id: nextId("evt"),
    executionId,
    type,
    title,
    detail,
    metadata,
    createdAt: new Date().toISOString()
  };
}

function assertRuntime(value, label) {
  if (!["local", "cloud"].includes(value)) {
    throw httpError(400, "invalid_runtime", `${label} must be 'local' or 'cloud'.`);
  }
}

function assertStepStatus(value) {
  if (!["queued", "running", "done", "blocked"].includes(value)) {
    throw httpError(400, "invalid_step_status", "Step status must be queued, running, done, or blocked.");
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk.toString();
      if (raw.length > 1_000_000) {
        reject(httpError(413, "payload_too_large", "Request body is too large."));
      }
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      }
      catch {
        reject(httpError(400, "invalid_json", "Request body must be valid JSON."));
      }
    });

    req.on("error", () => reject(httpError(400, "request_stream_error", "Failed to read request body.")));
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendStaticFile(res, filePath) {
  if (!existsSync(filePath)) {
    throw httpError(404, "asset_not_found", `Static asset was not found: ${filePath}`);
  }

  const stats = statSync(filePath);
  if (!stats.isFile()) {
    throw httpError(404, "asset_not_found", `Static asset was not found: ${filePath}`);
  }

  const extension = path.extname(filePath).toLowerCase();
  const mimeType = getMimeType(extension);
  const contents = readFileSync(filePath);

  res.writeHead(200, {
    "Content-Type": mimeType,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(contents);
}

function sendNoContent(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end();
}

function nextId(prefix) {
  const random = Math.random().toString(36).slice(2, 8);
  const stamp = Date.now().toString(36);
  return `${prefix}_${stamp}_${random}`;
}

function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function getMimeType(extension) {
  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".js") {
    return "text/javascript; charset=utf-8";
  }
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  return "application/octet-stream";
}
