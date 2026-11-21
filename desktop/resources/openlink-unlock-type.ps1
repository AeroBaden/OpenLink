# OpenLink remote unlock — stage 2.
# Runs inside the console session on the "WinSta0\Winlogon" desktop, so its
# SendInput reaches the lock screen. Types the credential and presses Enter.
#
#   powershell -File openlink-unlock-type.ps1 -SecretFile C:\ProgramData\OpenLink\secret-xxx.tmp
#
# The secret file is consumed and deleted before any input is sent.

param(
  [Parameter(Mandatory = $true)][string]$SecretFile
)

$ErrorActionPreference = 'Stop'

function Fail([string]$code) {
  Remove-Item $SecretFile -Force -ErrorAction SilentlyContinue
  exit [int]$code
}

if (-not (Test-Path $SecretFile)) { exit 10 }

try {
  $secret = [System.IO.File]::ReadAllText($SecretFile, [System.Text.Encoding]::UTF8)
} catch {
  exit 11
}
Remove-Item $SecretFile -Force -ErrorAction SilentlyContinue
if ([string]::IsNullOrEmpty($secret)) { exit 12 }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class OLType
{
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Explicit)]
    struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public INPUTUNION u; }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint n, INPUT[] inputs, int size);

    [DllImport("user32.dll")]
    static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool SetThreadDesktop(IntPtr desktop);

    [DllImport("user32.dll")]
    static extern bool CloseDesktop(IntPtr desktop);

    public static bool AttachToInputDesktop()
    {
        // GENERIC_ALL = 0x10000000; the lock screen desktop must be current for
        // SendInput to reach it even when started with lpDesktop=Winlogon.
        IntPtr desk = OpenInputDesktop(0, false, 0x10000000);
        if (desk == IntPtr.Zero) return true; // already on the right desktop
        bool ok = SetThreadDesktop(desk);
        CloseDesktop(desk);
        return ok;
    }

    static void UnicodeChar(char c)
    {
        var down = new INPUT[1];
        down[0].type = 1;
        down[0].u.ki.wScan = c;
        down[0].u.ki.dwFlags = 0x0004;
        SendInput(1, down, Marshal.SizeOf(typeof(INPUT)));

        var up = new INPUT[1];
        up[0].type = 1;
        up[0].u.ki.wScan = c;
        up[0].u.ki.dwFlags = 0x0004 | 0x0002;
        SendInput(1, up, Marshal.SizeOf(typeof(INPUT)));
        Thread.Sleep(12);
    }

    static void VirtualKey(ushort vk)
    {
        var down = new INPUT[1];
        down[0].type = 1;
        down[0].u.ki.wVk = vk;
        SendInput(1, down, Marshal.SizeOf(typeof(INPUT)));
        Thread.Sleep(10);
        var up = new INPUT[1];
        up[0].type = 1;
        up[0].u.ki.wVk = vk;
        up[0].u.ki.dwFlags = 0x0002;
        SendInput(1, up, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void TypeSecret(string text)
    {
        AttachToInputDesktop();
        Thread.Sleep(500);
        foreach (char c in text) UnicodeChar(c);
        Thread.Sleep(250);
        VirtualKey(0x0D); // Enter
    }
}
'@ -ErrorAction Stop

try {
  [OLType]::TypeSecret($secret)
  exit 0
} catch {
  exit 13
} finally {
  $secret = $null
}
