import type { PointerEvent_ } from '../../../shared/protocol';
import type { MCtx } from '../ctx';
import { el, icon, haptic, loopMark } from '../ui';

/* ------------------------------------------------------------------ standby */

export interface StandbyView {
  el: HTMLElement;
  update: () => void;
}

let standbySeq = 0;

function clockDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function durationLabel(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The standby face: a calm OLED clock with three tiers — identity, time, media.
 * Two compositions share the same markup: stacked for portrait, split for
 * landscape, chosen by the standby orientation setting (or the device aspect).
 */
export function standbyOverlay(ctx: MCtx): StandbyView {
  const { state, link, t } = ctx;

  const hours = el('span', { class: 'hh', text: '00' });
  const minutes = el('span', { class: 'mm', text: '00' });
  const seconds = el('span', { class: 'ss', text: '00' });
  const date = el('div', { class: 'sb-date' });
  const chips = el('div', { class: 'sb-chips' });

  const chip = (label: string) => {
    const value = el('span', { class: 'v', text: '—' });
    const bar = el('i');
    const node = el(
      'div',
      { class: 'sb-chip' },
      el('span', { class: 'k', text: label }),
      value,
      el('div', { class: 'bar' }, bar),
    );
    chips.append(node);
    return { node, value, bar };
  };

  const cpuChip = chip('CPU');
  const gpuChip = chip('GPU');
  const loadChip = chip('LOAD');

  const kicker = el('span', { class: 'sb-kicker', text: t('standby.nowPlaying') });
  const app = el('span', { class: 'sb-app', text: '' });
  const title = el('div', { class: 'sb-title', text: t('media.none') });
  const artist = el('div', { class: 'sb-artist', text: '' });
  const progress = el('i');
  const elapsed = el('span', { text: '0:00' });
  const total = el('span', { text: '0:00' });

  const send = (action: 'playpause' | 'next' | 'prev'): void => {
    void haptic('light').catch(() => undefined);
    void link.send({ t: 'media.command', action }).catch(() => undefined);
  };

  const playButton = el(
    'button',
    { class: 'primary', type: 'button', 'aria-label': t('media.play') },
    icon(state.media?.playing ? 'pause' : 'play', 20),
  );
  playButton.addEventListener('click', (event) => {
    event.stopPropagation();
    send('playpause');
  });

  const controls = el(
    'div',
    { class: 'sb-controls' },
    el('button', { type: 'button', 'aria-label': t('media.prev'), onclick: (event: Event) => { event.stopPropagation(); send('prev'); } }, icon('prev', 16)),
    playButton,
    el('button', { type: 'button', 'aria-label': t('media.next'), onclick: (event: Event) => { event.stopPropagation(); send('next'); } }, icon('next', 16)),
  );

  const panel = el(
    'section',
    { class: 'sb-panel' },
    el('div', { class: 'sb-panel-head' }, kicker, app),
    title,
    artist,
    el('div', { class: 'sb-progress' }, progress),
    el('div', { class: 'sb-times' }, elapsed, total),
    controls,
  );

  const root = el(
    'div',
    { class: 'standby', 'data-layout': 'portrait', 'data-style': 'panels', 'data-instance': String(++standbySeq) },
    el('div', { class: 'sb-ambient', 'aria-hidden': 'true' }),
    el(
      'div',
      { class: 'sb-drift' },
      el(
        'header',
        { class: 'sb-top' },
        el('div', { class: 'sb-brand' }, loopMark(18), el('span', { text: 'OpenLink' })),
        el('div', { class: 'sb-state' }, el('i', { class: 'led' }), el('span', { text: t('status.encrypted') })),
      ),
      el(
        'main',
        { class: 'sb-main' },
        el(
          'section',
          { class: 'sb-left' },
          el('div', { class: 'sb-clock' },
            el('div', { class: 'sb-time' }, hours, el('span', { class: 'colon', 'aria-hidden': 'true' }, el('i'), el('i')), minutes, seconds),
            date,
          ),
          chips,
        ),
        panel,
      ),
      el('footer', { class: 'sb-foot' }, el('span', { class: 'sb-hint', text: t('standby.hint') })),
    ),
  );

  const resolveLayout = (): 'portrait' | 'landscape' => {
    const mode = state.settings.standbyLayout;
    if (mode === 'portrait' || mode === 'landscape') return mode;
    return window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait';
  };

  const applyLayout = (): void => {
    const layout = resolveLayout();
    if (root.dataset.layout !== layout) root.dataset.layout = layout;
    const style = state.settings.standbyStyle === 'text' ? 'text' : 'panels';
    if (root.dataset.style !== style) root.dataset.style = style;
  };

  const onResize = (): void => applyLayout();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  const close = (): void => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    ctx.exitStandby();
  };
  root.addEventListener('click', close);
  root.addEventListener('touchstart', () => void haptic('light'), { passive: true });

  const update = (): void => {
    applyLayout();
    const now = new Date();
    const locale = state.settings.lang === 'de' ? 'de-DE' : 'en-GB';
    hours.textContent = clockDigits(now.getHours());
    minutes.textContent = clockDigits(now.getMinutes());
    seconds.textContent = clockDigits(now.getSeconds());
    date.textContent = now.toLocaleDateString(locale, { weekday: 'long', day: '2-digit', month: 'long' });

    const sample = state.telemetry;
    const setChip = (target: ReturnType<typeof chip>, value: string, pct: number) => {
      target.value.textContent = value;
      target.bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    };
    if (sample) {
      setChip(cpuChip, sample.cpu.tempC === null ? '—' : `${Math.round(sample.cpu.tempC)}°`, sample.cpu.tempC ?? 0);
      setChip(gpuChip, sample.gpu.tempC === null ? '—' : `${Math.round(sample.gpu.tempC)}°`, sample.gpu.tempC ?? 0);
      setChip(loadChip, sample.cpu.loadPct === null ? '—' : `${Math.round(sample.cpu.loadPct)}%`, sample.cpu.loadPct ?? 0);
    }

    const media = state.media;
    panel.classList.toggle('empty', !media);
    title.textContent = media?.title || t('media.none');
    artist.textContent = media?.artist ?? '';
    app.textContent = media?.app ? media.app.replace(/\.exe$/i, '') : '';
    kicker.textContent = t('standby.nowPlaying');
    const position = media?.positionS ?? 0;
    const length = media?.durationS ?? 0;
    progress.style.width = length > 0 ? `${Math.min(100, (position / length) * 100)}%` : '0%';
    elapsed.textContent = durationLabel(position);
    total.textContent = durationLabel(length);
    playButton.replaceChildren(icon(media?.playing ? 'pause' : 'play', 20));
  };

  update();
  return { el: root, update };
}

