param(
  [string]$EnvFile = "",

  [switch]$AllowExampleValues
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $scriptDir))
. (Join-Path (Split-Path -Parent $scriptDir) "common.ps1")
$configureScript = Join-Path $repoRoot "scripts\configure-openclaw-model.ps1"

if ([string]::IsNullOrWhiteSpace($EnvFile)) {
  $EnvFile = Join-Path $scriptDir ".env"
}

$envExample = Join-Path $scriptDir ".env.example"
if (-not (Test-Path -LiteralPath $EnvFile)) {
  if (-not (Test-Path -LiteralPath $envExample)) {
    throw "Local env file '$EnvFile' does not exist and '.env.example' is missing."
  }

  Copy-Item -LiteralPath $envExample -Destination $EnvFile
  Write-Host "Seeded $EnvFile from .env.example"
}

$envValues = Read-SimpleEnvFile -Path $EnvFile
$gatewayToken = Resolve-Setting -ExplicitValue "" -EnvVarName "OPENCLAW_GATEWAY_TOKEN" -FileValues $envValues
$modelApiKeyEnvVar = Resolve-Setting -ExplicitValue "" -EnvVarName "OPENCLAW_ENV_KEY" -FileValues $envValues -DefaultValue "AZURE_OPENAI_API_KEY"
$modelApiKey = Resolve-Setting -ExplicitValue "" -EnvVarName $modelApiKeyEnvVar -FileValues $envValues

if (-not $AllowExampleValues) {
  if (Test-PlaceholderValue -Value $gatewayToken -PlaceholderValues @("replace-with-a-long-random-token")) {
    throw "OPENCLAW_GATEWAY_TOKEN is still using the example placeholder. Update '$EnvFile' before starting the local runtime."
  }

  if (Test-PlaceholderValue -Value $modelApiKey -PlaceholderValues @("replace-with-your-azure-openai-api-key", "replace-with-your-openai-api-key")) {
    throw "$modelApiKeyEnvVar is still using the example placeholder. Update '$EnvFile' before starting the local runtime."
  }
}

if (-not (Test-CommandAvailable -Name "docker")) {
  throw "Docker CLI is not installed or not available on PATH. Install Docker Desktop before starting the local runtime."
}

Write-Host "Rendering local OpenClaw model config from env..."
& $configureScript -EnvFile $EnvFile -Target local

Ensure-Directory -Path (Join-Path $scriptDir "state") | Out-Null
Ensure-Directory -Path (Join-Path $scriptDir "state\workspace") | Out-Null

Write-Host "Starting local OpenClaw with Docker Compose..."
docker compose up -d
if ($LASTEXITCODE -ne 0) {
  throw "docker compose up failed with exit code $LASTEXITCODE."
}

$port = Resolve-Setting -ExplicitValue "" -EnvVarName "OPENCLAW_GATEWAY_PORT" -FileValues $envValues -DefaultValue "18789"
Write-Host ""
Write-Host "Local OpenClaw is starting."
Write-Host "Gateway URL: http://127.0.0.1:$port"
Write-Host "Validate with:"
Write-Host "pwsh -File `"$repoRoot\scripts\validate-openclaw.ps1`" -BaseUrl `"http://127.0.0.1:$port`" -GatewayToken `"$gatewayToken`""
