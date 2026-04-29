Set-StrictMode -Version Latest
$PSNativeCommandUseErrorActionPreference = $true

function Test-CommandAvailable {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  return $null -ne (Get-Command -Name $Name -ErrorAction SilentlyContinue)
}

function Ensure-Directory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }

  return $Path
}

function Read-SimpleEnvFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $values = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $values
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#")) {
      continue
    }

    $separatorIndex = $trimmed.IndexOf("=")
    if ($separatorIndex -lt 1) {
      continue
    }

    $key = $trimmed.Substring(0, $separatorIndex).Trim()
    $value = $trimmed.Substring($separatorIndex + 1).Trim()

    if (
      $value.Length -ge 2 -and
      (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    $values[$key] = $value
  }

  return $values
}

function Resolve-Setting {
  param(
    [AllowEmptyString()]
    [string]$ExplicitValue,

    [Parameter(Mandatory = $true)]
    [string]$EnvVarName,

    [hashtable]$FileValues = @{},

    [AllowEmptyString()]
    [string]$DefaultValue = ""
  )

  if (-not [string]::IsNullOrWhiteSpace($ExplicitValue)) {
    return $ExplicitValue
  }

  $envValue = [Environment]::GetEnvironmentVariable($EnvVarName)
  if (-not [string]::IsNullOrWhiteSpace($envValue)) {
    return $envValue
  }

  if ($FileValues.ContainsKey($EnvVarName) -and -not [string]::IsNullOrWhiteSpace($FileValues[$EnvVarName])) {
    return [string]$FileValues[$EnvVarName]
  }

  return $DefaultValue
}

function Assert-RequiredSettings {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Settings
  )

  $missing = @(
    foreach ($name in $Settings.Keys) {
      if ([string]::IsNullOrWhiteSpace([string]$Settings[$name])) {
        $name
      }
    }
  )

  if ($missing.Count -gt 0) {
    throw "Missing required settings: $($missing -join ', ')"
  }
}

function Test-PlaceholderValue {
  param(
    [AllowEmptyString()]
    [string]$Value,

    [string[]]$PlaceholderValues = @()
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $true
  }

  return $PlaceholderValues -contains $Value
}

function Initialize-AzureCliContext {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
  )

  if (-not (Test-CommandAvailable -Name "az")) {
    throw "Azure CLI ('az') is not installed or not available on PATH."
  }

  $originalAzureConfigDir = $env:AZURE_CONFIG_DIR
  $localAzureConfigDir = Ensure-Directory -Path (Join-Path $RepoRoot ".azure")

  function Test-AzureLoginContext {
    try {
      az account show --output none 2>$null | Out-Null
    }
    catch {
      return $false
    }

    return $LASTEXITCODE -eq 0
  }

  if (-not [string]::IsNullOrWhiteSpace($originalAzureConfigDir)) {
    if (-not (Test-AzureLoginContext)) {
      throw "Azure CLI is available, but the active login context in AZURE_CONFIG_DIR '$originalAzureConfigDir' is not usable. Run 'az login' for that profile or point AZURE_CONFIG_DIR to a signed-in Azure CLI profile."
    }

    return
  }

  if (Test-AzureLoginContext) {
    return
  }

  $env:AZURE_CONFIG_DIR = $localAzureConfigDir
  if (-not (Test-AzureLoginContext)) {
    throw "Azure CLI is available, but no active login context was found. Run 'az login' first."
  }
}

function ConvertTo-YamlSingleQuoted {
  param(
    [AllowEmptyString()]
    [string]$Value
  )

  return "'{0}'" -f ([string]$Value).Replace("'", "''")
}
