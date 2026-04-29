# OpenClaw Local + ACA MVP

## Goal

Stand up the smallest real deployment that proves:

- a local OpenClaw runtime can run in Docker on the developer machine
- a cloud OpenClaw runtime can run in Azure Container Apps (ACA)
- both runtimes expose the same Gateway surface
- both runtimes can be reached and validated through the OpenAI-compatible `GET /v1/models` endpoint

This is a **runtime validation** milestone.

It does **not** yet implement full task handoff orchestration, checkpoint transfer, or ownership leases.

## Why ACA Changes the Design

The cloud target is now ACA instead of a VM.

That is good for:

- managed container hosting
- HTTPS ingress
- secrets
- Azure Files persistence
- simpler ops than managing a Linux VM

But it changes one important thing:

- the OpenClaw Docker sandbox backend is not a good fit for ACA

So the MVP split is:

- local runtime: Docker sandbox enabled
- ACA runtime: sandbox disabled

Later, if we want cloud isolation inside ACA, the next path should be OpenClaw's `ssh` or `openshell` sandbox backend instead of the local Docker backend.

## Repository Layout

```text
docs/openclaw-local-aca-poc.md
openclaw/config/openclaw.local.json5
openclaw/config/openclaw.cloud.aca.json5
deploy/openclaw/local/.env.example
deploy/openclaw/local/start.ps1
deploy/openclaw/local/stop.ps1
deploy/openclaw/.env.cloud.example
deploy/openclaw/local/docker-compose.yml
deploy/openclaw/acr/.env.example
deploy/openclaw/acr/build-image.ps1
deploy/openclaw/aca/containerapp.template.yaml
deploy/openclaw/aca/deploy.ps1
deploy/openclaw/run-poc.ps1
scripts/validate-openclaw.ps1
```

## Local Runtime

### What it does

- runs OpenClaw in Docker Compose
- persists state under `deploy/openclaw/local/state`
- mounts the Docker socket so the Docker sandbox backend can work
- enables the OpenAI-compatible Responses surface

### Start it

```powershell
cd "C:\Users\xueba\Documents\New project 2\deploy\openclaw\local"
Copy-Item .env.example .env
docker compose up -d
```

更稳妥的方式是直接使用仓库里的启动脚本，它会自动补齐 `.env`、创建持久化目录并在占位值未替换时提前阻止启动：

```powershell
pwsh -File "C:\Users\xueba\Documents\New project 2\deploy\openclaw\local\start.ps1"
```

If you want local and cloud to run the exact same image tag, log in to ACR first and set `OPENCLAW_IMAGE` in `.env` to the ACR image built by `build-image.ps1`.

Example:

```powershell
az acr login --name hybridagentacr001
```

Then set:

```text
OPENCLAW_IMAGE=hybridagentacr001.azurecr.io/openclaw:poc-001
```

### Validate it

```powershell
pwsh -File "C:\Users\xueba\Documents\New project 2\scripts\validate-openclaw.ps1" `
  -BaseUrl "http://localhost:18789" `
  -GatewayToken "<your token>"
```

## ACA Runtime

### What it does

- creates or reuses an ACA environment
- creates Azure Files storage
- mounts Azure Files into the container at `/mnt/openclaw`
- uploads `openclaw.cloud.aca.json5` as `/mnt/openclaw/openclaw.json`
- deploys the OpenClaw container into ACA

### Prerequisites

- Azure CLI installed
- `az login`
- Container Apps extension available
- permission to create ACR, ACA, Azure Files, and managed identities
- an OpenAI API key

### Build the image in ACR

This uses ACR Tasks, which can build and push a Docker image in Azure without relying on your local Docker daemon.

```powershell
pwsh -File "C:\Users\xueba\Documents\New project 2\deploy\openclaw\acr\build-image.ps1" `
  -ResourceGroup "rg-hybrid-agent-poc" `
  -Location "eastus" `
  -AcrName "hybridagentacr001" `
  -ImageRepository "openclaw" `
  -ImageTag "poc-001"
```

The default source context is the public OpenClaw GitHub repository on the `main` branch.

You can also create one shared cloud env file first:

```powershell
Copy-Item "C:\Users\xueba\Documents\New project 2\deploy\openclaw\.env.cloud.example" `
  "C:\Users\xueba\Documents\New project 2\deploy\openclaw\.env.cloud"
```

Then the build and deploy scripts can read their parameters directly from that file:

```powershell
pwsh -File "C:\Users\xueba\Documents\New project 2\deploy\openclaw\acr\build-image.ps1"
pwsh -File "C:\Users\xueba\Documents\New project 2\deploy\openclaw\aca\deploy.ps1"
pwsh -File "C:\Users\xueba\Documents\New project 2\deploy\openclaw\run-poc.ps1"
```

If you want to build from a local checkout instead, pass:

