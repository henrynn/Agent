param()

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path (Split-Path -Parent $scriptDir) "common.ps1")

if (-not (Test-CommandAvailable -Name "docker")) {
  throw "Docker CLI is not installed or not available on PATH."
}

Write-Host "Stopping local OpenClaw..."
docker compose down
if ($LASTEXITCODE -ne 0) {
  throw "docker compose down failed with exit code $LASTEXITCODE."
}

Write-Host "Local OpenClaw stopped."
