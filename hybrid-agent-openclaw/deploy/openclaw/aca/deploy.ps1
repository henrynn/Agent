param(
  [string]$ResourceGroup,

  [string]$Location,

  [string]$ManagedEnvironmentName,

  [string]$ContainerAppName,

  [string]$StorageAccountName,

  [string]$FileShareName,

  [string]$AcrName,

  [string]$ImageRepository = "",

  [string]$ImageTag,

  [string]$ContainerImage,

  [string]$UserAssignedIdentityName,

  [string]$GatewayToken,

  [string]$OpenAiApiKey,

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

$azureOpenAiApiKey = Resolve-Setting -ExplicitValue "" -EnvVarName "AZURE_OPENAI_API_KEY" -FileValues $fileValues

$ResourceGroup = Resolve-Setting -ExplicitValue $ResourceGroup -EnvVarName "RESOURCE_GROUP" -FileValues $fileValues
$Location = Resolve-Setting -ExplicitValue $Location -EnvVarName "LOCATION" -FileValues $fileValues
$ManagedEnvironmentName = Resolve-Setting -ExplicitValue $ManagedEnvironmentName -EnvVarName "MANAGED_ENVIRONMENT_NAME" -FileValues $fileValues
$ContainerAppName = Resolve-Setting -ExplicitValue $ContainerAppName -EnvVarName "CONTAINER_APP_NAME" -FileValues $fileValues
$StorageAccountName = Resolve-Setting -ExplicitValue $StorageAccountName -EnvVarName "STORAGE_ACCOUNT_NAME" -FileValues $fileValues
$FileShareName = Resolve-Setting -ExplicitValue $FileShareName -EnvVarName "FILE_SHARE_NAME" -FileValues $fileValues
$AcrName = Resolve-Setting -ExplicitValue $AcrName -EnvVarName "ACR_NAME" -FileValues $fileValues
$ImageRepository = Resolve-Setting -ExplicitValue $ImageRepository -EnvVarName "IMAGE_REPOSITORY" -FileValues $fileValues -DefaultValue "openclaw"
$ImageTag = Resolve-Setting -ExplicitValue $ImageTag -EnvVarName "IMAGE_TAG" -FileValues $fileValues
$ContainerImage = Resolve-Setting -ExplicitValue $ContainerImage -EnvVarName "CONTAINER_IMAGE" -FileValues $fileValues
$UserAssignedIdentityName = Resolve-Setting -ExplicitValue $UserAssignedIdentityName -EnvVarName "USER_ASSIGNED_IDENTITY_NAME" -FileValues $fileValues
$GatewayToken = Resolve-Setting -ExplicitValue $GatewayToken -EnvVarName "GATEWAY_TOKEN" -FileValues $fileValues
$OpenAiApiKey = Resolve-Setting -ExplicitValue $OpenAiApiKey -EnvVarName "OPENAI_API_KEY" -FileValues $fileValues -DefaultValue $azureOpenAiApiKey

if ([string]::IsNullOrWhiteSpace($ContainerImage)) {
  Assert-RequiredSettings -Settings @{
    AcrName = $AcrName
    ImageRepository = $ImageRepository
    ImageTag = $ImageTag
  }
}

Assert-RequiredSettings -Settings @{
  ResourceGroup = $ResourceGroup
  Location = $Location
  ManagedEnvironmentName = $ManagedEnvironmentName
  ContainerAppName = $ContainerAppName
  StorageAccountName = $StorageAccountName
  FileShareName = $FileShareName
  UserAssignedIdentityName = $UserAssignedIdentityName
  GatewayToken = $GatewayToken
  OpenAiApiKey = $OpenAiApiKey
}

Initialize-AzureCliContext -RepoRoot $rootDir

$templatePath = Join-Path $scriptDir "containerapp.template.yaml"
$renderedPath = Join-Path $scriptDir "containerapp.rendered.yaml"
$acrId = $null
$acrLoginServer = $null
$registriesBlock = ""

if ([string]::IsNullOrWhiteSpace($ContainerImage)) {
  $acrId = az acr show `
    --name $AcrName `
    --resource-group $ResourceGroup `
    --query id `
    --output tsv 2>$null

  if (-not $acrId) {
    throw "Azure Container Registry '$AcrName' was not found in resource group '$ResourceGroup'. Build the image first or create the registry."
  }

  $acrLoginServer = az acr show `
    --name $AcrName `
    --resource-group $ResourceGroup `
    --query loginServer `
    --output tsv

  $openClawImage = "{0}/{1}:{2}" -f $acrLoginServer, $ImageRepository, $ImageTag
  $registriesBlock = @"
    registries:
      - server: $acrLoginServer
        identity: __USER_ASSIGNED_IDENTITY_RESOURCE_ID__
"@
}
else {
  $openClawImage = $ContainerImage
}

Write-Host "Ensuring Azure Container Apps extension is current..."
az extension add --name containerapp --upgrade | Out-Null

Write-Host "Creating resource group if needed..."
az group create `
  --name $ResourceGroup `
  --location $Location | Out-Null

Write-Host "Creating Container Apps environment if needed..."
$managedEnvironmentId = $null
try {
  $managedEnvironmentId = az containerapp env show `
    --name $ManagedEnvironmentName `
    --resource-group $ResourceGroup `
    --query id `
    --output tsv 2>$null
}
catch {
  $managedEnvironmentId = $null
}

if (-not $managedEnvironmentId) {
  $managedEnvironmentId = az containerapp env create `
    --name $ManagedEnvironmentName `
    --resource-group $ResourceGroup `
    --location $Location `
    --query id `
    --output tsv
}

Write-Host "Creating storage account if needed..."
az storage account create `
  --name $StorageAccountName `
  --resource-group $ResourceGroup `
  --location $Location `
  --sku Standard_LRS `
  --kind StorageV2 | Out-Null

Write-Host "Creating Azure Files share if needed..."
az storage share-rm create `
  --resource-group $ResourceGroup `
  --storage-account $StorageAccountName `
  --name $FileShareName `
  --quota 20 | Out-Null

Write-Host "Enabling ARM audience tokens for ACR managed-identity pulls..."
if (-not [string]::IsNullOrWhiteSpace($acrLoginServer)) {
  az acr config authentication-as-arm update `
    --registry $AcrName `
    --status enabled | Out-Null
}

Write-Host "Creating or reusing user-assigned managed identity..."
$identityResourceId = $null
try {
  $identityResourceId = az identity show `
    --name $UserAssignedIdentityName `
    --resource-group $ResourceGroup `
    --query id `
    --output tsv 2>$null
}
catch {
  $identityResourceId = $null
}

if (-not $identityResourceId) {
  $identityResourceId = az identity create `
    --name $UserAssignedIdentityName `
    --resource-group $ResourceGroup `
    --location $Location `
    --query id `
    --output tsv
}

$identityPrincipalId = az identity show `
  --name $UserAssignedIdentityName `
  --resource-group $ResourceGroup `
  --query principalId `
  --output tsv

Write-Host "Granting AcrPull to the managed identity..."
if (-not [string]::IsNullOrWhiteSpace($acrId)) {
  az role assignment create `
    --assignee-object-id $identityPrincipalId `
    --assignee-principal-type ServicePrincipal `
    --role AcrPull `
    --scope $acrId 2>$null | Out-Null
}

$storageKey = az storage account keys list `
  --resource-group $ResourceGroup `
  --account-name $StorageAccountName `
  --query "[0].value" `
  --output tsv

Write-Host "Linking Azure Files share to the ACA environment..."
az containerapp env storage set `
  --name $ManagedEnvironmentName `
  --resource-group $ResourceGroup `
  --storage-name openclawstate `
  --storage-type AzureFile `
  --azure-file-account-name $StorageAccountName `
  --azure-file-account-key $storageKey `
  --azure-file-share-name $FileShareName `
  --access-mode ReadWrite | Out-Null

Write-Host "Rendering ACA YAML..."
$template = Get-Content $templatePath -Raw
$template = $template.Replace("__LOCATION__", $Location)
$template = $template.Replace("__APP_NAME__", $ContainerAppName)
$template = $template.Replace("__MANAGED_ENVIRONMENT_ID__", $managedEnvironmentId)
$template = $template.Replace("__OPENCLAW_IMAGE__", $openClawImage)
$template = $template.Replace("__REGISTRIES_BLOCK__", $registriesBlock)
$template = $template.Replace("__USER_ASSIGNED_IDENTITY_RESOURCE_ID__", $identityResourceId)
$template = $template.Replace("__GATEWAY_TOKEN__", (ConvertTo-YamlSingleQuoted -Value $GatewayToken))
$template = $template.Replace("__OPENAI_API_KEY__", (ConvertTo-YamlSingleQuoted -Value $OpenAiApiKey))
Set-Content -Path $renderedPath -Value $template -NoNewline -Encoding utf8

Write-Host "Deploying or updating the ACA app..."
$existingApp = $null
try {
  $existingApp = az containerapp show `
    --name $ContainerAppName `
    --resource-group $ResourceGroup `
    --query id `
    --output tsv 2>$null
}
catch {
  $existingApp = $null
}

if ($existingApp) {
  az containerapp update `
    --name $ContainerAppName `
    --resource-group $ResourceGroup `
    --yaml $renderedPath | Out-Null
}
else {
  az containerapp create `
    --name $ContainerAppName `
    --resource-group $ResourceGroup `
    --yaml $renderedPath | Out-Null
}

$fqdn = az containerapp show `
  --name $ContainerAppName `
  --resource-group $ResourceGroup `
  --query properties.configuration.ingress.fqdn `
  --output tsv

Write-Host ""
Write-Host "ACA deployment complete."
Write-Host "Control UI / Gateway URL: https://$fqdn"
Write-Host "Remember to replace controlUi.dangerouslyAllowHostHeaderOriginFallback with an explicit allowedOrigins entry after the first successful deploy."