```powershell
-UseLocalContext `
-LocalContextPath "C:\path\to\openclaw"
```

### Deploy ACA from the ACR image

```powershell
pwsh -File "C:\Users\xueba\Documents\New project 2\deploy\openclaw\aca\deploy.ps1" `
  -ResourceGroup "rg-hybrid-agent-poc" `
  -Location "eastus" `
  -ManagedEnvironmentName "acae-hybrid-agent-poc" `
  -ContainerAppName "openclaw-cloud" `
  -StorageAccountName "sthybridagentpoc001" `
  -FileShareName "openclawstate" `
  -AcrName "hybridagentacr001" `
  -ImageRepository "openclaw" `
  -ImageTag "poc-001" `
  -UserAssignedIdentityName "id-openclaw-pull" `
  -GatewayToken "<long random token>" `
  -OpenAiApiKey "<your openai api key>"
```

### One-command cloud path

If you want build + deploy in one shot:

```powershell
pwsh -File "C:\Users\xueba\Documents\New project 2\deploy\openclaw\run-poc.ps1" `
  -ResourceGroup "rg-hybrid-agent-poc" `
  -Location "eastus" `
  -AcrName "hybridagentacr001" `
  -ManagedEnvironmentName "acae-hybrid-agent-poc" `
  -ContainerAppName "openclaw-cloud" `
  -StorageAccountName "sthybridagentpoc001" `
  -FileShareName "openclawstate" `
  -UserAssignedIdentityName "id-openclaw-pull" `
  -GatewayToken "<long random token>" `
  -OpenAiApiKey "<your openai api key>"
```

The scripts now automatically pin `AZURE_CONFIG_DIR` into the repository workspace when that variable is unset, which avoids profile-permission issues on locked-down machines and in sandboxed environments.

### Validate it

Use the URL printed by `deploy.ps1`, then run:

```powershell
pwsh -File "C:\Users\xueba\Documents\New project 2\scripts\validate-openclaw.ps1" `
  -BaseUrl "https://<aca fqdn>" `
  -GatewayToken "<your token>"
```

### Approve the first browser device on ACA

The ACA deployment keeps `gateway.auth.mode: "token"`, but OpenClaw still treats a new browser Control UI session as a device that needs first-time approval. If the UI shows `device pairing required`, approve the pending request from the running ACA container instead of hunting for an unsupported `pairing=false` config.

List pending requests:

```powershell
pwsh -File "C:\Users\xueba\Documents\New project 2\deploy\openclaw\aca\approve-device.ps1" `
  -ListPending
```

Approve a specific request ID:

```powershell
pwsh -File "C:\Users\xueba\Documents\New project 2\deploy\openclaw\aca\approve-device.ps1" `
  -RequestId "<requestId>"
```

## Minimal Validation Set

The MVP is considered valid when all of the following are true:

1. Local OpenClaw boots successfully in Docker Compose.
2. ACA OpenClaw boots successfully in Azure Container Apps.
3. `GET /v1/models` succeeds against both runtimes.
4. Local runtime shows Docker sandbox configuration.
5. ACA runtime shows sandbox disabled and still serves the Gateway surface.
6. ACA restart does not lose `openclaw.json` or workspace files because they are mounted from Azure Files.
7. ACA can pull the private OpenClaw image from ACR using a user-assigned managed identity.

## Known Constraints

### 1. ACA control UI origin policy

The cloud config currently uses:

- `gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback: true`

This is only to unblock the first ACA boot before you know the generated ACA FQDN.

After the first deploy, replace it with an explicit `allowedOrigins` list using the real ACA HTTPS origin.

### 1b. ACA browser pairing behavior

Even with a valid gateway token, a brand-new browser device still needs a one-time OpenClaw approval when the gateway is exposed directly from ACA. This is expected behavior for token-based access. If you need browser sessions to connect without device pairing, you need a supported identity front door such as OpenClaw's `trusted-proxy` mode, not just a different token setting.

### 2. ACA sandbox limitation

The cloud config uses:

- `agents.defaults.sandbox.mode: "off"`

That is intentional for the MVP.

Do not try to mount a host Docker socket into ACA.

### 3. ACA image pull strategy

This version uses:

- Azure Container Registry for image storage
- ACR Tasks for remote image build
- a user-assigned managed identity for ACA image pull

That avoids embedding ACR admin credentials in the container app and avoids the bootstrap deadlock that can happen with system-assigned identity on first private-image deployment.

### 4. Build context

By default, `build-image.ps1` builds from:

- `https://github.com/openclaw/openclaw.git#main`

If you need reproducibility, pin this to a specific tag or commit-ref instead of `main`.

## Next Engineering Step

Once both runtimes are up, the next real integration milestone should be:

- define an orchestrator service
- persist execution metadata outside OpenClaw state
- implement `checkpoint -> handoff request -> cloud resume` as an app-level flow

At that point OpenClaw becomes the runtime on both sides, while our own control plane handles mobility.