/* ------------------------------------------------------------------ trackpad */

export function padSheet(ctx: MCtx): HTMLElement {
  const { link, t } = ctx;
  const dot = el('div', { class: 'dot' });
  const pad = el('div', { class: 'pad' }, el('div', { text: t('trackpad.hint') }), dot);
  let lastX = 0;
  let lastY = 0;
  let moved = 0;
  let startX = 0;
  let startY = 0;
  let twoFingerY = 0;

  const sendPointer = (event: PointerEvent_): void => {
    void link.send({ t: 'input.pointer', event }).catch(() => undefined);
  };

  pad.addEventListener('pointerdown', (event) => {
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    lastX = event.clientX;
    lastY = event.clientY;
    startX = event.clientX;
    startY = event.clientY;
    moved = 0;
    dot.style.opacity = '1';
    dot.style.left = `${event.clientX - pad.getBoundingClientRect().left}px`;
    dot.style.top = `${event.clientY - pad.getBoundingClientRect().top}px`;
  });

  pad.addEventListener('pointermove', (event) => {
    if (event.buttons === 0 && event.pointerType !== 'touch') return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    if (dx === 0 && dy === 0) return;
    moved += Math.abs(dx) + Math.abs(dy);
    lastX = event.clientX;
    lastY = event.clientY;
    dot.style.left = `${event.clientX - pad.getBoundingClientRect().left}px`;
    dot.style.top = `${event.clientY - pad.getBoundingClientRect().top}px`;
    if (event.pointerType === 'touch') {
      // Relative movement, scaled for a comfortable pointer speed.
      sendPointer({ kind: 'move', dx: Math.round(dx * 1.7), dy: Math.round(dy * 1.7) });
    }
  });

  pad.addEventListener('pointerup', (event) => {
    dot.style.opacity = '0';
    const dist = Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY);
    if (dist < 8) {
      void haptic('light');
      sendPointer({ kind: 'click', button: 'left', count: 1 });
    } else if (moved > 0 && event.pointerType === 'mouse') {
      sendPointer({ kind: 'click', button: 'left', count: 1 });
    }
  });

  pad.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length !== 2) return;
      const y = (event.touches[0].clientY + event.touches[1].clientY) / 2;
      if (twoFingerY) {
        const dy = y - twoFingerY;
        if (Math.abs(dy) > 3) sendPointer({ kind: 'scroll', dx: 0, dy: Math.round(dy / 6) });
      }
      twoFingerY = y;
    },
    { passive: true },
  );
  pad.addEventListener('touchend', () => (twoFingerY = 0));

  const button = (label: string, action: () => void): HTMLElement => {
    const node = el('button', { class: 'btn', type: 'button', text: label });
    node.addEventListener('click', () => {
      void haptic('light');
      action();
    });
    return node;
  };

  return el(
    'div',
    { class: 'sheet' },
    el('div', { class: 'sheet-head' },
      el('div', { class: 'name', text: t('trackpad.title') }),
      el('button', { class: 'btn sm ghost', type: 'button', onclick: () => ctx.closeSheet() }, icon('close', 13), t('common.close')),
    ),
    pad,
    el('div', { class: 'pad-buttons' },
      button(t('keyboard.title'), () => ctx.openSheet('keyboard')),
      button('Right click', () => sendPointer({ kind: 'click', button: 'right', count: 1 })),
    ),
  );
}

