# Local Runtime -> Orchestrator State Store -> Cloud Runtime/UI Sequence

This sequence diagram shows how execution state moves through the current MVP implementation.

- `Orchestrator API` is `services/orchestrator/server.js`
- `State Store` is currently `services/orchestrator/data/orchestrator-state.json`
- In a later production design, the state store should become a shared durable store

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as Local UI / Dashboard
    participant Local as Local OpenClaw Runtime
    participant Orch as Hybrid Orchestrator API
    participant Store as Orchestrator State Store
    participant Cloud as Cloud OpenClaw Runtime

    User->>UI: Start or inspect a hybrid task
    UI->>Orch: POST /tasks
    Orch->>Store: persist task metadata
    Store-->>Orch: task created
    Orch-->>UI: task id

    UI->>Orch: POST /executions { sourceRuntime: local }
    Orch->>Store: persist execution(status=running_local, owner=local)
    Store-->>Orch: execution created
    Orch-->>UI: execution payload

    rect rgb(230, 244, 255)
        Note over Local,Store: Local runtime owns the lease and keeps execution state fresh
        Local->>Orch: POST /executions/{id}/heartbeat
        Orch->>Store: update summary, progress, artifacts, lastHeartbeatAt
        Local->>Orch: POST /executions/{id}/steps/{stepId}
        Orch->>Store: update current step and step status
    end

    User->>UI: Continue in Cloud
    UI->>Orch: POST /executions/{id}/handoff
    Orch->>Orch: create checkpoint if needed
    Orch->>Store: persist checkpoint snapshot
    Orch->>Store: persist handoff(status=pending_resume)
    Orch->>Store: update execution(status=handoff_pending, owner=none, targetRuntime=cloud)
    Orch-->>UI: handoff package metadata

    Cloud->>Orch: POST /executions/{id}/resume { runtime: cloud, handoffId }
    Orch->>Store: load checkpoint + handoff
    Orch->>Store: update execution(status=running_cloud, owner=cloud, currentRuntime=cloud)
    Orch-->>Cloud: resumed execution payload

    rect rgb(232, 245, 233)
        Note over Cloud,Store: Cloud runtime continues from the checkpoint and reports back into orchestrator storage
        Cloud->>Orch: POST /executions/{id}/heartbeat
        Orch->>Store: refresh summary, progress, artifacts, lease
        Cloud->>Orch: POST /executions/{id}/steps/{stepId}
        Orch->>Store: update plan step state
    end

    par UI polling execution state
        UI->>Orch: GET /executions/{id}
        Orch->>Store: read execution + checkpoints + handoffs + events
        Store-->>Orch: current orchestration state
        Orch-->>UI: execution details for rendering
    and UI probing runtime availability
        UI->>Orch: GET /runtime-services
        Orch->>Local: probe GET /v1/models
        Orch->>Cloud: probe GET /v1/models
        Orch-->>UI: runtime health summary(up/down/auth_required)
    end

    Note over UI,Store: Important: runtime availability is probed live, but execution state is read from orchestrator-owned state storage, not from OpenClaw process memory.
```

## Reading Guide

- `GET /runtime-services` answers: "Is the local/cloud runtime reachable right now?"
- `GET /executions/{id}` answers: "What is the current execution state, owner, checkpoint, plan, and progress?"
- The second answer comes from the orchestrator state store, which the runtimes update through orchestrator APIs.
