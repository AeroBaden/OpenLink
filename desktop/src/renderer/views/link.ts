import type { AppState, Ctx, View } from '../types';
import { clear, el, icon, modal, switchControl, timeAgo } from '../ui';

function row(label: string, value: string): HTMLElement {
  return el('div', { class: 'metric' }, el('span', { text: label }), el('span', { text: value }));
}

export function linkView(ctx: Ctx): View {
  const { api, t } = ctx;
  const qrImage = el('img', { alt: 'Pairing QR code' });
  const qrEmpty = el('div', { class: 'qr-empty', text: t('pair.hint') });
  const codeNode = el('div', { class: 'code dim', text: '· · · · · ·' });
  const countdown = el('div', { class: 'sub' });
  const deviceNode = el('div');
  const detailsNode = el('div');
  const quickNode = el('div');

  const refreshPairing = async (): Promise<void> => {
    try {
      const ticket = await api.issuePairing();
      ctx.state.pairing = ticket;
      ctx.refresh();
    } catch (err) {
      ctx.notify((err as Error).message, 'err');
    }
  };

  const qrCard = el(
    'div',
    { class: 'card' },
    el(
      'div',
      { class: 'card-head' },
      el('div', { class: 'card-title' }, icon('qr', 13), t('pair.title')),
      el(
        'div',
        { style: 'display:flex;gap:6px' },
        el('button', { class: 'btn sm ghost', type: 'button', onclick: () => void refreshPairing() }, icon('bolt', 12), t('pair.newCode')),
      ),
    ),
    el('div', { class: 'qr-tile' }, qrImage, qrEmpty),
    el('div', { style: 'margin-top:14px;display:flex;align-items:flex-end;justify-content:space-between;gap:12px' },
      el('div', {}, el('div', { class: 'hint', text: t('pair.code') }), codeNode, countdown),
    ),
    el('div', { class: 'hint', style: 'margin-top:12px' }, t('pair.firewall')),
  );

  const body = el(
    'div',
    {},
    el('div', { class: 'pair-layout' }, qrCard, el('div', { class: 'card', style: 'display:flex;flex-direction:column;gap:2px' }, deviceNode, detailsNode)),
    el('div', { class: 'section-title', text: t('settings.autosync') }),
    quickNode,
  );

  let lastSignature = '';
  let lastIssue = 0;

  const renderDevice = (state: AppState): void => {
    const device = state.settings?.devices?.[0] ?? null;
    const connected = state.connected;
    const s0 = state.settings;
    const signature = [
      device?.id ?? 'none',
      connected ? '1' : '0',
      state.status?.transport ?? '-',
      state.status?.adb.reversed ? '1' : '0',
      s0?.autosyncScreenshots ? '1' : '0',
      s0?.unlockArmed ? '1' : '0',
      s0?.startup ? '1' : '0',
      s0?.unlockStatus.enrolled ? '1' : '0',
      s0?.unlockStatus.elevated ? '1' : '0',
      device?.lastSeen ?? 0,
    ].join('|');
    if (signature === lastSignature) return;
    lastSignature = signature;
    clear(deviceNode);
    clear(detailsNode);
    clear(quickNode);

    if (device) {
      deviceNode.append(
        el('div', { class: 'card-title' }, icon('phone', 13), t('pair.device')),
        el('div', { class: 'host-name', style: 'margin:6px 0 12px' }, device.name, el('small', { text: device.model ?? 'Android' })),
        el(
          'div',
          { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px' },
          el('span', { class: connected ? 'pill ok' : 'pill' }, el('i', { class: 'led' }), connected ? t('status.connected') : t('status.disconnected')),
          el('span', { class: 'pill' }, icon(state.status?.transport === 'usb' ? 'usb' : 'wifi', 11), state.status?.transport === 'usb' ? t('status.usb') : t('status.wifi')),
          el('span', { class: 'pill' }, icon('shield', 11), t('status.encrypted')),
        ),
      );
      detailsNode.append(
        row(t('status.lan'), state.status?.lanAddresses?.[0] ?? '—'),
        row(t('settings.port'), String(state.status?.port ?? 8765)),
        row(t('status.adb'), state.status?.adb.reversed ? t('status.adbOn') : t('status.adbOff')),
        row('Last seen', device.lastSeen ? `${timeAgo(device.lastSeen)} ago` : '—'),
      );
      detailsNode.append(
        el(
          'div',
          { style: 'display:flex;gap:8px;margin-top:auto;padding-top:16px' },
          el(
            'button',
            {
              class: 'btn sm ghost',
              type: 'button',
              onclick: () => {
                void api.resetPairing().then(() => ctx.notify(t('settings.reset')));
              },
            },
            icon('trash', 12),
            t('pair.unpair'),
          ),
        ),
      );
    } else {
      deviceNode.append(
        el('div', { class: 'card-title' }, icon('phone', 13), t('pair.device')),
        el('div', { class: 'empty', text: t('pair.hint') }),
        el(
          'button',
          { class: 'btn primary', type: 'button', onclick: () => void refreshPairing() },
          icon('qr', 13),
          t('pair.scan'),
        ),
      );
    }

    if (state.settings) {
      const s = state.settings;
      const options: { label: string; desc: string; value: boolean; set: (v: boolean) => void }[] = [
        {
          label: t('files.screenshotSync'),
          desc: t('settings.screenshots'),
          value: s.autosyncScreenshots,
          set: (v) => void api.updateSettings({ autosyncScreenshots: v }).then(() => ctx.refresh()),
        },
        {
          label: t('settings.unlock'),
          desc: t('settings.arm'),
          value: s.unlockArmed,
          set: (v) => void api.armUnlock(v).then(() => ctx.refresh()),
        },
        {
          label: t('settings.startup'),
          desc: t('settings.tray'),
          value: s.startup,
          set: (v) => void api.updateSettings({ startup: v }).then(() => ctx.refresh()),
        },
      ];
      const card = el('div', { class: 'card' });
      for (const option of options) {
        card.append(
          el(
            'div',
            { class: 'switch-row' },
            el('div', {}, el('div', { class: 'label', text: option.label }), el('div', { class: 'desc', text: option.desc })),
            switchControl(option.value, option.set, option.label),
          ),
        );
      }
      quickNode.append(card);
    }

    if (device && state.settings) {
      const unlock = state.settings.unlockStatus;
      const card = el('div', { class: 'card', style: 'margin-top:12px' });
      card.append(
        el('div', { class: 'card-head' }, el('div', { class: 'card-title' }, icon('unlock', 13), t('settings.unlock')), el('span', { class: unlock.enrolled ? 'pill ok' : 'pill' }, el('i', { class: 'led' }), unlock.enrolled ? t('settings.enrolled') : t('settings.enroll'))),
        el('div', { class: 'hint', text: t('settings.unlockHint') }),
      );
      if (!unlock.enrolled) {
        card.append(
          el(
            'button',
            {
              class: 'btn',
              type: 'button',
              style: 'margin-top:12px',
              onclick: () => {
                const input = el('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: '••••••' });
                const warning = el('div', { class: 'hint', style: 'color:var(--amber)' , text: unlock.elevated ? '' : 'OpenLink must run as administrator once to install the unlock helper.' });
                modal(
                  t('settings.unlock'),
                  t('settings.winPasswordHint'),
                  el('div', {}, el('div', { class: 'field' }, el('label', { text: t('settings.winPassword') }), input), warning),
                  [
                    el('button', { class: 'btn ghost', type: 'button', text: t('common.cancel'), onclick: () => document.querySelector('.scrim')?.remove() }),
                    el(
                      'button',
                      {
                        class: 'btn primary',
                        type: 'button',
                        text: t('common.save'),
                        onclick: () => {
                          const value = input.value;
                          if (!value) return;
                          void api.enrollUnlock(device.id, value).then((res) => {
                            document.querySelector('.scrim')?.remove();
                            if (res.ok) {
                              ctx.notify(t('settings.saved'));
                              void api.armUnlock(true);
                              ctx.refresh();
                            } else {
                              ctx.notify(res.error ?? t('error.server'), 'err');
                            }
                          });
                        },
                      },
                      t('common.save'),
                    ),
                  ],
                );
              },
            },
            icon('shield', 13),
            t('settings.enroll'),
          ),
        );
      }
      quickNode.append(card);
    }
  };

  renderDevice(ctx.state);

  return {
    el: body,
    update(state) {
      const ticket = state.pairing;
      const left = ticket ? Math.max(0, Math.round((ticket.expiresAt - Date.now()) / 1000)) : 0;
      if (ticket && left > 0) {
        if (qrImage.getAttribute('src') !== ticket.dataUrl) {
          qrImage.setAttribute('src', ticket.dataUrl);
          qrImage.classList.add('ready');
          qrEmpty.style.display = 'none';
        }
        codeNode.textContent = ticket.code;
        codeNode.classList.remove('dim');
        countdown.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} ${t('common.minutes')}`;
      } else {
        countdown.textContent = t('pair.expired');
      }
      // Keep a scannable code on screen at all times: refresh shortly before the
      // old one expires instead of leaving a dead QR behind.
      const stale = !ticket || left <= 20;
      if (!state.connected && stale && Date.now() - lastIssue > 3_000) {
        lastIssue = Date.now();
        void refreshPairing();
      }
      renderDevice(state);
    },
  };
}
