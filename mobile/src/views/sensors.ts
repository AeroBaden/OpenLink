import type { MCtx, MView } from '../ctx';
import { el, fmtBytes, fmtClock, fmtPct, fmtRate, fmtTemp, icon, thermalOf } from '../ui';

export function sensorsView(ctx: MCtx): MView {
  const { t } = ctx;

  const cpuTemp = el('span', { text: '—' });
  const cpuBar = el('div', { class: 'therm-bar' }, el('i'));
  const cpuSub = el('div', { class: 'sub' });
  const cpuMeta = el('div');
  const gpuTemp = el('span', { text: '—' });
  const gpuBar = el('div', { class: 'therm-bar' }, el('i'));
  const gpuSub = el('div', { class: 'sub' });
  const gpuMeta = el('div');
  const sysMeta = el('div');
  const netMeta = el('div');
  const waiting = el('div', { class: 'empty', text: t('dash.waiting') });

  const cpuCard = el(
    'div',
    { class: 'card' },
    el('div', { class: 'card-head' },
      el('div', { class: 'card-title' }, icon('cpu', 13), t('dash.cpu')),
      el('span', { class: 'pill', style: 'height:20px;font-size:8.5px;padding:0 7px' }, el('i', { class: 'led' }), t('dash.thermal')),
    ),
    el('div', { class: 'kpi' }, cpuTemp, el('span', { class: 'unit', text: '°C' })),
    cpuSub,
    el('div', { class: 'therm' }, cpuBar, el('div', { class: 'scale' }, el('span', { text: '0' }), el('span', { text: '60' }), el('span', { text: '75' }), el('span', { text: '90+' }))),
    el('div', { style: 'margin-top:12px' }, cpuMeta),
  );

  const gpuCard = el(
    'div',
    { class: 'card' },
    el('div', { class: 'card-head' },
      el('div', { class: 'card-title' }, icon('gpu', 13), t('dash.gpu')),
      el('span', { class: 'pill', style: 'height:20px;font-size:8.5px;padding:0 7px' }, el('i', { class: 'led' }), t('dash.vram')),
    ),
    el('div', { class: 'kpi' }, gpuTemp, el('span', { class: 'unit', text: '°C' })),
    gpuSub,
    el('div', { class: 'therm' }, gpuBar, el('div', { class: 'scale' }, el('span', { text: '0' }), el('span', { text: '60' }), el('span', { text: '75' }), el('span', { text: '90+' }))),
    el('div', { style: 'margin-top:12px' }, gpuMeta),
  );

  const memCard = el(
    'div',
    { class: 'card' },
    el('div', { class: 'card-head' }, el('div', { class: 'card-title' }, icon('memory', 13), t('dash.mem'))),
    sysMeta,
  );

  const netCard = el(
    'div',
    { class: 'card' },
    el('div', { class: 'card-head' }, el('div', { class: 'card-title' }, icon('network', 13), t('dash.net'))),
    netMeta,
  );

  const body = el('div', {}, waiting, cpuCard, gpuCard, memCard, netCard);

  return {
    el: body,
    update(next) {
      const sample = next.telemetry;
      if (!sample) return;
      waiting.style.display = 'none';

      const cpuState = thermalOf(sample.cpu.tempC);
      cpuTemp.textContent = fmtTemp(sample.cpu.tempC);
      cpuTemp.className = `state-${cpuState}`;
      cpuBar.className = `therm-bar ${cpuState === 'warm' ? 'warm' : cpuState === 'hot' || cpuState === 'critical' ? 'hot' : ''}`;
      (cpuBar.firstElementChild as HTMLElement).style.width = sample.cpu.tempC === null ? '0%' : `${Math.min(100, sample.cpu.tempC)}%`;
      cpuSub.textContent = sample.cpu.name ?? '';
      cpuMeta.replaceChildren(
        el('div', { class: 'metric' }, el('span', { text: t('dash.load') }), el('span', { text: `${fmtPct(sample.cpu.loadPct)} %` })),
        el('div', { class: 'metric' }, el('span', { text: t('dash.clock') }), el('span', { text: fmtClock(sample.cpu.clockMhz) })),
        el('div', { class: 'metric' }, el('span', { text: t('dash.power') }), el('span', { text: sample.cpu.powerW === null ? '—' : `${sample.cpu.powerW.toFixed(1)} W` })),
        el('div', { class: 'metric' }, el('span', { text: t('dash.fan') }), el('span', { text: sample.cpu.fanRpm === null ? '—' : `${Math.round(sample.cpu.fanRpm)} RPM` })),
        el('div', { class: 'metric' }, el('span', { text: t('dash.source') }), el('span', { text: sample.cpu.source })),
      );

      const gpuState = thermalOf(sample.gpu.tempC);
      gpuTemp.textContent = fmtTemp(sample.gpu.tempC);
      gpuTemp.className = `state-${gpuState}`;
      gpuBar.className = `therm-bar ${gpuState === 'warm' ? 'warm' : gpuState === 'hot' || gpuState === 'critical' ? 'hot' : ''}`;
      (gpuBar.firstElementChild as HTMLElement).style.width = sample.gpu.tempC === null ? '0%' : `${Math.min(100, sample.gpu.tempC)}%`;
      gpuSub.textContent = sample.gpu.name ?? '';
      gpuMeta.replaceChildren(
        el('div', { class: 'metric' }, el('span', { text: t('dash.load') }), el('span', { text: `${fmtPct(sample.gpu.loadPct)} %` })),
        el('div', { class: 'metric' }, el('span', { text: t('dash.clock') }), el('span', { text: fmtClock(sample.gpu.clockMhz) })),
        el('div', { class: 'metric' }, el('span', { text: t('dash.power') }), el('span', { text: sample.gpu.powerW === null ? '—' : `${sample.gpu.powerW.toFixed(1)} W` })),
        el('div', { class: 'metric' }, el('span', { text: t('dash.fan') }), el('span', { text: sample.gpu.fanRpm === null ? '—' : `${Math.round(sample.gpu.fanRpm)}${sample.gpu.fanRpm < 100 ? ' %' : ' RPM'}` })),
        el('div', { class: 'metric' }, el('span', { text: t('dash.vram') }), el('span', { text: sample.gpu.vramTotalMb === null ? '—' : `${fmtBytes((sample.gpu.vramUsedMb ?? 0) * 1048576)} / ${fmtBytes(sample.gpu.vramTotalMb * 1048576)}` })),
      );

      const usedGb = sample.mem.usedMb / 1024;
      const totalGb = sample.mem.totalMb / 1024;
      sysMeta.replaceChildren(
        el('div', { class: 'metric' }, el('span', { text: t('dash.mem') }), el('span', { text: `${usedGb.toFixed(1)} / ${totalGb.toFixed(1)} GB` })),
        el('div', { class: 'metric' }, el('span', { text: 'Swap' }), el('span', { text: `${((sample.mem.swapUsedMb ?? 0) / 1024).toFixed(1)} GB` })),
        el('div', { class: 'metric' }, el('span', { text: t('dash.battery') }), el('span', { text: sample.battery.pct === null ? '—' : `${sample.battery.pct} %${sample.battery.charging ? ' ⚡' : ''}` })),
      );
      netMeta.replaceChildren(
        el('div', { class: 'metric' }, el('span', { text: t('dash.down') }), el('span', { text: fmtRate(sample.net.downBps) })),
        el('div', { class: 'metric' }, el('span', { text: t('dash.up') }), el('span', { text: fmtRate(sample.net.upBps) })),
        el('div', { class: 'metric' }, el('span', { text: t('dash.net') }), el('span', { text: [sample.net.iface, sample.net.ssid].filter(Boolean).join(' · ') || '—' })),
      );
    },
  };
}
