param(
  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,

  [Parameter(Mandatory = $true)]
  [string]$GatewayToken
)

$ErrorActionPreference = "Stop"
$headers = @{
  Authorization = "Bearer $GatewayToken"
}

Write-Host "Checking $BaseUrl/v1/models ..."
$response = Invoke-RestMethod `
  -Uri "$BaseUrl/v1/models" `
  -Method Get `
  -Headers $headers

if (-not $response.data) {
  throw "OpenClaw did not return any models from /v1/models."
}

$response.data | Select-Object id | Format-Table -AutoSize
Write-Host ""
Write-Host "Validation succeeded."
