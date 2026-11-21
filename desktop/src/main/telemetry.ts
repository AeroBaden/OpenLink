import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import si from 'systeminformation';
import type { GpuSample, Telemetry, ThermalSample } from '../../../shared/protocol';

/**
 * Telemetry sources, in priority order per field:
 *  - LibreHardwareMonitor WMI (`root\librehardwaremonitor`): CPU temp, package
 *    power, fan RPMs, GPU hot spot — the MSI Afterburner-grade numbers.
 *  - nvidia-smi: NVIDIA GPU temp/load/clock/power/fan/VRAM with ~40 ms latency.
 *  - systeminformation: load, clocks, memory, network, battery, uptime; the
 *    fallbacks when neither of the above is installed.
 * Nothing here throws: a missing sensor is reported as `null`, never faked.
 */

const LHM_CACHE_MS = 5_000;
const PS_TIMEOUT_MS = 6_000;
/**
 * Expensive sources (WMI, WMI-backed systeminformation calls, nvidia-smi and
 * the audio agent) are cached: querying them every tick used to spawn several
 * PowerShell processes per second, which made the whole machine stutter.
 */
const SLOW_REFRESH_MS = 5_000;
const NVIDIA_REFRESH_MS = 3_000;
const AUDIO_REFRESH_MS = 3_000;
const NET_REFRESH_MS = 2_000;

interface LhmReading {
  cpuTemp: number | null;
  cpuPower: number | null;
  cpuFan: number | null;
  gpuTemp: number | null;
  gpuHotspot: number | null;
  gpuPower: number | null;
  gpuFan: number | null;
}

const emptyLhm: LhmReading = {
  cpuTemp: null,
  cpuPower: null,
  cpuFan: null,
  gpuTemp: null,
  gpuHotspot: null,
  gpuPower: null,
  gpuFan: null,
};

