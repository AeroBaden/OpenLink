import { App } from '@capacitor/app';
import type { MCtx, MView } from '../ctx';
import { Native } from '../lib/native';
import { clearCredentials } from '../lib/state';
import { el, icon, seg, switchControl } from '../ui';

export function settingsView(ctx: MCtx): MView {
  const { t, state, link } = ctx;
  const body = el('div', {});

  const render = (): void => {
    while (body.firstChild) body.removeChild(body.firstChild);
    const creds = state.credentials;
    const biometric = el('div', { class: 'hint', text: t('settings.biometricHint') });

    body.append(
      el('div', { class: 'section-title', text: t('settings.language') }),
      el('div', { class: 'card tight' },
        seg(
          [
            { value: 'en' as const, label: 'English' },
            { value: 'de' as const, label: 'Deutsch' },
          ],
          state.settings.lang,
          (value) => void ctx.saveSettings({ lang: value }),
        ),
        el('div', { style: 'margin-top:12px' },
          seg(
            [
              { value: 'dark' as const, label: 'OLED black' },
              { value: 'light' as const, label: 'Light' },
            ],
            state.settings.theme,
            (value) => void ctx.saveSettings({ theme: value }),
          ),
        ),
      ),

      el('div', { class: 'section-title', text: t('standby.idle') }),
      el('div', { class: 'card tight' },
        el('div', { class: 'hint', style: 'margin-bottom:8px' }, t('standby.hint')),
        seg(
          [
            { value: '15000', label: '15 s' },
            { value: '30000', label: '30 s' },
            { value: '60000', label: '60 s' },
            { value: '0', label: t('common.off') },
          ],
          String(state.settings.standbyMs),
          (value) => void ctx.saveSettings({ standbyMs: Number(value) }),
        ),
        el('div', { class: 'hint', style: 'margin:16px 0 8px' }, t('standby.style')),
        seg(
          [
            { value: 'panels' as const, label: t('standby.stylePanels') },
            { value: 'text' as const, label: t('standby.styleText') },
          ],
          state.settings.standbyStyle,
          (value) => void ctx.saveSettings({ standbyStyle: value }),
        ),
        el('div', { class: 'hint', style: 'margin:16px 0 8px' }, t('standby.layout')),
        seg(
          [
            { value: 'auto' as const, label: t('standby.auto') },
            { value: 'portrait' as const, label: t('standby.portrait') },
            { value: 'landscape' as const, label: t('standby.landscape') },
          ],
          state.settings.standbyLayout,
          (value) => void ctx.saveSettings({ standbyLayout: value }),
        ),
      ),

      el('div', { class: 'section-title', text: t('settings.autosync') }),
      el('div', { class: 'card tight' },
        el('div', { class: 'switch-row' },
          el('div', {}, el('div', { class: 'label', text: t('files.photoSync') }), el('div', { class: 'desc', text: t('settings.photos') })),
          switchControl(state.settings.autosyncPhotos, (value) => void ctx.saveSettings({ autosyncPhotos: value }), t('files.photoSync')),
        ),
        el('div', { class: 'switch-row' },
          el('div', {}, el('div', { class: 'label', text: t('files.screenshotSync') }), el('div', { class: 'desc', text: t('settings.screenshots') })),
          switchControl(state.settings.autosyncScreenshots, (value) => void ctx.saveSettings({ autosyncScreenshots: value }), t('files.screenshotSync')),
        ),
        el('div', { class: 'switch-row' },
          el('div', {}, el('div', { class: 'label', text: t('common.on') + ' · Haptics' }), el('div', { class: 'desc', text: 'Tactile feedback on the deck' })),
          switchControl(state.settings.haptics, (value) => void ctx.saveSettings({ haptics: value }), 'Haptics'),
        ),
      ),

      el('div', { class: 'section-title', text: t('unlock.title') }),
      el('div', { class: 'card tight' },
        el('div', { class: 'switch-row' },
          el('div', {}, el('div', { class: 'label', text: t('settings.biometric') }), biometric),
          switchControl(state.settings.requireBiometric, (value) => void ctx.saveSettings({ requireBiometric: value }), t('settings.biometric')),
        ),
        el('div', { class: 'hint', style: 'margin-top:10px' },
          creds ? `${t('pair.device')}: ${state.server?.name ?? creds.serverName} · ${creds.hosts[0] ?? ''}` : t('error.disconnected'),
        ),
        el('button', { class: 'btn sm ghost', style: 'margin-top:10px', type: 'button', onclick: () => void Native.openNotificationSettings() }, icon('bell', 12), t('notif.enable')),
      ),

      el('div', { class: 'section-title', text: t('settings.title') }),
      el('div', { class: 'card tight' },
        el('div', { class: 'metric' }, el('span', { text: t('pair.host') }), el('span', { text: link.activeHost || '—' })),
        el('div', { class: 'metric' }, el('span', { text: 'Transport' }), el('span', { text: link.transport === 'usb' ? t('status.usb') : t('status.wifi') })),
        el('div', { class: 'metric' }, el('span', { text: 'Notifications' }), el('span', { text: state.notificationAccess ? t('common.on') : t('common.off') })),
        el('div', { class: 'metric' }, el('span', { text: t('dash.source') }), el('span', { text: state.telemetry?.cpu.source ?? '—' })),
        el('div', { class: 'metric' }, el('span', { text: 'Version' }), el('span', { text: (state.server as { version?: string } | null)?.version ?? '1.0.0' })),
        el('div', { class: 'metric' }, el('span', { text: t('settings.port') }), el('span', { text: String(creds?.port ?? 8765) })),
      ),

      el('div', { style: 'display:flex;gap:8px;margin-top:4px' },
        el('button', { class: 'btn sm ghost', type: 'button', onclick: () => void link.rescan() }, icon('refresh', 12), t('common.refresh')),
        el('button', { class: 'btn sm danger', type: 'button', onclick: () => {
          void clearCredentials().then(() => {
            link.forget();
            state.credentials = null;
            state.status = null;
            ctx.setScreen('connect');
          });
        } }, icon('trash', 12), t('pair.unpair')),
      ),

      el('div', { class: 'hint', style: 'margin-top:16px;text-align:center' },
        el('div', { text: `${t('app.local')} · 100 % local · no account` }),
        el('button', { class: 'btn sm ghost', style: 'margin-top:10px', type: 'button', onclick: () => void App.exitApp() }, t('common.close')),
      ),
    );
  };

  render();
  return { el: body, update: render };
}
