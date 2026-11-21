# OpenLink media bridge — Windows 10/11 GlobalSystemMediaTransportControls.
#
#   powershell -File openlink-media.ps1                 # watch mode, JSON line every 2 s
#   powershell -File openlink-media.ps1 -Command playpause
#   powershell -File openlink-media.ps1 -Command seek -Position 42.5
#
# Watch mode prints one compact JSON object per line and exits when stdin closes.

param(
  [string]$Command = 'watch',
  [double]$Position = 0
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop

  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]

  if (-not $asTaskGeneric) { throw 'WinRT async bridge unavailable' }

  function Await($operation, $resultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
    $task = $asTask.Invoke($null, @($operation))
    $task.Wait(-1) | Out-Null
    $task.Result
  }

  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSession, Windows.Media.Control, ContentType = WindowsRuntime]
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackInfo, Windows.Media.Control, ContentType = WindowsRuntime]

  function Get-SessionManager {
    Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  }

  if ($Command -ne 'watch') {
    $manager = Get-SessionManager
    $session = $manager.GetCurrentSession()
    if ($null -eq $session) { '{"ok":false,"error":"no active session"}'; exit 0 }
    $ok = $false
    switch ($Command) {
      'playpause' {
        if ($session.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') { $ok = Await ($session.TryPauseAsync()) ([bool]) }
        else { $ok = Await ($session.TryPlayAsync()) ([bool]) }
      }
      'next' { $ok = Await ($session.TrySkipNextAsync()) ([bool]) }
      'prev' { $ok = Await ($session.TrySkipPreviousAsync()) ([bool]) }
      'seek' {
        $ts = [TimeSpan]::FromSeconds([Math]::Max(0, $Position))
        $ok = Await ($session.TryChangePlaybackPositionAsync($ts.Ticks)) ([bool])
      }
      default { throw "unknown media command: $Command" }
    }
    (@{ ok = [bool]$ok } | ConvertTo-Json -Compress)
    exit 0
  }

  $last = ''
  while ($true) {
    try {
      $manager = Get-SessionManager
      $session = $manager.GetCurrentSession()
      if ($null -eq $session) {
        $payload = @{ ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); title = ''; artist = ''; app = ''; playing = $false; positionS = 0; durationS = 0 }
      } else {
        $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $info = $session.GetPlaybackInfo()
        $timeline = $session.GetTimelineProperties()
        $payload = @{
          ts        = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
          title     = [string]$props.Title
          artist    = [string]$props.Artist
          app       = [string]$session.SourceAppUserModelId
          playing   = ($info.PlaybackStatus.ToString() -eq 'Playing')
          positionS = [Math]::Round($timeline.Position.TotalSeconds, 1)
          durationS = [Math]::Round($timeline.EndTime.TotalSeconds, 1)
        }
      }
      $json = $payload | ConvertTo-Json -Compress
      if ($json -ne $last) {
        [Console]::Out.WriteLine($json)
        [Console]::Out.Flush()
        $last = $json
      }
    } catch {
      $err = @{ ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); title = ''; artist = ''; app = ''; playing = $false; positionS = 0; durationS = 0; error = $_.Exception.Message } | ConvertTo-Json -Compress
      if ($err -ne $last) { [Console]::Out.WriteLine($err); [Console]::Out.Flush(); $last = $err }
    }
    Start-Sleep -Milliseconds 2000
  }
} catch {
  (@{ ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); title = ''; artist = ''; app = ''; playing = $false; positionS = 0; durationS = 0; error = $_.Exception.Message } | ConvertTo-Json -Compress)
  exit 0
}
