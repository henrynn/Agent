param(
  [string]$BaseUrl = "http://127.0.0.1:4040"
)

$ErrorActionPreference = "Stop"

Write-Host "Creating task..."
$task = Invoke-RestMethod `
  -Uri "$BaseUrl/tasks" `
  -Method Post `
  -ContentType "application/json" `
  -Body (@{
      title = "Hybrid agent migration dry run"
      goal = "Validate local to cloud handoff with a resumable checkpoint."
      requestedBy = "demo-script"
    } | ConvertTo-Json)

Write-Host "Creating execution..."
$execution = Invoke-RestMethod `
  -Uri "$BaseUrl/executions" `
  -Method Post `
  -ContentType "application/json" `
  -Body (@{
      taskId = $task.id
      sourceRuntime = "local"
      progress = 18
      summary = "Local runtime started ingestion and planning."
      plan = @(
        @{
          id = "step_ingest"
          title = "Ingest local workspace"
          status = "running"
          summary = "Local runtime is indexing files and prompts."
          sideEffectClass = "pure_read"
        },
        @{
          id = "step_summarize"
          title = "Synthesize report in cloud"
          status = "queued"
          summary = "Long-running synthesis step planned for cloud."
          sideEffectClass = "replay_safe_write"
        }
      )
    } | ConvertTo-Json -Depth 5)

Write-Host "Marking first step complete..."
Invoke-RestMethod `
  -Uri "$BaseUrl/executions/$($execution.id)/steps/step_ingest" `
  -Method Post `
  -ContentType "application/json" `
  -Body (@{
      status = "done"
      progress = 42
      summary = "Workspace ingest finished locally."
    } | ConvertTo-Json) | Out-Null

Write-Host "Activating cloud synthesis step..."
Invoke-RestMethod `
  -Uri "$BaseUrl/executions/$($execution.id)/steps/step_summarize" `
  -Method Post `
  -ContentType "application/json" `
  -Body (@{
      status = "running"
      progress = 45
      summary = "Ready for cloud continuation."
    } | ConvertTo-Json) | Out-Null

Write-Host "Creating checkpoint..."
$checkpoint = Invoke-RestMethod `
  -Uri "$BaseUrl/executions/$($execution.id)/checkpoint" `
  -Method Post `
  -ContentType "application/json" `
  -Body (@{
      runtime = "local"
      note = "Local runtime sealed a resumable boundary before shutdown."
    } | ConvertTo-Json)

Write-Host "Creating handoff..."
$handoff = Invoke-RestMethod `
  -Uri "$BaseUrl/executions/$($execution.id)/handoff" `
  -Method Post `
  -ContentType "application/json" `
  -Body (@{
      sourceRuntime = "local"
      targetRuntime = "cloud"
      checkpointId = $checkpoint.id
      createCheckpoint = $false
      reason = "Operator is shutting down the local machine."
      toolCapabilityRequirements = @("portable:model-inference", "shared:artifact-store")
      environmentRequirements = @("cloud-openclaw-runtime", "shared-state-store")
    } | ConvertTo-Json -Depth 5)

Write-Host "Resuming in cloud..."
$resumed = Invoke-RestMethod `
  -Uri "$BaseUrl/executions/$($execution.id)/resume" `
  -Method Post `
  -ContentType "application/json" `
  -Body (@{
      runtime = "cloud"
      handoffId = $handoff.id
    } | ConvertTo-Json)

Write-Host ""
Write-Host "Execution resumed in cloud:"
$resumed | ConvertTo-Json -Depth 8
