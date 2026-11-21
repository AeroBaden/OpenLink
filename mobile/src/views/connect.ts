import type { PairTicket } from '../lib/link';
import { Native } from '../lib/native';
import type { MCtx, MView } from '../ctx';
import { el, icon, loopMark, seg } from '../ui';

export function parseTicket(value: string): PairTicket | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'openlink:') return null;
    const hosts = (url.searchParams.get('hosts') ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean);
    const code = url.searchParams.get('code') ?? '';
    if (!hosts.length || !code) return null;
    return {
      hosts,
      port: Number(url.searchParams.get('port') ?? 8765),
      code,
      name: url.searchParams.get('name') ?? undefined,
      usb: url.searchParams.get('usb') === '1',
    };
  } catch {
    return null;
  }
}

export function connectView(ctx: MCtx): MView {
  const { t, link, state } = ctx;

  const host = el('input', { class: 'input', placeholder: '192.168.1.20', inputmode: 'url' });
  const port = el('input', { class: 'input', placeholder: '8765', inputmode: 'numeric', value: '8765' });
  const code = el('input', { class: 'input', placeholder: 'ABC123', maxlength: '6', autocapitalize: 'characters', style: 'text-transform:uppercase;letter-spacing:0.2em' });
  let manualOpen = false;
  const manual = el('div', { class: 'card', style: 'display:none' });

  const scan = el(
    'button',
    { class: 'btn primary', type: 'button' },
    icon('qr', 16),
    t('pair.scan'),
  );

  const status = el('div', { class: 'hint', style: 'text-align:center;margin-top:14px' });

  scan.addEventListener('click', async () => {
    await ctx.haptics('medium');
    try {
      const { value } = await Native.scanQr();
      const ticket = parseTicket(value);
      if (!ticket) {
        ctx.toast(t('pair.wrongCode'), 'err');
        return;
      }
      ctx.toast(t('pair.connecting'));
      await link.pair(ticket);
    } catch (err) {
      const message = (err as Error).message || '';
      ctx.toast(message.includes('cancel') ? t('common.cancel') : message, 'err');
    }
  });

  manual.append(
    el('div', { class: 'field' }, el('label', { text: t('pair.host') }), host),
    el('div', { class: 'field' }, el('label', { text: t('pair.port') }), port),
    el('div', { class: 'field' }, el('label', { text: t('pair.code') }), code),
    el(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: () => {
          const address = host.value.trim();
          const value = code.value.trim().toUpperCase();
          if (!address || value.length !== 6) {
            ctx.toast(t('pair.wrongCode'), 'err');
            return;
          }
          // USB-C path first: adb reverse maps the phone's loopback to the PC.
          const hosts = address === '127.0.0.1' ? ['127.0.0.1'] : [address, '127.0.0.1'];
          void link.pair({ hosts, port: Number(port.value) || 8765, code: value, name: address });
        },
      },
      icon('link', 15),
      t('pair.connect'),
    ),
    el('div', { class: 'hint', style: 'margin-top:10px' }, t('pair.hint')),
  );

  const manualToggle = el(
    'button',
    { class: 'btn ghost', type: 'button', style: 'margin-top:10px' },
    t('pair.manual'),
  );
  manualToggle.addEventListener('click', () => {
    manualOpen = !manualOpen;
    manual.style.display = manualOpen ? 'block' : 'none';
  });

  const body = el(
    'div',
    {},
    el(
      'div',
      { class: 'pair-hero' },
      el('div', { class: 'glyph' }, loopMark(40)),
      el('h1', { text: 'OpenLink' }),
      el('p', { text: t('app.tagline') }),
      scan,
      status,
    ),
    el(
      'div',
      { class: 'card tight' },
      el('div', { class: 'card-title' }, icon('shield', 13), t('app.local')),
      el('div', { class: 'hint', style: 'margin-top:8px' }, t('pair.hint')),
    ),
    el(
      'div',
      { class: 'card tight' },
      el('div', { class: 'card-title' }, icon('usb', 13), t('status.usb')),
      el('div', { class: 'hint', style: 'margin-top:8px' }, t('pair.usbHint')),
    ),
    el(
      'div',
      { style: 'margin-top:6px' },
      seg(
        [
          { value: 'en' as const, label: 'English' },
          { value: 'de' as const, label: 'Deutsch' },
        ],
        state.settings.lang,
        (value) => void ctx.saveSettings({ lang: value }),
      ),
    ),
    manualToggle,
    manual,
  );

  return {
    el: body,
    update(next) {
      if (next.linkState === 'connecting' || next.linkState === 'pairing') {
        status.textContent = t('pair.connecting');
        scan.setAttribute('disabled', 'true');
      } else if (next.linkState === 'offline') {
        status.textContent = t('status.disconnected');
        scan.removeAttribute('disabled');
      } else if (next.linkState === 'error') {
        status.textContent = t('pair.failed');
        scan.removeAttribute('disabled');
      } else {
        status.textContent = '';
        scan.removeAttribute('disabled');
      }
    },
  };
}
