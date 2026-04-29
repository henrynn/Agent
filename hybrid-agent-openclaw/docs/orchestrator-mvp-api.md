# Orchestrator MVP API

This document describes the minimum hybrid-orchestrator API that now exists in the repository.

Service path:

`services/orchestrator/server.js`

Default local URL:

`http://127.0.0.1:4040`

Dashboard URL:

`http://127.0.0.1:4040/`

## Purpose

This API is the first control-plane layer above the local and cloud OpenClaw runtimes.

It is responsible for:

- tracking task metadata
- tracking execution ownership
- creating checkpoints
- packaging handoff payloads
- allowing the target runtime to resume from a checkpoint

## Endpoints

### `GET /health`

Returns service health and object counts.

### `POST /tasks`

Creates a task.

Example payload:

```json
{
  "title": "Hybrid agent migration dry run",
  "goal": "Validate local to cloud handoff with a resumable checkpoint.",
  "requestedBy": "operator"
}
```

### `POST /executions`

Creates an execution for a task.

Example payload:

```json
{
  "taskId": "task_xxx",
  "sourceRuntime": "local",
  "progress": 18,
  "summary": "Local runtime started ingestion and planning.",
  "plan": [
    {
      "id": "step_ingest",
      "title": "Ingest local workspace",
      "status": "running",
      "summary": "Local runtime is indexing files and prompts.",
      "sideEffectClass": "pure_read"
    },
    {
      "id": "step_summarize",
      "title": "Synthesize report in cloud",
      "status": "queued",
      "summary": "Long-running synthesis step planned for cloud.",
      "sideEffectClass": "replay_safe_write"
    }
  ]
}
```

### `POST /executions/{id}/checkpoint`

Creates a stable checkpoint for the execution.

Example payload:

```json
{
  "runtime": "local",
  "note": "Local runtime sealed a resumable boundary before shutdown."
}
```

### `POST /executions/{id}/handoff`

Creates the handoff package and parks the execution in `handoff_pending`.

Example payload:

```json
{
  "sourceRuntime": "local",
  "targetRuntime": "cloud",
  "checkpointId": "cp_xxx",
  "createCheckpoint": false,
  "reason": "Operator is shutting down the local machine.",
  "toolCapabilityRequirements": [
    "portable:model-inference",
    "shared:artifact-store"
  ],
  "environmentRequirements": [
    "cloud-openclaw-runtime",
    "shared-state-store"
  ]
}
```

### `POST /executions/{id}/resume`

Claims the execution lease on the target runtime and resumes from the chosen checkpoint.

Example payload:

```json
{
  "runtime": "cloud",
  "handoffId": "handoff_xxx"
}
```

### `POST /executions/{id}/steps/{stepId}`

Updates a step status and optionally execution progress.

### `POST /executions/{id}/heartbeat`

Records a runtime heartbeat and optional progress or summary update.

### `GET /executions/{id}`

Returns the execution plus recent events, checkpoints, and handoffs.

### `GET /executions/{id}/events`

Returns the full event timeline for one execution.

### `GET /executions/{id}/checkpoints`

Returns the checkpoints for one execution.

## State Machine

The service currently uses these execution states:

- `running_local`
- `handoff_pending`
- `running_cloud`

It also stores:

- `owner`
- `currentRuntime`
- `targetRuntime`
- `pendingHandoffId`
- `resumeFromCheckpointId`
- `leaseExpiresAt`

## What Is Persisted In a Checkpoint

Each checkpoint stores:

- execution id
- task id
- current runtime
- current owner
- execution status
- current step id
- progress
- summary
- artifact references
- plan version
- plan snapshot
- lease expiry
- heartbeat timestamp

## Suggested Next Step

The next implementation step after this MVP should be:

- replace JSON file storage with a shared durable store
- authenticate runtime calls
- connect the API to local and cloud OpenClaw runtime adapters
- let the UI consume this API directly for live status and task switching
