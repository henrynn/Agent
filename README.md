# Agent

This repository contains agent-related experiments, prototypes, and deployment assets.

## Projects

- [hybrid-agent-openclaw](./hybrid-agent-openclaw): a hybrid local + Azure Container Apps OpenClaw proof of concept, including deployment scripts, runtime configuration, an orchestrator service, and supporting docs.
- [ghcopilot-hybrid-orch](./ghcopilot-hybrid-orch): a GitHub Copilot hybrid orchestrator sample with a local MCP-based orchestrator, a cloud agent for Azure Container Apps, a control panel UI, and checkpoint/memory handoff between local and cloud execution. See the [project README](./ghcopilot-hybrid-orch/README.md).

## Notes

- Sensitive runtime files such as `.env`, rendered deployment artifacts, local Azure CLI state, and runtime logs are intentionally excluded from version control.
- Each project folder should include its own `README.md` with setup and usage details.
