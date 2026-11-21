import type { AppState, Ctx, View } from '../types';
import { el, fmtBytes, fmtClock, fmtClockUnit, fmtPct, fmtRate, fmtTemp, fmtUptime, icon, thermalState } from '../ui';

interface Gauge {
  card: HTMLElement;
  value: HTMLElement;
  unit: HTMLElement;
  sub: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
}

function gauge(title: string, iconName: string, unit: string, sourceLabel: HTMLElement): Gauge {
  const value = el('span', { text: '—' });
  const unitEl = el('span', { class: 'unit', text: unit });
  const sub = el('div', { class: 'sub' });
  const fill = el('i', { style: 'width:0%' });
  const bar = el('div', { class: 'therm-bar' }, fill);
  const card = el(
    'div',
    { class: 'card' },
    el('div', { class: 'card-head' }, el('div', { class: 'card-title' }, icon(iconName, 13), title), sourceLabel),
    el('div', { class: 'kpi' }, value, unitEl),
    sub,
    el('div', { class: 'therm' }, bar),
  );
  return { card, value, unit: unitEl, sub, bar, fill };
}

function sparkline(history: number[]): string {
  if (history.length < 2) return '';
  const max = Math.max(...history, 1);
  const points = history
    .map((value, index) => {
      const x = (index / (history.length - 1)) * 100;
      const y = 30 - (value / max) * 26;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return points;
}

function sourcePill(): { pill: HTMLElement; set: (text: string) => void } {
  const pill = el('span', { class: 'pill', style: 'height:22px;font-size:9px;padding:0 8px' }, el('i', { class: 'led' }), el('span', { text: '—' }));
  const label = pill.querySelector('span') as HTMLElement;
  return { pill, set: (text: string) => (label.textContent = text) };
}

export function sensorsView(ctx: Ctx): View {
  const { t } = ctx;
  const cpuSource = sourcePill();
  const gpuSource = sourcePill();
  const cpu = gauge(t('dash.cpu'), 'cpu', '°C', cpuSource.pill);
  const gpu = gauge(t('dash.gpu'), 'gpu', '°C', gpuSource.pill);

  const cpuMeta = el('div');
  const gpuMeta = el('div');
  cpu.card.append(cpuMeta);
  gpu.card.append(gpuMeta);

  const cpuSpark = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  cpuSpark.setAttribute('fill', 'none');
  cpuSpark.setAttribute('stroke', 'var(--accent)');
  cpuSpark.setAttribute('stroke-width', '1.2');
  cpuSpark.setAttribute('stroke-linejoin', 'round');
  const cpuSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  cpuSvg.setAttribute('class', 'spark');
  cpuSvg.setAttribute('viewBox', '0 0 100 32');
  cpuSvg.setAttribute('preserveAspectRatio', 'none');
  cpuSvg.append(cpuSpark);
  cpu.card.append(cpuSvg);

  const cpuHistory: number[] = [];
  const gpuHistory: number[] = [];

  const memFill = el('i', { style: 'width:0%' });
  const memCard = el(
    'div',
    { class: 'card' },
    el('div', { class: 'card-head' }, el('div', { class: 'card-title' }, icon('memory', 13), t('dash.mem'))),
    el('div', { class: 'kpi' }, el('span', { text: '—' }), el('span', { class: 'unit', text: 'GB' })),
    el('div', { class: 'sub' }),
    el('div', { class: 'bar' }, memFill),
  );
  const memValue = memCard.querySelector('.kpi span') as HTMLElement;
  const memSub = memCard.querySelector('.sub') as HTMLElement;

  const netDown = el('div', { class: 'kpi' }, el('span', { text: '—' }), el('span', { class: 'unit', text: 'MB/s' }));
  const netUp = el('div', { class: 'kpi', style: 'font-size:19px;margin-top:10px' }, el('span', { text: '—' }), el('span', { class: 'unit', text: 'MB/s' }));
  const netSub = el('div', { class: 'sub' });
  const netCard = el(
    'div',
    { class: 'card' },
    el('div', { class: 'card-head' }, el('div', { class: 'card-title' }, icon('network', 13), t('dash.net')), netSub),
    el('div', { class: 'hint', text: t('dash.down') }),
    netDown,
    el('div', { class: 'hint', style: 'margin-top:10px', text: t('dash.up') }),
    netUp,
  );

  const fanCard = el(
    'div',
    { class: 'card' },
    el('div', { class: 'card-head' }, el('div', { class: 'card-title' }, icon('fan', 13), t('dash.fan'))),
    el('div', { class: 'kpi' }, el('span', { text: '—' }), el('span', { class: 'unit', text: 'RPM' })),
    el('div', { class: 'sub' }),
  );
  const fanValue = fanCard.querySelector('.kpi span') as HTMLElement;
  const fanSub = fanCard.querySelector('.sub') as HTMLElement;

  const sysCard = el(
    'div',
    { class: 'card' },
    el('div', { class: 'card-head' }, el('div', { class: 'card-title' }, icon('power', 13), t('dash.title'))),
    el('div', {}),
  );
  const sysBody = sysCard.lastElementChild as HTMLElement;

  const waiting = el('div', { class: 'hint', text: t('dash.waiting') });

  const body = el(
    'div',
    {},
    el('div', { class: 'grid two' }, cpu.card, gpu.card),
    el('div', { class: 'grid three', style: 'margin-top:12px' }, memCard, netCard, fanCard),
    el('div', { class: 'grid two', style: 'margin-top:12px' }, sysCard),
    waiting,
  );

  const update = (state: AppState): void => {
    const sample = state.telemetry;
    if (!sample) return;
    waiting.style.display = 'none';

    const cpuState = thermalState(sample.cpu.tempC);
    cpu.value.textContent = fmtTemp(sample.cpu.tempC);
    cpu.value.className = `state-${cpuState}`;
    cpu.bar.className = `therm-bar ${cpuState === 'warm' ? 'warm' : cpuState === 'hot' || cpuState === 'critical' ? 'hot' : ''}`;
    cpu.fill.style.width = sample.cpu.tempC === null ? '0%' : `${Math.min(100, (sample.cpu.tempC / 100) * 100)}%`;
    cpu.sub.textContent = sample.cpu.name ?? '';
    cpuSource.set(sample.cpu.source);
    cpuMeta.replaceChildren(
      el('div', { class: 'metric' }, el('span', { text: t('dash.load') }), el('span', { text: `${fmtPct(sample.cpu.loadPct)} %` })),
      el('div', { class: 'metric' }, el('span', { text: t('dash.clock') }), el('span', { text: `${fmtClock(sample.cpu.clockMhz)} ${fmtClockUnit(sample.cpu.clockMhz)}` })),
      el('div', { class: 'metric' }, el('span', { text: t('dash.power') }), el('span', { text: sample.cpu.powerW === null ? '—' : `${sample.cpu.powerW.toFixed(1)} W` })),
      el('div', { class: 'metric' }, el('span', { text: t('dash.fan') }), el('span', { text: sample.cpu.fanRpm === null ? '—' : `${Math.round(sample.cpu.fanRpm)} RPM` })),
    );
    if (sample.cpu.tempC !== null) {
      cpuHistory.push(sample.cpu.tempC);
      if (cpuHistory.length > 60) cpuHistory.shift();
      cpuSpark.setAttribute('points', sparkline(cpuHistory));
    }

    const gpuState = thermalState(sample.gpu.tempC);
    gpu.value.textContent = fmtTemp(sample.gpu.tempC);
    gpu.value.className = `state-${gpuState}`;
    gpu.bar.className = `therm-bar ${gpuState === 'warm' ? 'warm' : gpuState === 'hot' || gpuState === 'critical' ? 'hot' : ''}`;
    gpu.fill.style.width = sample.gpu.tempC === null ? '0%' : `${Math.min(100, (sample.gpu.tempC / 100) * 100)}%`;
    gpu.sub.textContent = sample.gpu.name ?? '';
    gpuSource.set(sample.gpu.source);
    const vramPct =
      sample.gpu.vramUsedMb !== null && sample.gpu.vramTotalMb
        ? (sample.gpu.vramUsedMb / sample.gpu.vramTotalMb) * 100
        : null;
    gpuMeta.replaceChildren(
      el('div', { class: 'metric' }, el('span', { text: t('dash.load') }), el('span', { text: `${fmtPct(sample.gpu.loadPct)} %` })),
      el('div', { class: 'metric' }, el('span', { text: t('dash.clock') }), el('span', { text: `${fmtClock(sample.gpu.clockMhz)} ${fmtClockUnit(sample.gpu.clockMhz)}` })),
      el('div', { class: 'metric' }, el('span', { text: t('dash.power') }), el('span', { text: sample.gpu.powerW === null ? '—' : `${sample.gpu.powerW.toFixed(1)} W` })),
      el('div', { class: 'metric' }, el('span', { text: t('dash.vram') }), el('span', { text: vramPct === null ? '—' : `${fmtBytes((sample.gpu.vramUsedMb ?? 0) * 1024 * 1024)} / ${fmtBytes((sample.gpu.vramTotalMb ?? 0) * 1024 * 1024)}` })),
    );
    if (sample.gpu.tempC !== null) {
      gpuHistory.push(sample.gpu.tempC);
      if (gpuHistory.length > 60) gpuHistory.shift();
    }

    const usedGb = sample.mem.usedMb / 1024;
    const totalGb = sample.mem.totalMb / 1024;
    memValue.textContent = usedGb.toFixed(1);
    memSub.textContent = `${totalGb.toFixed(1)} GB · ${Math.round((usedGb / Math.max(1, totalGb)) * 100)} %`;
    memFill.style.width = `${Math.min(100, (usedGb / Math.max(1, totalGb)) * 100)}%`;

    (netDown.firstElementChild as HTMLElement).textContent = (sample.net.downBps / 1024 / 1024).toFixed(2);
    (netUp.firstElementChild as HTMLElement).textContent = (sample.net.upBps / 1024 / 1024).toFixed(2);
    netSub.textContent = [sample.net.iface, sample.net.ssid].filter(Boolean).join(' · ') || '—';

    fanValue.textContent = sample.gpu.fanRpm === null ? (sample.cpu.fanRpm === null ? '—' : String(Math.round(sample.cpu.fanRpm))) : String(Math.round(sample.gpu.fanRpm));
    fanSub.textContent = `${t('dash.gpu')} ${sample.gpu.fanRpm === null ? '—' : sample.gpu.fanRpm} · ${t('dash.cpu')} ${sample.cpu.fanRpm === null ? '—' : Math.round(sample.cpu.fanRpm)}`;

    sysBody.replaceChildren(
      el('div', { class: 'metric' }, el('span', { text: t('dash.volume') }), el('span', { text: sample.audio.volume === null ? '—' : `${sample.audio.volume} %${sample.audio.muted ? ' · mute' : ''}` })),
      el('div', { class: 'metric' }, el('span', { text: t('dash.battery') }), el('span', { text: sample.battery.pct === null ? '—' : `${sample.battery.pct} %${sample.battery.charging ? ' ⚡' : ''}` })),
      el('div', { class: 'metric' }, el('span', { text: t('status.uptime') }), el('span', { text: fmtUptime(sample.uptimeS) })),
      el('div', { class: 'metric' }, el('span', { text: t('dash.down') }), el('span', { text: fmtRate(sample.net.downBps) })),
    );
  };

  return { el: body, update };
}
