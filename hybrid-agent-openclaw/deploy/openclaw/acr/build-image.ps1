param(
  [string]$ResourceGroup,

  [string]$Location,

  [string]$AcrName,

  [string]$ImageRepository = "",

  [string]$ImageTag = "",

  [string]$SourceContext = "",

  [string]$Dockerfile = "",

  [switch]$UseLocalContext,

  [string]$LocalContextPath = "",

  [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $scriptDir))
. (Join-Path (Split-Path -Parent $scriptDir) "common.ps1")
$configureScript = Join-Path $repoRoot "scripts\configure-openclaw-model.ps1"

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
$Location = Resolve-Setting -ExplicitValue $Location -EnvVarName "LOCATION" -FileValues $fileValues
$AcrName = Resolve-Setting -ExplicitValue $AcrName -EnvVarName "ACR_NAME" -FileValues $fileValues
$ImageRepository = Resolve-Setting -ExplicitValue $ImageRepository -EnvVarName "IMAGE_REPOSITORY" -FileValues $fileValues -DefaultValue "openclaw"
$ImageTag = Resolve-Setting -ExplicitValue $ImageTag -EnvVarName "IMAGE_TAG" -FileValues $fileValues
$SourceContext = Resolve-Setting -ExplicitValue $SourceContext -EnvVarName "SOURCE_CONTEXT" -FileValues $fileValues -DefaultValue "https://github.com/openclaw/openclaw.git#main"
$Dockerfile = Resolve-Setting -ExplicitValue $Dockerfile -EnvVarName "DOCKERFILE" -FileValues $fileValues -DefaultValue "Dockerfile"

if (-not $UseLocalContext -and $fileValues.ContainsKey("USE_LOCAL_CONTEXT")) {
  $UseLocalContext = [System.Convert]::ToBoolean($fileValues["USE_LOCAL_CONTEXT"])
}

$LocalContextPath = Resolve-Setting -ExplicitValue $LocalContextPath -EnvVarName "LOCAL_CONTEXT_PATH" -FileValues $fileValues

Assert-RequiredSettings -Settings @{
  ResourceGroup = $ResourceGroup
  Location = $Location
  AcrName = $AcrName
}

Initialize-AzureCliContext -RepoRoot $repoRoot

if ([string]::IsNullOrWhiteSpace($ImageTag)) {
  $ImageTag = "poc-{0}" -f (Get-Date -Format "yyyyMMddHHmmss")
}

Write-Host "Rendering cloud OpenClaw model config from env..."
& $configureScript -EnvFile $EnvFile -Target cloud

Write-Host "Ensuring Azure CLI is ready for ACR tasks..."
az group create `
  --name $ResourceGroup `
  --location $Location | Out-Null

Write-Host "Creating ACR if needed..."
az acr create `
  --resource-group $ResourceGroup `
  --name $AcrName `
  --sku Standard `
  --admin-enabled false | Out-Null

if ($UseLocalContext) {
  if ([string]::IsNullOrWhiteSpace($LocalContextPath)) {
    throw "LocalContextPath is required when -UseLocalContext is set."
  }

  if ([System.IO.Path]::IsPathRooted($LocalContextPath)) {
    $buildContext = $LocalContextPath
  }
  else {
    $buildContext = Join-Path $repoRoot $LocalContextPath
  }

  if (-not (Test-Path -LiteralPath $buildContext)) {
    throw "LocalContextPath '$LocalContextPath' resolved to '$buildContext', but that path does not exist."
  }
}
else {
  $buildContext = $SourceContext
}

$imageName = "{0}:{1}" -f $ImageRepository, $ImageTag

$dockerfilePath = $Dockerfile
if ($UseLocalContext) {
  if ([System.IO.Path]::IsPathRooted($Dockerfile)) {
    $dockerfilePath = $Dockerfile
  }
  else {
    $dockerfileInContext = Join-Path $buildContext $Dockerfile
    if (Test-Path -LiteralPath $dockerfileInContext) {
      $dockerfilePath = $dockerfileInContext
    }
    else {
      $dockerfileInRepo = Join-Path $repoRoot $Dockerfile
      if (-not (Test-Path -LiteralPath $dockerfileInRepo)) {
        throw "Dockerfile '$Dockerfile' was not found under '$buildContext' or '$repoRoot'."
      }

      $dockerfilePath = $dockerfileInRepo
    }
  }
}

Write-Host "Submitting ACR build for image $imageName ..."
az acr build `
  --registry $AcrName `
  --image $imageName `
  --file $dockerfilePath `
  $buildContext | Out-Null

$loginServer = az acr show `
  --name $AcrName `
  --resource-group $ResourceGroup `
  --query loginServer `
  --output tsv

Write-Host ""
Write-Host "Image build complete."
Write-Host "Image: $loginServer/$imageName"
