param(
  [string]$ResourceGroup,

  [string]$Location,

  [string]$AcrName,

  [string]$ManagedEnvironmentName,

  [string]$ContainerAppName,

  [string]$StorageAccountName,

  [string]$FileShareName,

  [string]$UserAssignedIdentityName,

  [string]$GatewayToken,

  [string]$OpenAiApiKey,

  [string]$ImageRepository = "",

  [string]$ImageTag = "",

  [string]$ContainerImage,

  [string]$SourceContext = "",

  [string]$Dockerfile = "",

  [switch]$UseLocalContext,

  [string]$LocalContextPath = "",

  [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$buildScript = Join-Path $scriptDir "acr\build-image.ps1"
$deployScript = Join-Path $scriptDir "aca\deploy.ps1"
. (Join-Path $scriptDir "common.ps1")

if ([string]::IsNullOrWhiteSpace($EnvFile)) {
  $defaultEnvFile = Join-Path $scriptDir ".env.cloud"
  if (Test-Path -LiteralPath $defaultEnvFile) {
    $EnvFile = $defaultEnvFile
  }
}

$fileValues = @{}
if (-not [string]::IsNullOrWhiteSpace($EnvFile)) {
  $fileValues = Read-SimpleEnvFile -Path $EnvFile
}

$azureOpenAiApiKey = Resolve-Setting -ExplicitValue "" -EnvVarName "AZURE_OPENAI_API_KEY" -FileValues $fileValues

$ResourceGroup = Resolve-Setting -ExplicitValue $ResourceGroup -EnvVarName "RESOURCE_GROUP" -FileValues $fileValues
$Location = Resolve-Setting -ExplicitValue $Location -EnvVarName "LOCATION" -FileValues $fileValues
$AcrName = Resolve-Setting -ExplicitValue $AcrName -EnvVarName "ACR_NAME" -FileValues $fileValues
$ManagedEnvironmentName = Resolve-Setting -ExplicitValue $ManagedEnvironmentName -EnvVarName "MANAGED_ENVIRONMENT_NAME" -FileValues $fileValues
$ContainerAppName = Resolve-Setting -ExplicitValue $ContainerAppName -EnvVarName "CONTAINER_APP_NAME" -FileValues $fileValues
$StorageAccountName = Resolve-Setting -ExplicitValue $StorageAccountName -EnvVarName "STORAGE_ACCOUNT_NAME" -FileValues $fileValues
$FileShareName = Resolve-Setting -ExplicitValue $FileShareName -EnvVarName "FILE_SHARE_NAME" -FileValues $fileValues
$UserAssignedIdentityName = Resolve-Setting -ExplicitValue $UserAssignedIdentityName -EnvVarName "USER_ASSIGNED_IDENTITY_NAME" -FileValues $fileValues
$GatewayToken = Resolve-Setting -ExplicitValue $GatewayToken -EnvVarName "GATEWAY_TOKEN" -FileValues $fileValues
$OpenAiApiKey = Resolve-Setting -ExplicitValue $OpenAiApiKey -EnvVarName "OPENAI_API_KEY" -FileValues $fileValues -DefaultValue $azureOpenAiApiKey
$ImageRepository = Resolve-Setting -ExplicitValue $ImageRepository -EnvVarName "IMAGE_REPOSITORY" -FileValues $fileValues -DefaultValue "openclaw"
$ImageTag = Resolve-Setting -ExplicitValue $ImageTag -EnvVarName "IMAGE_TAG" -FileValues $fileValues
$ContainerImage = Resolve-Setting -ExplicitValue $ContainerImage -EnvVarName "CONTAINER_IMAGE" -FileValues $fileValues
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
  ManagedEnvironmentName = $ManagedEnvironmentName
  ContainerAppName = $ContainerAppName
  StorageAccountName = $StorageAccountName
  FileShareName = $FileShareName
  UserAssignedIdentityName = $UserAssignedIdentityName
  GatewayToken = $GatewayToken
  OpenAiApiKey = $OpenAiApiKey
}

if ([string]::IsNullOrWhiteSpace($ImageTag)) {
  $ImageTag = "poc-{0}" -f (Get-Date -Format "yyyyMMddHHmmss")
}

$buildArgs = @{
  ResourceGroup = $ResourceGroup
  Location = $Location
  AcrName = $AcrName
  ImageRepository = $ImageRepository
  ImageTag = $ImageTag
  SourceContext = $SourceContext
  Dockerfile = $Dockerfile
  EnvFile = $EnvFile
}

if ($UseLocalContext) {
  $buildArgs.UseLocalContext = $true
  $buildArgs.LocalContextPath = $LocalContextPath
}

if ([string]::IsNullOrWhiteSpace($ContainerImage)) {
  Write-Host "Step 1/2: Building image in ACR..."
  & $buildScript @buildArgs
}
else {
  Write-Host "Step 1/2: Skipping ACR build because CONTAINER_IMAGE is set."
}

Write-Host ""
Write-Host "Step 2/2: Deploying to ACA..."
& $deployScript `
  -ResourceGroup $ResourceGroup `
  -Location $Location `
  -ManagedEnvironmentName $ManagedEnvironmentName `
  -ContainerAppName $ContainerAppName `
  -StorageAccountName $StorageAccountName `
  -FileShareName $FileShareName `
  -AcrName $AcrName `
  -ImageRepository $ImageRepository `
  -ImageTag $ImageTag `
  -ContainerImage $ContainerImage `
  -UserAssignedIdentityName $UserAssignedIdentityName `
  -GatewayToken $GatewayToken `
  -OpenAiApiKey $OpenAiApiKey `
  -EnvFile $EnvFile
