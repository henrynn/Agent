# hybrid-agent-openclaw

Hybrid OpenClaw runtime proof of concept for running:

- a local OpenClaw instance on the developer machine
- a cloud OpenClaw instance on Azure Container Apps
- a lightweight orchestrator service for validating handoff-oriented workflows

## What's In This Folder

- `deploy/openclaw`: local and ACA deployment scripts, env templates, and helper utilities
- `openclaw/config`: checked-in OpenClaw config templates for local and ACA targets
- `openclaw/aca-wrapper`: ACA entrypoint wrapper and Dockerfile
- `services/orchestrator`: Node.js orchestrator and dashboard service
- `scripts`: validation and configuration helper scripts
- `docs`: architecture notes and MVP deployment documentation
- `prototype`: frontend prototype assets

## Quick Start

Local runtime:

```powershell
pwsh -File ".\deploy\openclaw\local\start.ps1"
```

Cloud validation:

```powershell
pwsh -File ".\scripts\validate-openclaw.ps1" `
  -BaseUrl "https://<your-aca-url>" `
  -GatewayToken "<your-gateway-token>"
```

Orchestrator:

```powershell
cd .\services\orchestrator
node server.js
```

## Important

- Do not commit `.env` files, rendered ACA YAML, Azure CLI local state, or runtime logs.
- Start from the checked-in example env files such as `deploy/openclaw/.env.cloud.example` and `deploy/openclaw/local/.env.example`.
- If Control UI access is blocked by device pairing, use `deploy/openclaw/aca/approve-device.ps1` to open a shell into the ACA container and approve the current request.

## More Detail

- Deployment walkthrough: [docs/openclaw-local-aca-poc.md](./docs/openclaw-local-aca-poc.md)
- Architecture notes: [docs/openclaw-hybrid-agent-architecture.md](./docs/openclaw-hybrid-agent-architecture.md)
- Orchestrator API notes: [docs/orchestrator-mvp-api.md](./docs/orchestrator-mvp-api.md)
