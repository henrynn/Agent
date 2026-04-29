param(
  [string]$EnvFile = "",

  [ValidateSet("local", "cloud", "all")]
  [string]$Target = "all"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
. (Join-Path $repoRoot "deploy\openclaw\common.ps1")

function ConvertTo-Json5DoubleQuoted {
  param(
    [AllowEmptyString()]
    [string]$Value
  )

  $escaped = [string]$Value
  $escaped = $escaped.Replace("\", "\\")
  $escaped = $escaped.Replace('"', '\"')
  return '"' + $escaped + '"'
}

function Resolve-EnvSetting {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,

    [hashtable]$FileValues = @{},

    [string]$DefaultValue = ""
  )

  return Resolve-Setting -ExplicitValue "" -EnvVarName $Name -FileValues $FileValues -DefaultValue $DefaultValue
}

function Render-LocalConfig {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$ModelSettings
  )

  return @"
{
  gateway: {
    bind: "lan",
    port: 18789,
    auth: {
      mode: "token",
    },
    controlUi: {
      allowedOrigins: [
        "http://127.0.0.1:18789",
        "http://localhost:18789",
      ],
    },
    http: {
      endpoints: {
        responses: {
          enabled: true,
        },
      },
    },
  },

  models: {
    mode: "merge",
    providers: {
      $($ModelSettings.ProviderId): {
        api: $($ModelSettings.ProviderApi),
        baseUrl: $($ModelSettings.BaseUrl),
        apiKey: $($ModelSettings.ApiKeyRef),
        models: [
          {
            id: $($ModelSettings.ModelId),
            name: $($ModelSettings.ModelId),
            reasoning: true,
          },
        ],
      },
    },
  },

  agents: {
    defaults: {
      workspace: "/mnt/openclaw/workspace",
      model: {
        primary: $($ModelSettings.PrimaryModel),
      },
      thinkingDefault: $($ModelSettings.ReasoningEffort),
      sandbox: {
        mode: "all",
        backend: "docker",
        scope: "agent",
        workspaceAccess: "rw",
      },
    },
  },

  tools: {
    profile: "coding",
  },
}
"@
}

function Render-CloudConfig {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$ModelSettings
  )

  return @"
{
  gateway: {
    mode: "local",
    // ACA wrapper image terminates the public listener on 18789 and forwards
    // traffic to the in-container gateway port below. Keeping the inner gateway
    // on a separate port avoids the current bind-to-loopback issue.
    bind: "lan",
    port: 18790,
    auth: {
      mode: "token",
    },
    controlUi: {
      // ACA gives you a default public FQDN only after the app is created.
      // For the first MVP deploy we allow Host-header fallback so the Control UI
      // can boot before you pin an explicit origin. Tighten this after first deploy.
      dangerouslyAllowHostHeaderOriginFallback: true,
    },
    http: {
      endpoints: {
        responses: {
          enabled: true,
        },
      },
    },
  },

  models: {
    mode: "merge",
    providers: {
      $($ModelSettings.ProviderId): {
        api: $($ModelSettings.ProviderApi),
        baseUrl: $($ModelSettings.BaseUrl),
        apiKey: $($ModelSettings.ApiKeyRef),
        models: [
          {
            id: $($ModelSettings.ModelId),
            name: $($ModelSettings.ModelId),
            reasoning: true,
          },
        ],
      },
    },
  },

  agents: {
    defaults: {
      workspace: "/tmp/openclaw/workspace",
      model: {
        primary: $($ModelSettings.PrimaryModel),
      },
      thinkingDefault: $($ModelSettings.ReasoningEffort),
      sandbox: {
        // ACA does not expose a host Docker daemon, so the Docker backend is not viable here.
        mode: "off",
      },
    },
  },

  tools: {
    profile: "coding",
  },
}
"@
}

if ([string]::IsNullOrWhiteSpace($EnvFile)) {
  $EnvFile = Join-Path $repoRoot "deploy\openclaw\.env.cloud"
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  throw "Env file '$EnvFile' does not exist."
}

$envValues = Read-SimpleEnvFile -Path $EnvFile
$providerIdValue = Resolve-EnvSetting -Name "OPENCLAW_MODEL_PROVIDER" -FileValues $envValues -DefaultValue "azure"
$modelIdValue = Resolve-EnvSetting -Name "OPENCLAW_MODEL_NAME" -FileValues $envValues -DefaultValue "gpt-5.4"
$reasoningEffortValue = Resolve-EnvSetting -Name "OPENCLAW_MODEL_REASONING_EFFORT" -FileValues $envValues -DefaultValue "medium"
$baseUrlValue = Resolve-EnvSetting -Name "OPENCLAW_BASE_URL" -FileValues $envValues -DefaultValue "https://smartapims.azure-api.net/openai"
$wireApiValue = Resolve-EnvSetting -Name "OPENCLAW_WIRE_API" -FileValues $envValues -DefaultValue "responses"
$apiKeyEnvVar = Resolve-EnvSetting -Name "OPENCLAW_ENV_KEY" -FileValues $envValues -DefaultValue "AZURE_OPENAI_API_KEY"
$apiKeyValue = Resolve-EnvSetting -Name $apiKeyEnvVar -FileValues $envValues

Assert-RequiredSettings -Settings @{
  OPENCLAW_MODEL_PROVIDER = $providerIdValue
  OPENCLAW_MODEL_NAME = $modelIdValue
  OPENCLAW_MODEL_REASONING_EFFORT = $reasoningEffortValue
  OPENCLAW_BASE_URL = $baseUrlValue
  OPENCLAW_WIRE_API = $wireApiValue
  OPENCLAW_ENV_KEY = $apiKeyEnvVar
  ApiKey = $apiKeyValue
}

$providerApiValue = switch ("$providerIdValue::$wireApiValue") {
  # Our APIM endpoint exposes the OpenAI-compatible /openai/responses surface,
  # so Azure-backed deployments must use the generic Responses provider wiring.
  "azure::responses" { "openai-responses"; break }
  "openai::responses" { "openai-responses"; break }
  default {
    throw "Unsupported OpenClaw model provider/wire API combination: provider='$providerIdValue', wire_api='$wireApiValue'."
  }
}

$modelSettings = @{
  ProviderId = $providerIdValue
  ProviderApi = ConvertTo-Json5DoubleQuoted -Value $providerApiValue
  BaseUrl = ConvertTo-Json5DoubleQuoted -Value $baseUrlValue
  ModelId = ConvertTo-Json5DoubleQuoted -Value $modelIdValue
  PrimaryModel = ConvertTo-Json5DoubleQuoted -Value ("{0}/{1}" -f $providerIdValue, $modelIdValue)
  ReasoningEffort = ConvertTo-Json5DoubleQuoted -Value $reasoningEffortValue
  ApiKeyRef = ConvertTo-Json5DoubleQuoted -Value ("`${{{0}}}" -f $apiKeyEnvVar)
}

$localConfigPath = Join-Path $repoRoot "openclaw\config\openclaw.local.json5"
$cloudConfigPath = Join-Path $repoRoot "openclaw\config\openclaw.cloud.aca.json5"

if ($Target -in @("local", "all")) {
  Set-Content -LiteralPath $localConfigPath -Value (Render-LocalConfig -ModelSettings $modelSettings) -Encoding utf8NoBOM
  Write-Host "Rendered $localConfigPath"
}

if ($Target -in @("cloud", "all")) {
  Set-Content -LiteralPath $cloudConfigPath -Value (Render-CloudConfig -ModelSettings $modelSettings) -Encoding utf8NoBOM
  Write-Host "Rendered $cloudConfigPath"
}
