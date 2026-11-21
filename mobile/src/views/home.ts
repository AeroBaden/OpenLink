import type { MCtx, MView } from '../ctx';
import { el, icon, fmtTemp, thermalOf } from '../ui';

export function homeView(ctx: MCtx): MView {
  const { t, link, state } = ctx;
  const statusRow = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' });
  const mediaNode = el('div');
  const castVideo = el('video', { class: 'cast', autoplay: 'true', playsinline: 'true', controls: 'true' });
  const castCard = el('div', { class: 'card', style: 'display:none' });

  const send = (message: Parameters<MCtx['send']>[0]): void => {
    void link.send(message).catch(() => ctx.toast(t('error.disconnected'), 'err'));
  };

  const quick = (iconName: string, label: string, hint: string, action: () => void, tint = 'green') => {
    const button = el(
      'button',
      { class: 'quick', type: 'button', 'data-tint': tint },
      el('div', { class: 'glyph' }, icon(iconName, 15)),
      el('div', { class: 'caption' }, label, el('small', { text: hint })),
    );
    button.addEventListener('click', async () => {
      await ctx.haptics('light');
      action();
    });
    return button;
  };

  const unlock = quick('unlock', t('unlock.request'), t('settings.biometric'), async () => {
    send({ t: 'unlock.begin' });
    ctx.toast(t('unlock.waiting'));
  }, 'red');

  const grid = el(
    'div',
    { class: 'quick-grid' },
    quick('clock', t('standby.idle'), `${state.settings.standbyMs / 1000}s`, () => ctx.enterStandby(), 'ice'),
    quick('trackpad', t('trackpad.title'), t('trackpad.sub'), () => ctx.openSheet('pad')),
    quick('keyboard', t('keyboard.title'), 'USB-C · Wi-Fi', () => ctx.openSheet('keyboard')),
    unlock,
    quick('speaker', t('settings.pcAudio'), 'WebRTC', () => {
      send({ t: 'rtc.request', stream: 'pc-audio' });
      castCard.style.display = 'block';
      ctx.toast(t('settings.pcAudio'));
    }, 'violet'),
    quick('camera', t('settings.camera'), 'WebRTC', () => {
      castCard.style.display = 'block';
      window.dispatchEvent(new CustomEvent('openlink:camera'));
    }, 'amber'),
  );

  const volumeValue = el('span', { text: '—' });
  const volumeCard = el(
    'div',
    { class: 'card tight' },
    el('div', { class: 'card-head' }, el('div', { class: 'card-title' }, icon('speaker', 13), t('dash.volume')), volumeValue),
    el(
      'div',
      { style: 'display:flex;gap:8px' },
      el('button', { class: 'btn sm ghost', type: 'button', onclick: () => send({ t: 'volume.set', level: Math.max(0, (state.telemetry?.audio.volume ?? 50) - 10) }) }, '−10'),
      el('button', { class: 'btn sm ghost', type: 'button', onclick: () => send({ t: 'volume.mute', muted: !(state.telemetry?.audio.muted ?? false) }) }, state.telemetry?.audio.muted ? 'Unmute' : 'Mute'),
      el('button', { class: 'btn sm ghost', type: 'button', onclick: () => send({ t: 'volume.set', level: Math.min(100, (state.telemetry?.audio.volume ?? 50) + 10) }) }, '+10'),
    ),
  );

  castCard.append(
    el('div', { class: 'card-head' }, el('div', { class: 'card-title' }, icon('monitor', 13), t('settings.session'))),
    castVideo,
    el(
      'div',
      { style: 'display:flex;gap:8px;margin-top:10px' },
      el('button', { class: 'btn sm ghost', type: 'button', onclick: () => { castCard.style.display = 'none'; } }, t('common.close')),
      el('button', { class: 'btn sm danger', type: 'button', onclick: () => window.dispatchEvent(new CustomEvent('openlink:stop-camera')) }, t('common.cancel')),
    ),
  );

  const powerRow = el(
    'div',
    { style: 'display:flex;gap:8px' },
    el('button', { class: 'btn sm ghost', type: 'button', onclick: () => send({ t: 'power', action: 'lock' }) }, icon('lock', 12), t('deck.lock')),
    el('button', { class: 'btn sm ghost', type: 'button', onclick: () => send({ t: 'power', action: 'display-off' }) }, icon('display-off', 12), t('deck.displayOff')),
    el('button', { class: 'btn sm ghost', type: 'button', onclick: () => send({ t: 'power', action: 'sleep' }) }, icon('power', 12), t('deck.sleep')),
  );

  const body = el(
    'div',
    {},
    el('div', { class: 'card tight' }, el('div', { class: 'card-title' }, icon('link', 13), t('dash.title')), statusRow),
    castCard,
    grid,
    el('div', { class: 'section-title', text: t('media.title') }),
    mediaNode,
    volumeCard,
    el('div', { class: 'section-title', text: t('dash.title') }),
    powerRow,
  );

  const renderMedia = (): void => {
    const media = state.media;
    mediaNode.replaceChildren(
      el(
        'div',
        { class: 'card tight' },
        el('div', { class: 'card-head' },
          el('div', { class: 'card-title' }, icon('speaker', 13), media?.app ? media.app.split('.').pop() : t('media.title')),
          el('span', { class: media?.playing ? 'pill ok' : 'pill' }, el('i', { class: 'led' }), media?.playing ? 'Play' : 'Pause'),
        ),
        el('div', { style: 'font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: media?.title || t('media.none') }),
        el('div', { class: 'sub', text: media?.artist || '—' }),
        el(
          'div',
          { style: 'display:flex;gap:8px;margin-top:12px' },
          el('button', { class: 'btn sm ghost', type: 'button', onclick: () => send({ t: 'media.command', action: 'prev' }) }, icon('prev', 13)),
          el('button', { class: 'btn sm', type: 'button', onclick: () => send({ t: 'media.command', action: 'playpause' }) }, icon(media?.playing ? 'pause' : 'play', 13)),
          el('button', { class: 'btn sm ghost', type: 'button', onclick: () => send({ t: 'media.command', action: 'next' }) }, icon('next', 13)),
        ),
      ),
    );
  };

  const renderStatus = (): void => {
    const status = state.status;
    const name = state.server?.name ?? status?.serverInfo.name ?? 'OpenLink';
    const pills: HTMLElement[] = [
      el('span', { class: state.linkState === 'online' ? 'pill ok' : 'pill' }, el('i', { class: 'led' }), state.linkState === 'online' ? t('status.connected') : t('status.disconnected')),
      el('span', { class: 'pill' }, icon(link.transport === 'usb' ? 'usb' : 'wifi', 11), link.transport === 'usb' ? t('status.usb') : t('status.wifi')),
      el('span', { class: 'pill' }, icon('monitor', 11), name),
    ];
    if (state.settings.requireBiometric) {
      pills.push(el('span', { class: 'pill' }, icon('shield', 11), t('settings.biometric')));
    }
    statusRow.replaceChildren(...pills);
    const temp = state.telemetry;
    if (temp) {
      const cpuState = thermalOf(temp.cpu.tempC);
      statusRow.append(
        el('span', { class: `pill ${cpuState === 'hot' || cpuState === 'critical' ? 'warn' : ''}` }, icon('thermometer', 11), `${fmtTemp(temp.cpu.tempC)}°C`),
      );
      volumeValue.textContent = temp.audio.volume === null ? '—' : `${temp.audio.volume} %${temp.audio.muted ? ' · mute' : ''}`;
    }
  };

  castVideo.addEventListener('loadedmetadata', () => (castCard.style.display = 'block'));
  castCard.style.display = 'none';
  ctx.rtc.attach(castVideo);

  renderStatus();
  renderMedia();

  return {
    el: body,
    update(next) {
      state.media = next.media;
      state.telemetry = next.telemetry;
      renderStatus();
      renderMedia();
      if (next.rtc.receiving) castCard.style.display = 'block';
    },
  };
}
