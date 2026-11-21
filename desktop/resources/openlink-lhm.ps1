# OpenLink LibreHardwareMonitor bridge.
# Reads the WMI namespace that LibreHardwareMonitor exposes when started with
#   "Options > WMI provider" enabled (default once LHM has run as admin).
# Prints a single JSON object; nulls mean "this machine cannot report it".
#
#   powershell -File openlink-lhm.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Empty-Reading {
  [pscustomobject]@{
    cpuTemp = $null; cpuPower = $null; cpuFan = $null
    gpuTemp = $null; gpuHotspot = $null; gpuPower = $null; gpuFan = $null
  } | ConvertTo-Json -Compress
}

try {
  $ns = 'root/librehardwaremonitor'
  $sensors = Get-CimInstance -Namespace $ns -ClassName Sensor -ErrorAction Stop
  if (-not $sensors) { Empty-Reading; exit 0 }

  $list = @($sensors)

  function Pick([string]$type, [string[]]$identPatterns, [string[]]$namePatterns, [switch]$Max) {
    $candidates = $list | Where-Object {
      $_.SensorType -eq $type -and $_.Value -ne $null -and [double]$_.Value -gt 0
    } | Where-Object {
      $id = [string]$_.Identifier
      $name = [string]$_.Name
      $hit = $false
      foreach ($p in $identPatterns) { if ($id -match $p) { $hit = $true } }
      foreach ($p in $namePatterns) { if ($name -match $p) { $hit = $true } }
      $hit
    }
    if (-not $candidates) { return $null }
    if ($Max) {
      return [Math]::Round((($candidates | Measure-Object -Property Value -Maximum).Maximum), 1)
    }
    return [Math]::Round([double]($candidates | Select-Object -First 1).Value, 1)
  }

  $cpuTemp = Pick 'Temperature' @('/intelcpu/0', '/amdcpu/0') @('CPU Package', 'Core \(Tctl', 'CCD1', 'CPU Core')
  if (-not $cpuTemp) {
    $cpuTemp = Pick 'Temperature' @('/intelcpu/0', '/amdcpu/0') @('Core') -Max
  }
  $cpuPower = Pick 'Power' @('/intelcpu/0/package', '/amdcpu/0/package') @('Package', 'CPU Package')
  $cpuFan = Pick 'Fan' @('/lpc/') @('CPU Fan', 'CPU_FAN')
  if (-not $cpuFan) { $cpuFan = Pick 'Fan' @('') @('') -Max }

  $gpuTemp = Pick 'Temperature' @('/gpu-nvidia/0', '/gpu-amd/0', '/gpu-intel/0') @('GPU Core', 'GPU Temperature', 'Hot Spot')
  $gpuHotspot = Pick 'Temperature' @('/gpu-nvidia/0') @('Hot Spot')
  $gpuPower = Pick 'Power' @('/gpu-nvidia/0', '/gpu-amd/0') @('GPU Package', 'GPU Power', 'PPT')
  $gpuFan = Pick 'Fan' @('/gpu-nvidia/0', '/gpu-amd/0') @('GPU Fan', 'GPU')

  [pscustomobject]@{
    cpuTemp = $cpuTemp; cpuPower = $cpuPower; cpuFan = $cpuFan
    gpuTemp = $gpuTemp; gpuHotspot = $gpuHotspot; gpuPower = $gpuPower; gpuFan = $gpuFan
  } | ConvertTo-Json -Compress
} catch {
  Empty-Reading
  exit 0
}
