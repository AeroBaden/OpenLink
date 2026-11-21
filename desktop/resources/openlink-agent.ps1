# OpenLink Windows agent
# Long-lived helper: reads one JSON request per line on stdin, writes one JSON
# response per line on stdout. Kept alive so trackpad moves and key taps have
# ~5 ms latency instead of paying PowerShell startup each time.
#
#   {"id":1,"cmd":"volume.get"}
#   {"id":2,"cmd":"keys","keys":"ctrl+shift+m"}
#   {"id":3,"cmd":"text","text":"Grüße"}
#   {"id":4,"cmd":"pointer","event":{"kind":"move","dx":12,"dy":-4}}
#   {"id":5,"cmd":"power","action":"lock"}
#
# Requires Windows PowerShell 5.1 (shipped with Windows 10/11).

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try { [Console]::InputEncoding = [System.Text.Encoding]::UTF8 } catch { }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class OLSend
{
    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public INPUTUNION u; }

    const uint INPUT_MOUSE = 0;
    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;
    const uint MOUSEEVENTF_MOVE = 0x0001;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    const uint MOUSEEVENTF_WHEEL = 0x0800;
    const uint MOUSEEVENTF_HWHEEL = 0x01000;

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    [DllImport("powrprof.dll", SetLastError = true)]
    static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent);
    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    static extern short VkKeyScan(char ch);

    public static short VkKeyScanForChar(char ch) { return VkKeyScan(ch); }

    static INPUT Mouse() { return new INPUT { type = INPUT_MOUSE }; }
    static INPUT Key() { return new INPUT { type = INPUT_KEYBOARD }; }

    public static void Move(int dx, int dy)
    {
        var a = new INPUT[1];
        a[0] = Mouse();
        a[0].u.mi.dx = dx;
        a[0].u.mi.dy = dy;
        a[0].u.mi.dwFlags = MOUSEEVENTF_MOVE;
        SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void Click(string button, int count)
    {
        for (int i = 0; i < Math.Max(1, count); i++)
        {
            uint down = MOUSEEVENTF_LEFTDOWN, up = MOUSEEVENTF_LEFTUP;
            if (button == "right") { down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP; }
            else if (button == "middle") { down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; }
            var a = new INPUT[2];
            a[0] = Mouse(); a[0].u.mi.dwFlags = down;
            a[1] = Mouse(); a[1].u.mi.dwFlags = up;
            SendInput(2, a, Marshal.SizeOf(typeof(INPUT)));
        }
    }

    public static void Button(string button, bool down)
    {
        uint flag = MOUSEEVENTF_LEFTDOWN;
        if (button == "right") flag = down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
        else flag = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
        var a = new INPUT[1];
        a[0] = Mouse(); a[0].u.mi.dwFlags = flag;
        SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void Scroll(int dx, int dy)
    {
        if (dy != 0)
        {
            var a = new INPUT[1];
            a[0] = Mouse(); a[0].u.mi.dwFlags = MOUSEEVENTF_WHEEL; a[0].u.mi.mouseData = (uint)(-dy * 120);
            SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
        }
        if (dx != 0)
        {
            var a = new INPUT[1];
            a[0] = Mouse(); a[0].u.mi.dwFlags = MOUSEEVENTF_HWHEEL; a[0].u.mi.mouseData = (uint)(dx * 120);
            SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
        }
    }

    public static void VirtualKey(ushort vk, bool up)
    {
        var a = new INPUT[1];
        a[0] = Key();
        a[0].u.ki.wVk = vk;
        a[0].u.ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
        SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void Combo(ushort[] mods, ushort key)
    {
        foreach (var m in mods) VirtualKey(m, false);
        VirtualKey(key, false);
        VirtualKey(key, true);
        for (int i = mods.Length - 1; i >= 0; i--) VirtualKey(mods[i], true);
    }

    public static void Unicode(string text)
    {
        foreach (char c in text)
        {
            var down = new INPUT[1];
            down[0] = Key();
            down[0].u.ki.wScan = c;
            down[0].u.ki.dwFlags = KEYEVENTF_UNICODE;
            SendInput(1, down, Marshal.SizeOf(typeof(INPUT)));

            var up = new INPUT[1];
            up[0] = Key();
            up[0].u.ki.wScan = c;
            up[0].u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
            SendInput(1, up, Marshal.SizeOf(typeof(INPUT)));
        }
    }

    public static void MonitorOff()
    {
        SendMessage(new IntPtr(0xffff), 0x0112, new IntPtr(0xF170), new IntPtr(2));
    }

    public static void Sleep()
    {
        SetSuspendState(false, false, false);
    }
}
'@ -ErrorAction Stop

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class OLSound
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorComObject { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        int NotImpl1();
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume
    {
        int NotImpl1();
        int NotImpl2();
        int GetChannelCount(out uint channelCount);
        int SetMasterVolumeLevel(float level, ref Guid context);
        int SetMasterVolumeLevelScalar(float level, ref Guid context);
        int GetMasterVolumeLevel(out float level);
        int GetMasterVolumeLevelScalar(out float level);
        int SetChannelVolumeLevel(uint channel, float level, ref Guid context);
        int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
        int GetChannelVolumeLevel(uint channel, out float level);
        int GetChannelVolumeLevelScalar(uint channel, out float level);
        int SetMute(bool mute, ref Guid context);
        int GetMute(out bool mute);
    }

    static IAudioEndpointVolume Endpoint()
    {
        var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
        IMMDevice device;
        enumerator.GetDefaultAudioEndpoint(0, 1, out device);
        Guid iid = typeof(IAudioEndpointVolume).GUID;
        object o;
        device.Activate(ref iid, 23, IntPtr.Zero, out o);
        return (IAudioEndpointVolume)o;
    }

    public static float GetVolume()
    {
        float v;
        Endpoint().GetMasterVolumeLevelScalar(out v);
        return v;
    }

    public static bool GetMute()
    {
        bool m;
        Endpoint().GetMute(out m);
        return m;
    }

    public static void SetVolume(float scalar)
    {
        Guid g = Guid.Empty;
        Endpoint().SetMasterVolumeLevelScalar(Math.Min(1f, Math.Max(0f, scalar)), ref g);
    }

    public static void SetMute(bool mute)
    {
        Guid g = Guid.Empty;
        Endpoint().SetMute(mute, ref g);
    }
}
'@ -ErrorAction Stop

function Get-VirtualKey([string]$name) {
    $n = $name.ToLowerInvariant()
    $map = @{
        'ctrl' = 0x11; 'control' = 0x11; 'shift' = 0x10; 'alt' = 0x12; 'win' = 0x5B; 'meta' = 0x5B
        'enter' = 0x0D; 'return' = 0x0D; 'tab' = 0x09; 'esc' = 0x1B; 'escape' = 0x1B; 'space' = 0x20
        'backspace' = 0x08; 'delete' = 0x2E; 'del' = 0x2E; 'insert' = 0x2D
        'up' = 0x26; 'down' = 0x28; 'left' = 0x25; 'right' = 0x27
        'home' = 0x24; 'end' = 0x23; 'pageup' = 0x21; 'pagedown' = 0x22
        'capslock' = 0x14; 'printscreen' = 0x2C; 'pause' = 0x13
        'media-playpause' = 0xB3; 'media-stop' = 0xB2; 'media-next' = 0xB0; 'media-prev' = 0xB1
        'media-mute' = 0xAD; 'volume-up' = 0xAF; 'volume-down' = 0xAE
        'mic-mute' = 0xAD
    }
    if ($map.ContainsKey($n)) { return [uint16]$map[$n] }
    if ($n -match '^f([1-9]|1[0-9]|2[0-4])$') { return [uint16](0x70 + [int]$Matches[1] - 1) }
    if ($n.Length -eq 1) {
        $vk = [OLSend]::VkKeyScanForChar($n[0])
        return [uint16]($vk -band 0xFF)
    }
    throw "Unknown key: $name"
}

function Invoke-Keys([string]$combo) {
    $parts = $combo.ToLowerInvariant().Split('+') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    if ($parts.Count -eq 0) { throw 'empty key combo' }
    $mods = @()
    for ($i = 0; $i -lt $parts.Count - 1; $i++) {
        switch ($parts[$i]) {
            'ctrl' { $mods += 0x11 }
            'control' { $mods += 0x11 }
            'shift' { $mods += 0x10 }
            'alt' { $mods += 0x12 }
            'win' { $mods += 0x5B }
            'meta' { $mods += 0x5B }
            default { throw "Unknown modifier: $($parts[$i])" }
        }
    }
    $key = Get-VirtualKey $parts[$parts.Count - 1]
    [OLSend]::Combo([uint16[]]$mods, $key)
}

function Handle($req) {
    switch ($req.cmd) {
        'ping' { return @{ ok = $true; pong = $true } }
        'volume.get' {
            $v = [Math]::Round([OLSound]::GetVolume() * 100)
            return @{ ok = $true; volume = [int]$v; muted = [OLSound]::GetMute() }
        }
        'volume.set' {
            [OLSound]::SetVolume([float]([double]$req.level / 100.0))
            return @{ ok = $true; volume = [int]$req.level }
        }
        'volume.mute' {
            [OLSound]::SetMute([bool]$req.muted)
            return @{ ok = $true; muted = [bool]$req.muted }
        }
        'keys' {
            Invoke-Keys ([string]$req.keys)
            return @{ ok = $true }
        }
        'text' {
            [OLSend]::Unicode([string]$req.text)
            return @{ ok = $true }
        }
        'pointer' {
            $e = $req.event
            switch ($e.kind) {
                'move' { [OLSend]::Move([int]$e.dx, [int]$e.dy) }
                'scroll' { [OLSend]::Scroll([int]$e.dx, [int]$e.dy) }
                'click' { [OLSend]::Click([string]$e.button, [int]$e.count) }
                'down' { [OLSend]::Button([string]$e.button, $true) }
                'up' { [OLSend]::Button([string]$e.button, $false) }
                default { throw "Unknown pointer kind: $($e.kind)" }
            }
            return @{ ok = $true }
        }
        'launch' {
            $p = [string]$req.path
            if ([string]::IsNullOrWhiteSpace($p)) { throw 'missing path' }
            if ($req.args) { Start-Process -FilePath $p -ArgumentList ([string]$req.args) | Out-Null }
            else { Start-Process -FilePath $p | Out-Null }
            return @{ ok = $true }
        }
        'url' {
            $u = [string]$req.url
            if ($u -notmatch '^https?://') { throw 'only http(s) urls' }
            Start-Process $u | Out-Null
            return @{ ok = $true }
        }
        'power' {
            switch ([string]$req.action) {
                'lock' { rundll32.exe user32.dll,LockWorkStation }
                'sleep' { [OLSend]::Sleep() }
                'display-off' { [OLSend]::MonitorOff() }
                default { throw "Unknown power action: $($req.action)" }
            }
            return @{ ok = $true }
        }
        default { throw "Unknown command: $($req.cmd)" }
    }
}

# Report readiness so the host knows the agent is live.
[Console]::Out.WriteLine('{"id":0,"ok":true,"ready":true}')
[Console]::Out.Flush()

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $id = 0
    try {
        $req = $line | ConvertFrom-Json
        $id = [int]$req.id
        $result = Handle $req
        $result.id = $id
        [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress -Depth 6))
    } catch {
        $msg = $_.Exception.Message
        [Console]::Out.WriteLine((@{ id = $id; ok = $false; error = "$msg" } | ConvertTo-Json -Compress))
    }
    [Console]::Out.Flush()
}
