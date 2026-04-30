# Agent

This repository contains agent-related experiments, prototypes, and deployment assets.

## Projects

- [hybrid-agent-openclaw](./hybrid-agent-openclaw)
	Hybrid OpenClaw runtime proof of concept with local and Azure Container Apps execution plus a lightweight orchestrator service for handoff-oriented workflows.
	Tech stack: OpenClaw, Node.js, PowerShell, Azure Container Apps.
	Deployment target: local developer machine and Azure Container Apps.
	README: [hybrid-agent-openclaw/README.md](./hybrid-agent-openclaw/README.md)

- [ghcopilot-hybrid-orch](./ghcopilot-hybrid-orch)
	GitHub Copilot hybrid orchestrator sample with a local MCP-based orchestrator, a cloud agent, a control panel UI, and checkpoint/memory handoff between local and cloud execution.
	Tech stack: TypeScript, Node.js, Express, React, Vite, MCP, @github/copilot-sdk.
	Deployment target: local development plus Azure Container Apps for the cloud agent.
	README: [ghcopilot-hybrid-orch/README.md](./ghcopilot-hybrid-orch/README.md)

## Notes

- Sensitive runtime files such as `.env`, rendered deployment artifacts, local Azure CLI state, and runtime logs are intentionally excluded from version control.
- Each project folder should include its own `README.md` with setup and usage details.
