import os from 'node:os';

export function lanAddresses(): string[] {
  const out: { address: string; score: number }[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      // Rank: typical home/office ranges first, virtual adapters last.
      let score = 10;
      if (addr.address.startsWith('192.168.')) score = 100;
      else if (addr.address.startsWith('10.')) score = 90;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr.address)) score = 80;
      if (/vEthernet|Hyper-V|VirtualBox|VMware|Loopback|WSL/i.test(name)) score -= 40;
      if (/Wi-?Fi|WLAN|Ethernet/i.test(name)) score += 5;
      out.push({ address: addr.address, score });
    }
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.address);
}

export function primaryAddress(): string {
  return lanAddresses()[0] ?? '127.0.0.1';
}

/** Human-readable byte rate, e.g. `12.4 MB/s`. */
export function formatRate(bytesPerSecond: number): string {
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let v = Math.max(0, bytesPerSecond);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
