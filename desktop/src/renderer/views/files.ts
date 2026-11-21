import type { AppState, Ctx, View } from '../types';
import { el, fmtBytes, fmtRate, icon, switchControl, timeAgo } from '../ui';

export function filesView(ctx: Ctx): View {
  const { api, t } = ctx;
  const list = el('div', { class: 'list' });
  const toggles = el('div', { class: 'card' });

  const zone = el(
    'div',
    { class: 'dropzone', tabindex: '0', role: 'button' },
    icon('upload', 22),
    el('div', { text: t('files.drop') }),
  );

  const pick = (): void => {
    void api.pickFiles().then((pushed) => {
      if (pushed.length) ctx.notify(`${pushed.length} × ${t('files.send')}`);
    });
  };

  zone.addEventListener('click', pick);
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') pick();
  });
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('over');
    const files = Array.from(event.dataTransfer?.files ?? []);
    const paths = files.map((file) => api.pathForFile(file)).filter(Boolean);
    if (!paths.length) return;
    void api.pushFiles(paths).then((pushed) => {
      if (pushed.length) ctx.notify(`${pushed.length} × ${t('files.send')}`);
    });
  });

  const body = el(
    'div',
    {},
    zone,
    el('div', { class: 'section-title', text: t('files.title') }),
    list,
    el('div', { class: 'section-title', text: t('settings.autosync') }),
    toggles,
  );

  const renderToggles = (state: AppState): void => {
    const s = state.settings;
    if (!s) return;
    toggles.replaceChildren(
      el(
        'div',
        { class: 'switch-row' },
        el('div', {}, el('div', { class: 'label', text: t('files.screenshotSync') }), el('div', { class: 'desc', text: `${s.screenshotDir}` })),
        switchControl(s.autosyncScreenshots, (value) => void api.updateSettings({ autosyncScreenshots: value }).then(() => ctx.refresh()), t('files.screenshotSync')),
      ),
      el(
        'div',
        { class: 'switch-row' },
        el('div', {}, el('div', { class: 'label', text: t('files.photoSync') }), el('div', { class: 'desc', text: s.receiveDir })),
        switchControl(s.autosyncPhotos, (value) => void api.updateSettings({ autosyncPhotos: value }).then(() => ctx.refresh()), t('files.photoSync')),
      ),
      el(
        'div',
        { style: 'display:flex;gap:8px;padding-top:12px' },
        el('button', { class: 'btn sm ghost', type: 'button', onclick: () => void api.openReceiveDir() }, icon('folder', 12), t('files.openFolder')),
      ),
    );
  };

  const renderList = (state: AppState): void => {
    list.replaceChildren();
    if (!state.transfers.length) {
      list.append(el('div', { class: 'empty', text: t('files.empty') }));
      return;
    }
    for (const transfer of state.transfers) {
      const pct =
        transfer.status === 'active' && transfer.size > 0
          ? Math.min(100, ((transfer.received ?? 0) / transfer.size) * 100)
          : 100;
      const row = el(
        'div',
        { class: 'row' },
        el('div', { class: 'grow' },
          el('div', { class: 'title', text: transfer.name }),
          el('div', { class: 'meta', text: `${transfer.direction === 'in' ? '↓' : '↑'} ${fmtBytes(transfer.size)} · ${fmtRate(transfer.bps)} · ${timeAgo(transfer.ts)}` }),
          transfer.status === 'active' ? el('div', { class: 'bar' }, el('i', { style: `width:${pct}%` })) : null,
        ),
        el('div', { class: 'amount', text: transfer.status === 'done' ? t('files.done') : transfer.status === 'failed' ? '✕' : '…' }),
        transfer.savedPath
          ? el('div', { class: 'actions' }, el('button', { class: 'btn sm ghost', type: 'button', onclick: () => void api.reveal(transfer.savedPath!) }, icon('folder', 11)))
          : null,
      );
      list.append(row);
    }
  };

  renderToggles(ctx.state);
  renderList(ctx.state);

  return {
    el: body,
    update(state) {
      renderList(state);
      renderToggles(state);
    },
  };
}