/* ------------------------------------------------------------------ keyboard */

export function keyboardSheet(ctx: MCtx): HTMLElement {
  const { link, t } = ctx;
  const modifiers = new Set<string>();
  const chips: HTMLButtonElement[] = [];
  const input = el('textarea', { class: 'input', rows: '2', placeholder: t('keyboard.placeholder'), style: 'height:auto;padding:10px 12px;resize:none' });

  const sendText = (): void => {
    const value = input.value;
    if (!value) return;
    void link.send({ t: 'input.text', text: value }).catch(() => undefined);
    input.value = '';
    void haptic('light');
  };

  const sendKey = (key: string): void => {
    const combo = [...modifiers, key].join('+');
    void link.send({ t: 'input.key', combo }).catch(() => undefined);
    void haptic('medium');
  };

  for (const [label, value] of [
    [t('keyboard.ctrl'), 'ctrl'],
    [t('keyboard.alt'), 'alt'],
    [t('keyboard.shift'), 'shift'],
    [t('keyboard.win'), 'win'],
  ]) {
    const chip = el('button', { class: 'key', type: 'button', text: label, 'aria-pressed': 'false' });
    chip.addEventListener('click', () => {
      if (modifiers.has(value)) modifiers.delete(value);
      else modifiers.add(value);
      chip.setAttribute('aria-pressed', modifiers.has(value) ? 'true' : 'false');
      void haptic('light');
    });
    chips.push(chip);
  }

  const keys = ['enter', 'tab', 'esc', 'backspace', 'up', 'down', 'left', 'right', 'media-playpause'];

  return el(
    'div',
    { class: 'sheet' },
    el('div', { class: 'sheet-head' },
      el('div', { class: 'name', text: t('keyboard.title') }),
      el('button', { class: 'btn sm ghost', type: 'button', onclick: () => ctx.closeSheet() }, icon('close', 13), t('common.close')),
    ),
    el('div', { class: 'keyboard-row' }, ...chips),
    input,
    el('button', { class: 'btn primary', type: 'button', style: 'margin-top:10px', onclick: sendText }, icon('send', 14), t('keyboard.send')),
    el('div', { class: 'section-title', text: 'Keys' }),
    el('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px' },
      ...keys.map((key) => {
        const node = el('button', { class: 'btn sm ghost', type: 'button', text: key });
        node.addEventListener('click', () => sendKey(key));
        return node;
      }),
    ),
  );
}
