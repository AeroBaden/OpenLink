# OpenLink remote unlock — stage 1 (runs as SYSTEM via the "OpenLinkUnlock" task).
#
# Windows does not let a normal process type into the secure Winlogon desktop.
# This helper therefore:
#   1. verifies the console session is actually locked (LogonUI.exe present),
#   2. decrypts the machine-scope DPAPI credential blob,
#   3. duplicates the session's winlogon.exe token and spawns stage 2 on
#      "WinSta0\Winlogon" with that credential in a SYSTEM-only temp file.
#
#   powershell -File openlink-unlock.ps1
#
# Requires: the "OpenLinkUnlock" scheduled task (created by OpenLink enrollment,
# which needs one-time administrator rights) and the credential blob written by
# the app to %ProgramData%\OpenLink\unlock.dat.

$ErrorActionPreference = 'Stop'
$logDir = Join-Path $env:ProgramData 'OpenLink'
$logFile = Join-Path $logDir 'unlock.log'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log([string]$message) {
  $line = "$(Get-Date -Format o) $message"
  Add-Content -Path $logFile -Value $line -Encoding UTF8
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class OLWinlogon
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    public const int CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    public const int CREATE_NO_WINDOW = 0x08000000;
    public const uint TOKEN_ALL_ACCESS = 0xF01FF;
    public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    [DllImport("kernel32.dll")]
    public static extern uint WTSGetActiveConsoleSessionId();

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool DuplicateTokenEx(IntPtr existing, uint access, IntPtr attrs, int impersonationLevel, int tokenType, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool CreateProcessAsUser(
        IntPtr token, string app, string cmdline, IntPtr procAttrs, IntPtr threadAttrs,
        bool inherit, int flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);

    [DllImport("userenv.dll", SetLastError = true)]
    public static extern bool CreateEnvironmentBlock(out IntPtr env, IntPtr token, bool inherit);

    [DllImport("userenv.dll")]
    public static extern bool DestroyEnvironmentBlock(IntPtr env);

    [DllImport("kernel32.dll")]
    public static extern uint WaitForSingleObject(IntPtr handle, uint ms);

    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll")]
    public static extern bool GetExitCodeProcess(IntPtr process, out uint code);

    [DllImport("kernel32.dll")]
    public static extern bool ProcessIdToSessionId(uint pid, out uint sessionId);
}
'@ -ErrorAction Stop

try {
  $blobPath = Join-Path $logDir 'unlock.dat'
  if (-not (Test-Path $blobPath)) { Write-Log 'no credential blob'; exit 2 }

  $sessionId = [OLWinlogon]::WTSGetActiveConsoleSessionId()
  if ($sessionId -eq 0xFFFFFFFF) { Write-Log 'no active console session'; exit 3 }

  $logonui = @(Get-Process -Name LogonUI -ErrorAction SilentlyContinue |
      Where-Object { $_.SessionId -eq $sessionId })
  if ($logonui.Count -eq 0) { Write-Log 'session not locked (no LogonUI); refusing to inject'; exit 4 }

  $winlogon = @(Get-Process -Name winlogon -ErrorAction SilentlyContinue |
      Where-Object { $_.SessionId -eq $sessionId } | Select-Object -First 1)
  if ($winlogon.Count -eq 0) { Write-Log 'winlogon.exe not found in console session'; exit 5 }

  # Machine-scope DPAPI blob written by the app at enrollment time.
  $entropy = [System.Text.Encoding]::UTF8.GetBytes('OpenLink-Unlock-v1')
  $cipher = [System.IO.File]::ReadAllBytes($blobPath)
  $plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $cipher, $entropy, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
  $secret = [System.Text.Encoding]::UTF8.GetString($plain)
  if ([string]::IsNullOrEmpty($secret)) { Write-Log 'empty credential'; exit 6 }

  $secretFile = Join-Path $logDir ("secret-$([Guid]::NewGuid().ToString('N')).tmp")
  [System.IO.File]::WriteAllText($secretFile, $secret, [System.Text.Encoding]::UTF8)
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        'SYSTEM', 'FullControl', 'Allow')))
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        'Administrators', 'FullControl', 'Allow')))
  Set-Acl -Path $secretFile -AclObject $acl

  $typeScript = Join-Path $PSScriptRoot 'openlink-unlock-type.ps1'
  $cmdline = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$typeScript`" -SecretFile `"$secretFile`""

  $hProc = [OLWinlogon]::OpenProcess([OLWinlogon]::PROCESS_QUERY_LIMITED_INFORMATION, $false, $winlogon.Id)
  if ($hProc -eq [IntPtr]::Zero) { throw "OpenProcess failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }

  $hToken = [IntPtr]::Zero
  if (-not [OLWinlogon]::OpenProcessToken($hProc, [OLWinlogon]::TOKEN_ALL_ACCESS, [ref]$hToken)) {
    throw "OpenProcessToken failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }

  $hDup = [IntPtr]::Zero
  # SecurityImpersonation = 2, TokenPrimary = 1
  if (-not [OLWinlogon]::DuplicateTokenEx($hToken, [OLWinlogon]::TOKEN_ALL_ACCESS, [IntPtr]::Zero, 2, 1, [ref]$hDup)) {
    throw "DuplicateTokenEx failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }

  $envBlock = [IntPtr]::Zero
  [void][OLWinlogon]::CreateEnvironmentBlock([ref]$envBlock, $hDup, $false)

  $si = New-Object OLWinlogon+STARTUPINFO
  $si.cb = [System.Runtime.InteropServices.Marshal]::SizeOf($si)
  $si.lpDesktop = 'WinSta0\Winlogon'
  $pi = New-Object OLWinlogon+PROCESS_INFORMATION

  $ok = [OLWinlogon]::CreateProcessAsUser(
    $hDup, $null, $cmdline, [IntPtr]::Zero, [IntPtr]::Zero, $false,
    ([OLWinlogon]::CREATE_UNICODE_ENVIRONMENT -bor [OLWinlogon]::CREATE_NO_WINDOW),
    $envBlock, $null, [ref]$si, [ref]$pi)

  if (-not $ok) { throw "CreateProcessAsUser failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }

  [void][OLWinlogon]::WaitForSingleObject($pi.hProcess, 15000)
  $exit = 0
  [void][OLWinlogon]::GetExitCodeProcess($pi.hProcess, [ref]$exit)
  Write-Log "stage 2 finished with exit $exit"

  foreach ($h in @($pi.hProcess, $pi.hThread, $hDup, $hToken, $hProc)) {
    if ($h -and $h -ne [IntPtr]::Zero) { [void][OLWinlogon]::CloseHandle($h) }
  }
  if ($envBlock -ne [IntPtr]::Zero) { [void][OLWinlogon]::DestroyEnvironmentBlock($envBlock) }
  if (Test-Path $secretFile) { Remove-Item $secretFile -Force }

  if ($exit -ne 0) { exit 7 }
  Write-Log 'unlock injected'
  exit 0
} catch {
  Write-Log "error: $($_.Exception.Message)"
  exit 1
}
