# GitHub Copilot Hybrid Agent Orchestrator

This project implements a hybrid agent architecture based on two GitHub Copilot integration surfaces:

- `@github/copilot-sdk` for the actual local and cloud agent execution runtime
- MCP for exposing the local orchestrator to GitHub Copilot in VS Code

The solution contains:

- a local orchestrator agent exposed as an MCP server for GitHub Copilot in VS Code
- a local HTTP control plane that stores memory and checkpoints on disk
- a cloud agent service intended to run on Azure Container Apps
- a lightweight web UI for switching executors and viewing state

## Architecture

### Local agent

The local agent lives in `src/local-orchestrator/index.ts` and has two responsibilities:

- expose MCP tools to GitHub Copilot over stdio
- persist session memory and checkpoints locally under `.data/sessions`
- execute tasks through `@github/copilot-sdk`, resuming the underlying Copilot session when possible

### Cloud agent

The cloud agent lives in `src/cloud-agent/index.ts` and exposes an HTTP endpoint at `/v1/tasks/execute`.

The cloud service also uses `@github/copilot-sdk`. It receives the local checkpoint and memory snapshot, resumes its cloud-side Copilot session if present, and returns updated handoff state.

The local orchestrator forwards execution to the cloud agent when a session is switched to `cloud`. The same local checkpoint and memory snapshot are included in the request so execution can continue without losing state.

### Control panel

The control panel lives in `apps/control-panel`.

In development, run it with Vite.
In production, build it once and the local orchestrator serves it from `apps/control-panel/dist`.

## Step 1: Install dependencies

```powershell
npm install
```

## Step 2: Authenticate the Copilot SDK

Choose one of these paths.

### Local development using your signed-in GitHub user

The Node SDK can reuse your local Copilot CLI login.

### Token-based execution for cloud or headless environments

Set one of these environment variables before starting the service:

- `COPILOT_GITHUB_TOKEN`
- `GITHUB_TOKEN`
- `GH_TOKEN`

Optional model overrides:

- `COPILOT_MODEL` (`auto` is the safest default)
- `LOCAL_COPILOT_MODEL`
- `CLOUD_COPILOT_MODEL`

Optional deterministic fallback for demos without credentials:

- `HYBRID_AGENT_MOCK_MODE=true`

## Step 3: Run locally in development

Start the cloud agent, local orchestrator, and control panel together:

```powershell
npm run dev
```

Local endpoints:

- local orchestrator API: `http://127.0.0.1:7071/api/health`
- cloud agent API: `http://127.0.0.1:8787/health`
- control panel: `http://127.0.0.1:4173`

## Step 4: Build for local production-style run

```powershell
npm run build
```

Then run the cloud and local services in separate terminals:

```powershell
npm run start:cloud
```

```powershell
npm run start:local
```

After the UI is built, the local orchestrator serves it at `http://127.0.0.1:7071`.

## Step 5: Connect GitHub Copilot in VS Code

1. Run `npm run build`.
2. Open `.vscode/mcp.json`.
3. Click the `Start` button in the editor.
4. Open Copilot Chat and switch to `Agent` mode.
5. Use MCP tools such as `create_session`, `execute_task`, `switch_mode`, and `get_session`.

This repository configures the MCP server in `.vscode/mcp.json`.

## Step 6: Test local handoff

With the local orchestrator and cloud agent running:

```powershell
npm run smoke
```

The smoke test creates a session, runs one task on the local agent, switches the session to the cloud agent, executes again, and verifies that checkpoint versions continue from `v1` to `v2`.

Run unit tests with:

```powershell
npm test
```

## Step 7: Deploy the cloud agent to Azure Container Apps

Prerequisites:

- Azure CLI installed and logged in
- Container Apps extension installed: `az extension add --name containerapp`
- permission to create resource groups, ACR, and ACA

Deploy with:

```powershell
.\scripts\deploy-cloud-agent-aca.ps1 `
  -SubscriptionId "<subscription-id>" `
  -ResourceGroup "rg-hybrid-agent" `
  -Location "eastus" `
  -ContainerAppEnvironment "acae-hybrid-agent" `
  -ContainerAppName "ca-hybrid-cloud-agent" `
  -AcrName "hybridagentacr123"
```

The script will:

- create or reuse the resource group
- create ACR and build the cloud agent image
- create or reuse the ACA environment
- create or update the Container App
- print the public FQDN for the cloud agent

Before deploying for real, set a token source for the container app, for example during `az containerapp update --set-env-vars`:

- `COPILOT_GITHUB_TOKEN=<token>`
- `CLOUD_COPILOT_MODEL=auto`

## Step 8: Point the local orchestrator at ACA

Set `CLOUD_AGENT_BASE_URL` before starting the local orchestrator:

```powershell
$env:CLOUD_AGENT_BASE_URL = "https://<your-aca-fqdn>"
npm run start:local
```

If you want the VS Code MCP server to use ACA too, update `.vscode/mcp.json` and replace `http://127.0.0.1:8787` with the ACA URL.

## Step 9: Typical end-to-end flow

1. Create a session in the UI or with the MCP `create_session` tool.
2. Run analysis work locally.
3. Switch the session to `cloud` in the UI or with `switch_mode`.
4. Execute deployment or long-running work in the cloud agent.
5. Switch back to `local` and continue from the stored checkpoint and memory.

## Notes

- This implementation keeps checkpoint and memory authoritative on the local side, which makes switching deterministic and easy to inspect.
- The cloud agent is stateless with respect to checkpoint and memory. The authoritative state remains local, while the cloud-side Copilot session ID is also cached inside local checkpoint context for continuation.
- For production, replace ACR admin credentials with managed identity and Key Vault-backed secrets.