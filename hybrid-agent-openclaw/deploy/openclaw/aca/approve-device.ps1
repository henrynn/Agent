param(
  [string]$ResourceGroup,

  [string]$ContainerAppName,

  [string]$RequestId = "",

  [switch]$ListPending,

  [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $scriptDir))
. (Join-Path (Split-Path -Parent $scriptDir) "common.ps1")

if ([string]::IsNullOrWhiteSpace($EnvFile)) {
  $defaultEnvFile = Join-Path (Split-Path -Parent $scriptDir) ".env.cloud"
  if (Test-Path -LiteralPath $defaultEnvFile) {
    $EnvFile = $defaultEnvFile
  }
}

$fileValues = @{}
if (-not [string]::IsNullOrWhiteSpace($EnvFile)) {
  $fileValues = Read-SimpleEnvFile -Path $EnvFile
}

$ResourceGroup = Resolve-Setting -ExplicitValue $ResourceGroup -EnvVarName "RESOURCE_GROUP" -FileValues $fileValues
$ContainerAppName = Resolve-Setting -ExplicitValue $ContainerAppName -EnvVarName "CONTAINER_APP_NAME" -FileValues $fileValues

Assert-RequiredSettings -Settings @{
  ResourceGroup = $ResourceGroup
  ContainerAppName = $ContainerAppName
}

if (-not $ListPending -and [string]::IsNullOrWhiteSpace($RequestId)) {
  throw "Specify -RequestId <requestId> to approve a device, or pass -ListPending to inspect pending requests."
}

Initialize-AzureCliContext -RepoRoot $rootDir

function Invoke-ContainerCommand {
  az containerapp exec `
    --name $ContainerAppName `
    --resource-group $ResourceGroup `
    --container openclaw
}

if ($ListPending) {
  Write-Host "Opening an interactive console in ACA app '$ContainerAppName'."
  Write-Host "Run this inside the container shell:"
  Write-Host "  node /app/openclaw.mjs devices list"
  Write-Host "Then type 'exit' to close the shell."
  Write-Host ""
  Invoke-ContainerCommand
  return
}

if ($RequestId -notmatch '^[0-9a-fA-F-]{8,}$') {
  throw "RequestId '$RequestId' does not look like a valid OpenClaw device pairing request ID."
}

Write-Host "Approving device pairing request '$RequestId' in ACA app '$ContainerAppName'..."
Write-Host "An interactive container shell will open next."
Write-Host "Run this inside the container shell:"
Write-Host "  node /app/openclaw.mjs devices approve $RequestId"
Write-Host "Then type 'exit' to close the shell."
Write-Host ""
Invoke-ContainerCommand