function runPowerShell(script: string, args: string[] = [], timeout = PS_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
      { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

class LibraryBridge {
  private cache: LhmReading = emptyLhm;
  private fetchedAt = 0;
  private available: boolean | null = null;
  private script: string | null = null;
  private busy = false;

  setScriptPath(p: string): void {
    this.script = p;
  }

  get isAvailable(): boolean {
    return this.available === true;
  }

  async read(): Promise<LhmReading> {
    if (!this.script) return emptyLhm;
    const fresh = Date.now() - this.fetchedAt < LHM_CACHE_MS;
    if (fresh || this.busy) return this.cache;
    this.busy = true;
    try {
      const stdout = await runPowerShell(this.script, [], 5_000);
      const parsed = JSON.parse(stdout.trim() || 'null') as Partial<LhmReading> | null;
      if (parsed) {
        this.cache = { ...emptyLhm, ...parsed };
        this.available = true;
        this.fetchedAt = Date.now();
      }
    } catch {
      this.available = false;
      this.cache = emptyLhm;
      this.fetchedAt = Date.now();
    } finally {
      this.busy = false;
    }
    return this.cache;
  }
}

export const lhm = new LibraryBridge();

interface NvidiaReading {
  name: string;
  tempC: number | null;
  loadPct: number | null;
  clockMhz: number | null;
  powerW: number | null;
  fanPct: number | null;
  vramUsedMb: number | null;
  vramTotalMb: number | null;
}

function num(v: string | undefined): number | null {
  if (!v) return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed === '[N/A]' || trimmed === 'N/A') return null;
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

function readNvidia(): Promise<NvidiaReading | null> {
  return new Promise((resolve) => {
    const query = [
      'name',
      'temperature.gpu',
      'utilization.gpu',
      'clocks.gr',
      'power.draw',
      'fan.speed',
      'memory.used',
      'memory.total',
    ].join(',');
    execFile(
      'nvidia-smi',
      [`--query-gpu=${query}`, '--format=csv,noheader,nounits'],
      { timeout: 3_000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const first = stdout.trim().split(/\r?\n/)[0] ?? '';
        const cols = first.split(',').map((s) => s.trim());
        if (cols.length < 8) return resolve(null);
        resolve({
          name: cols[0],
          tempC: num(cols[1]),
          loadPct: num(cols[2]),
          clockMhz: num(cols[3]),
          powerW: num(cols[4]),
          fanPct: num(cols[5]),
          vramUsedMb: num(cols[6]),
          vramTotalMb: num(cols[7]),
        });
      },
    );
  });
}

function clamp(v: number | null, min = 0, max = 100): number | null {
  if (v === null) return null;
  return Math.min(max, Math.max(min, v));
}

export interface TelemetrySourceHooks {
  volume: () => Promise<{ volume: number | null; muted: boolean | null }>;
  agentScriptPath: () => string;
}

type GraphicsData = Awaited<ReturnType<typeof si.graphics>>;
type BatteryData = Awaited<ReturnType<typeof si.battery>>;
type WifiData = Awaited<ReturnType<typeof si.wifiConnections>>;
type TempData = Awaited<ReturnType<typeof si.cpuTemperature>>;
type NetData = Awaited<ReturnType<typeof si.networkStats>>;

export class TelemetryEngine {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private iface: string | null = null;
  private readonly startedAt = Date.now();
  private lastNet = { ts: 0, rx: 0, tx: 0 };
  private lastAudio: { volume: number | null; muted: boolean | null } = { volume: null, muted: null };
  private lastSample: Telemetry | null = null;
  private slowAt = 0;
  private slowBusy = false;
  private slow: {
    temps: TempData | null;
    graphics: GraphicsData | null;
    battery: BatteryData | null;
    wifi: WifiData;
    clockMhz: number | null;
  } = { temps: null, graphics: null, battery: null, wifi: [], clockMhz: null };
  private netAt = 0;
  private netStats: NetData = [];
  private audioAt = 0;
  private nvidiaCache: NvidiaReading | null = null;
  private nvidiaAt = 0;
  private nvidiaBusy = false;

  constructor(private readonly hooks: TelemetrySourceHooks) {}

  get latest(): Telemetry | null {
    return this.lastSample;
  }

  start(onSample: (t: Telemetry) => void): void {
    this.stop();
    lhm.setScriptPath(this.hooks.agentScriptPath());
    void this.initialise();
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      this.sample()
        .then((t) => {
          this.lastSample = t;
          onSample(t);
        })
        .catch(() => undefined)
        .finally(() => {
          this.busy = false;
        });
    }, 1_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async initialise(): Promise<void> {
    try {
      this.iface = await si.networkInterfaceDefault();
    } catch {
      this.iface = null;
    }
    try {
      const stats = await si.networkStats(this.iface ?? undefined);
      this.netStats = stats;
      this.netAt = Date.now();
      if (stats[0]) this.lastNet = { ts: Date.now(), rx: stats[0].rx_bytes, tx: stats[0].tx_bytes };
    } catch {
      /* ignore */
    }
    try {
      this.lastAudio = await this.hooks.volume();
      this.audioAt = Date.now();
    } catch {
      /* ignore */
    }
    await Promise.all([this.refreshSlow(), this.refreshNvidia(), lhm.read()]);
  }

  /** WMI-heavy reads, refreshed on a background cadence instead of every tick. */
  private async refreshSlow(): Promise<void> {
    if (this.slowBusy) return;
    this.slowBusy = true;
    try {
      const [temps, graphics, battery, wifi, speed] = await Promise.all([
        si.cpuTemperature().catch(() => null),
        si.graphics().catch(() => null),
        si.battery().catch(() => null),
        si.wifiConnections().catch(() => [] as WifiData),
        si.cpuCurrentSpeed().catch(() => null),
      ]);
      this.slow = {
        temps,
        graphics,
        battery,
        wifi,
        clockMhz: speed?.avg ? Math.round(speed.avg * 1000) : null,
      };
    } catch {
      /* keep the previous reading */
    } finally {
      this.slowAt = Date.now();
      this.slowBusy = false;
    }
  }

  private async refreshNvidia(): Promise<NvidiaReading | null> {
    if (this.nvidiaBusy) return this.nvidiaCache;
    if (Date.now() - this.nvidiaAt < NVIDIA_REFRESH_MS) return this.nvidiaCache;
    this.nvidiaBusy = true;
    try {
      this.nvidiaCache = await readNvidia();
    } finally {
      this.nvidiaAt = Date.now();
      this.nvidiaBusy = false;
    }
    return this.nvidiaCache;
  }

  async sample(): Promise<Telemetry> {
    // Refresh the expensive readings off the hot path; the tick itself only
    // reads cheap counters plus whatever the caches hold.
    if (Date.now() - this.slowAt > SLOW_REFRESH_MS) void this.refreshSlow();
    if (Date.now() - this.netAt > NET_REFRESH_MS) {
      this.netAt = Date.now();
      void si
        .networkStats(this.iface ?? undefined)
        .then((stats) => (this.netStats = stats))
        .catch(() => undefined);
    }

    const [load, mem, nvidia, lhmRead] = await Promise.all([
      si.currentLoad().catch(() => null),
      si.mem().catch(() => null),
      this.refreshNvidia(),
      lhm.read(),
    ]);

    if (Date.now() - this.audioAt > AUDIO_REFRESH_MS) {
      this.audioAt = Date.now();
      try {
        this.lastAudio = await this.hooks.volume();
      } catch {
        /* keep the last known level */
      }
    }

    const { temps, graphics, battery, wifi } = this.slow;
    const netStats = this.netStats;

    const now = Date.now();
    let downBps = 0;
    let upBps = 0;
    const stat = netStats?.[0];
    if (stat) {
      const dt = (now - this.lastNet.ts) / 1000;
      if (this.lastNet.ts && dt > 0.2) {
        downBps = Math.max(0, (stat.rx_bytes - this.lastNet.rx) / dt);
        upBps = Math.max(0, (stat.tx_bytes - this.lastNet.tx) / dt);
      } else {
        downBps = Math.max(0, stat.rx_sec ?? 0);
        upBps = Math.max(0, stat.tx_sec ?? 0);
      }
      this.lastNet = { ts: now, rx: stat.rx_bytes, tx: stat.tx_bytes };
    }

    const cpuTempSi = clamp(temps?.main ?? null, 0, 130);
    const cpuTemp = lhmRead.cpuTemp ?? cpuTempSi ?? null;
    const cpu: ThermalSample & { name: string | null; cores: number | null } = {
      tempC: cpuTemp,
      loadPct: clamp(load?.currentLoad ?? null),
      clockMhz: null,
      powerW: lhmRead.cpuPower,
      fanRpm: lhmRead.cpuFan,
      source: lhmRead.cpuTemp !== null ? 'librehardwaremonitor' : cpuTempSi !== null ? 'systeminformation' : 'none',
      name: os.cpus()[0]?.model?.trim() ?? null,
      cores: os.cpus().length || null,
    };
    cpu.clockMhz = this.slow.clockMhz;

    const controller = graphics?.controllers?.[0];
    const gpu: GpuSample = {
      name: nvidia?.name ?? controller?.model ?? null,
      tempC: nvidia?.tempC ?? lhmRead.gpuTemp ?? null,
      loadPct: nvidia?.loadPct ?? (controller?.utilizationGpu ?? null),
      clockMhz: nvidia?.clockMhz ?? controller?.clockCore ?? null,
      powerW: nvidia?.powerW ?? lhmRead.gpuPower ?? null,
      fanRpm: lhmRead.gpuFan,
      vramUsedMb: nvidia?.vramUsedMb ?? controller?.memoryUsed ?? null,
      vramTotalMb: nvidia?.vramTotalMb ?? controller?.vram ?? null,
      source: nvidia
        ? 'nvidia-smi'
        : lhmRead.gpuTemp !== null
          ? 'librehardwaremonitor'
          : controller
            ? 'systeminformation'
            : 'none',
    };
    if (gpu.fanRpm === null && nvidia?.fanPct != null) {
      // nvidia-smi only exposes a percentage; label it as a fan reading anyway.
      gpu.fanRpm = Math.round(nvidia.fanPct);
    }

    const primaryWifi = wifi?.[0];
    const sample: Telemetry = {
      ts: now,
      cpu,
      gpu,
      mem: {
        usedMb: Math.round((mem?.active ?? 0) / 1024 / 1024),
        totalMb: Math.round((mem?.total ?? os.totalmem()) / 1024 / 1024),
        swapUsedMb: mem ? Math.round((mem.swapused ?? 0) / 1024 / 1024) : null,
      },
      net: {
        downBps,
        upBps,
        iface: this.iface,
        ssid: primaryWifi?.ssid ?? null,
      },
      audio: { volume: this.lastAudio.volume, muted: this.lastAudio.muted },
      battery: {
        pct: battery?.hasBattery ? Math.round(battery.percent ?? 0) : null,
        charging: battery?.hasBattery ? Boolean(battery.isCharging) : null,
      },
      uptimeS: Math.round((Date.now() - this.startedAt) / 1000 + os.uptime()),
    };
    return sample;
  }
}

export function agentPath(resourcesRoot: string): string {
  return path.join(resourcesRoot, 'openlink-agent.ps1');
}
