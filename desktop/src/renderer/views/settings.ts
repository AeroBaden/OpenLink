import type { AppState, Ctx, View } from '../types';
import { clear, el, icon, modal, seg, switchControl } from '../ui';

export function settingsView(ctx: Ctx): View {
  const { api, t } = ctx;
  const body = el('div', {});
  const hostBody = el('div');

  const render = (state: AppState): void => {
    clear(body);
    const settings = state.settings;
    if (!settings) return;

    const nameInput = el('input', { class: 'input', value: settings.serverName });
    const portInput = el('input', { class: 'input', value: String(settings.port), inputmode: 'numeric' });
    const save = el(
      'button',
      {
        class: 'btn primary',
        type: 'button',
        onclick: () => {
          const port = Number(portInput.value);
          void api
            .updateSettings({ serverName: nameInput.value.trim() || settings.serverName, port })
            .then(() => {
              ctx.notify(t('settings.saved'));
              ctx.refresh();
            })
            .catch((err: Error) => ctx.notify(err.message, 'err'));
        },
      },
      icon('check', 13),
      t('settings.save'),
    );

    clear(hostBody);
    hostBody.append(
      el('div', { class: 'grid two' },
        el('div', { class: 'field' }, el('label', { text: t('settings.language') }), el('div', {}, seg([
          { value: 'en' as const, label: 'English' },
          { value: 'de' as const, label: 'Deutsch' },
        ], settings.lang, (value) => void api.updateSettings({ lang: value }).then(() => ctx.refresh())))),
        el('div', { class: 'field' }, el('label', { text: t('settings.language') }), el('div', {}, seg([
          { value: 'dark' as const, label: 'OLED' },
          { value: 'light' as const, label: 'Light' },
        ], state.theme, (value) => {
          state.theme = value;
          document.documentElement.dataset.theme = value;
          localStorage.setItem('openlink.theme', value);
          ctx.refresh();
        }))),
      ),
      el('div', { class: 'grid two' },
        el('div', { class: 'field' }, el('label', { text: 'Host name' }), nameInput),
        el('div', { class: 'field' }, el('label', { text: t('settings.port') }), portInput),
      ),
      el('div', { style: 'display:flex;gap:8px' }, save),
    );

    const toggles = el('div', { class: 'card' });
    const toggleRows: { label: string; desc: string; value: boolean; patch: Record<string, unknown> }[] = [
      { label: t('settings.startup'), desc: 'HKCU\\…\\Run', value: settings.startup, patch: { startup: true } },
      { label: t('settings.tray'), desc: t('settings.closeHint'), value: settings.closeToTray, patch: { closeToTray: true } },
      { label: t('files.screenshotSync'), desc: settings.screenshotDir, value: settings.autosyncScreenshots, patch: { autosyncScreenshots: true } },
      { label: t('files.photoSync'), desc: settings.receiveDir, value: settings.autosyncPhotos, patch: { autosyncPhotos: true } },
    ];
    for (const item of toggleRows) {
      const key = Object.keys(item.patch)[0];
      toggles.append(
        el(
          'div',
          { class: 'switch-row' },
          el('div', {}, el('div', { class: 'label', text: item.label }), el('div', { class: 'desc', text: item.desc })),
          switchControl(item.value, (value) => void api.updateSettings({ [key]: value }).then(() => ctx.refresh()), item.label),
        ),
      );
    }

    const unlock = settings.unlockStatus;
    const device = settings.devices[0];
    const unlockCard = el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' },
        el('div', { class: 'card-title' }, icon('unlock', 13), t('settings.unlock')),
        el('span', { class: unlock.enrolled ? 'pill ok' : 'pill' }, el('i', { class: 'led' }), unlock.enrolled ? t('settings.enrolled') : t('settings.enroll')),
      ),
      el('div', { class: 'hint', text: t('settings.unlockHint') }),
      !unlock.elevated ? el('div', { class: 'hint', style: 'color:var(--amber);margin-top:8px', text: 'Administrator rights are required once to install the SYSTEM unlock helper.' }) : null,
      unlock.error ? el('div', { class: 'hint', style: 'color:var(--red);margin-top:8px', text: unlock.error }) : null,
      el('div', { class: 'switch-row', style: 'margin-top:6px' },
        el('div', {}, el('div', { class: 'label', text: t('settings.arm') }), el('div', { class: 'desc', text: t('settings.biometricHint') })),
        switchControl(settings.unlockArmed, (value) => void api.armUnlock(value).then(() => ctx.refresh()), t('settings.arm')),
      ),
      device
        ? el('div', { style: 'display:flex;gap:8px;margin-top:12px' },
            el('button', { class: 'btn sm', type: 'button', onclick: () => {
              const input = el('input', { class: 'input', type: 'password', placeholder: '••••••' });
              modal(t('settings.unlock'), t('settings.winPasswordHint'), el('div', { class: 'field' }, el('label', { text: t('settings.winPassword') }), input), [
                el('button', { class: 'btn ghost', type: 'button', text: t('common.cancel'), onclick: () => document.querySelector('.scrim')?.remove() }),
                el('button', { class: 'btn primary', type: 'button', text: t('common.save'), onclick: () => {
                  const value = input.value;
                  if (!value) return;
                  void api.enrollUnlock(device.id, value).then((res) => {
                    document.querySelector('.scrim')?.remove();
                    if (res.ok) { ctx.notify(t('settings.saved')); ctx.refresh(); }
                    else ctx.notify(res.error ?? t('error.server'), 'err');
                  });
                } }),
              ]);
            } }, icon('shield', 12), unlock.enrolled ? `${t('settings.enroll')} (rotate)` : t('settings.enroll')),
          )
        : null,
    );

    const diagnostics = el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('div', { class: 'card-title' }, icon('gauge', 13), t('settings.diagnostics'))),
      el('div', { class: 'metric' }, el('span', { text: t('settings.port') }), el('span', { text: String(state.status?.port ?? '—') })),
      el('div', { class: 'metric' }, el('span', { text: 'Transport' }), el('span', { text: state.status?.transport ?? '—' })),
      el('div', { class: 'metric' }, el('span', { text: 'ADB' }), el('span', { text: state.status?.adb.serial ?? '—' })),
      el('div', { class: 'metric' }, el('span', { text: 'DPAPI' }), el('span', { text: settings.secureStorage ? 'available' : 'unavailable' })),
      el('div', { class: 'metric' }, el('span', { text: 'Version' }), el('span', { text: state.status?.serverInfo.version ?? '—' })),
      el('div', { class: 'metric' }, el('span', { text: 'LAN' }), el('span', { text: state.status?.lanAddresses.join(', ') ?? '—' })),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:14px' },
        el('button', { class: 'btn sm ghost', type: 'button', onclick: () => void api.openLogs() }, icon('folder', 11), t('settings.openLogs')),
        el('button', { class: 'btn sm ghost', type: 'button', onclick: () => void api.openReceiveDir() }, icon('download', 11), t('files.openFolder')),
        el('button', { class: 'btn sm danger', type: 'button', onclick: () => {
          if (!confirm(t('pair.unpairConfirm'))) return;
          void api.resetPairing().then(() => { ctx.notify(t('settings.reset')); ctx.refresh(); });
        } }, icon('trash', 11), t('settings.reset')),
      ),
    );

    body.append(
      el('div', { class: 'section-title', text: t('settings.title') }),
      hostBody,
      el('div', { class: 'section-title', text: t('settings.autosync') }),
      toggles,
      el('div', { class: 'section-title', text: t('settings.session') }),
      el('div', { class: 'grid two' }, unlockCard, diagnostics),
    );
  };

  render(ctx.state);
  return { el: body, update: render };
}
