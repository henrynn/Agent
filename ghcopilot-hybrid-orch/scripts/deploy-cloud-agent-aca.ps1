param(
  [Parameter(Mandatory = $true)] [string] $SubscriptionId,
  [Parameter(Mandatory = $true)] [string] $ResourceGroup,
  [Parameter(Mandatory = $true)] [string] $Location,
  [Parameter(Mandatory = $true)] [string] $ContainerAppEnvironment,
  [Parameter(Mandatory = $true)] [string] $ContainerAppName,
  [Parameter(Mandatory = $true)] [string] $AcrName,
  [string] $ImageName = 'hybrid-cloud-agent',
  [string] $ImageTag = 'latest',
  [string] $CopilotGitHubToken = '',
  [string] $CloudCopilotModel = 'auto'
)

$ErrorActionPreference = 'Stop'

az account set --subscription $SubscriptionId | Out-Null
az group create --name $ResourceGroup --location $Location | Out-Null
az acr create --resource-group $ResourceGroup --name $AcrName --sku Basic --admin-enabled true | Out-Null
az containerapp env create --name $ContainerAppEnvironment --resource-group $ResourceGroup --location $Location | Out-Null

az acr build --registry $AcrName --image "$ImageName`:$ImageTag" --file apps/cloud-agent/Dockerfile . | Out-Null

$acr = az acr show --name $AcrName --resource-group $ResourceGroup | ConvertFrom-Json
$credentials = az acr credential show --name $AcrName | ConvertFrom-Json
$registryServer = $acr.loginServer
$registryUser = $credentials.username
$registryPassword = $credentials.passwords[0].value
$imageRef = "$registryServer/$ImageName`:$ImageTag"

$exists = az containerapp show --name $ContainerAppName --resource-group $ResourceGroup --only-show-errors 2>$null

if ($LASTEXITCODE -eq 0) {
  az containerapp update `
    --name $ContainerAppName `
    --resource-group $ResourceGroup `
    --image $imageRef `
    --set-env-vars PORT=8787 ACA_LOCATION=$Location CLOUD_COPILOT_MODEL=$CloudCopilotModel COPILOT_GITHUB_TOKEN=$CopilotGitHubToken | Out-Null
}
else {
  az containerapp create `
    --name $ContainerAppName `
    --resource-group $ResourceGroup `
    --environment $ContainerAppEnvironment `
    --image $imageRef `
    --target-port 8787 `
    --ingress external `
    --registry-server $registryServer `
    --registry-username $registryUser `
    --registry-password $registryPassword `
    --cpu 0.5 `
    --memory 1Gi `
    --min-replicas 0 `
    --max-replicas 2 `
    --env-vars PORT=8787 ACA_LOCATION=$Location CLOUD_COPILOT_MODEL=$CloudCopilotModel COPILOT_GITHUB_TOKEN=$CopilotGitHubToken | Out-Null
}

$fqdn = az containerapp show --name $ContainerAppName --resource-group $ResourceGroup --query properties.configuration.ingress.fqdn -o tsv
Write-Host "Cloud agent deployed to: https://$fqdn"