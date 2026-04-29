# Hybrid Orchestrator MVP

This is a zero-dependency Node.js service that implements the minimum API needed to validate:

- task creation
- execution creation
- checkpoint creation
- handoff packaging
- runtime resume on the target side
- event timeline inspection

## Run

```powershell
cd "C:\Users\xueba\Documents\New project 2\services\orchestrator"
node server.js
```

The service listens on `http://127.0.0.1:4040`.

Once the server is running, open:

`http://127.0.0.1:4040/`

The same service now hosts:

- the dashboard UI at `/`
- the JavaScript bundle at `/app.js`
- the stylesheet at `/styles.css`
- the orchestrator API on the same origin

## State Storage

Runtime state is stored in:

`services/orchestrator/data/orchestrator-state.json`

That file is created automatically at first boot.

## Core Endpoints

- `GET /health`
- `GET /runtime-services`
- `POST /runtime-services/{serviceKey}/actions/{actionId}`
- `GET /tasks`
- `POST /tasks`
- `GET /executions`
- `POST /executions`
- `GET /executions/{id}`
- `GET /executions/{id}/events`
- `GET /executions/{id}/checkpoints`
- `POST /executions/{id}/checkpoint`
- `POST /executions/{id}/handoff`
- `POST /executions/{id}/resume`
- `POST /executions/{id}/steps/{stepId}`
- `POST /executions/{id}/heartbeat`

## Runtime Control Center

The dashboard now treats `Runtime Control Center` as a live control surface instead of a probe-only panel.

- `orchestrator` reports the current Node process PID and uptime.
- `local-openclaw` now delegates to `deploy/openclaw/local/start.ps1` and `stop.ps1`, so the same validation and env-file seeding path is used both in the terminal and in the dashboard.
- `cloud-openclaw` can inspect or deploy the ACA runtime from a shared `deploy/openclaw/.env.cloud` file. By default the dashboard uses `deploy/openclaw/run-poc.ps1` so a missing image can be built before ACA is updated.

### Optional environment variables for cloud control

Set these before starting `node server.js` if you want the dashboard to deploy or redeploy the ACA runtime:

- `CLOUD_OPENCLAW_RESOURCE_GROUP`
- `CLOUD_OPENCLAW_LOCATION`
- `CLOUD_OPENCLAW_MANAGED_ENVIRONMENT`
- `CLOUD_OPENCLAW_CONTAINER_APP`
- `CLOUD_OPENCLAW_STORAGE_ACCOUNT`
- `CLOUD_OPENCLAW_FILE_SHARE`
- `CLOUD_OPENCLAW_ACR_NAME`
- `CLOUD_OPENCLAW_IMAGE_REPOSITORY` (optional, defaults to `openclaw`)
- `CLOUD_OPENCLAW_IMAGE_TAG`
- `CLOUD_OPENCLAW_IDENTITY_NAME`
- `CLOUD_OPENCLAW_GATEWAY_TOKEN`
- `CLOUD_OPENCLAW_OPENAI_API_KEY` or `OPENAI_API_KEY`
- `CLOUD_OPENCLAW_URL` if you want to probe an existing cloud runtime URL directly
- `CLOUD_OPENCLAW_SKIP_BUILD=true` if you want the dashboard to call `deploy/openclaw/aca/deploy.ps1` directly instead of the build+deploy wrapper

You can also store the same values in:

`deploy/openclaw/.env.cloud`

Start from:

`deploy/openclaw/.env.cloud.example`

If Azure CLI is not installed or the required variables are missing, the UI still renders the cloud card, but it will show the missing prerequisites instead of exposing a live deploy action.

If the ACA Control UI connects with a valid token but stops at `device pairing required`, approve the browser request from the running container:

```powershell
pwsh -File "C:\Users\xueba\Documents\New project 2\deploy\openclaw\aca\approve-device.ps1" `
  -RequestId "<requestId>"
```

## Demo Flow

Use the helper script:

```powershell
pwsh -File "C:\Users\xueba\Documents\New project 2\scripts\demo-orchestrator.ps1"
```

It creates a task, starts a local execution, completes a step, creates a checkpoint, hands the execution to cloud, resumes it in cloud, and prints the resulting execution snapshot.
