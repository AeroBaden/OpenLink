import type { Macro, MacroAction, MacroTint } from '../../../../shared/protocol';
import type { AppState, Ctx, View } from '../types';
import { el, icon, modal, toast } from '../ui';

const ICONS = ['mic-off', 'headset', 'record', 'lock', 'display-off', 'play', 'next', 'prev', 'bolt', 'monitor', 'speaker', 'grid'];
const TINTS: MacroTint[] = ['green', 'amber', 'red', 'ice', 'violet', 'neutral'];

function describe(action: MacroAction): string {
  switch (action.kind) {
    case 'keys':
      return action.keys;
    case 'text':
      return `type: ${action.text.slice(0, 22)}`;
    case 'launch':
      return action.path.split(/[\\/]/).pop() ?? action.path;
    case 'url':
      return action.url;
    case 'volume':
      return `volume ${action.level}`;
    case 'power':
      return action.action;
    default:
      return '—';
  }
}

function newMacro(): Macro {
  return {
    id: `macro-${Date.now().toString(36)}`,
    label: 'New macro',
    icon: 'bolt',
    tint: 'green',
    action: { kind: 'keys', keys: 'ctrl+shift+m' },
  };
}

function editor(ctx: Ctx, existing: Macro): void {
  const { api, t } = ctx;
  const draft: Macro = JSON.parse(JSON.stringify(existing));
  const label = el('input', { class: 'input', value: draft.label });
  const labelDe = el('input', { class: 'input', value: draft.labelDe ?? '' });
  const iconSelect = el('select', { class: 'select' }, ...ICONS.map((name) => el('option', { value: name, text: name })));
  iconSelect.value = draft.icon;
  const tintSelect = el('select', { class: 'select' }, ...TINTS.map((name) => el('option', { value: name, text: name })));
  tintSelect.value = draft.tint;
  const kindSelect = el(
    'select',
    { class: 'select' },
    ...[
      ['keys', t('deck.keys')],
      ['launch', t('deck.launch')],
      ['url', t('deck.url')],
      ['text', t('deck.text')],
      ['volume', t('deck.volume')],
      ['power', t('deck.power')],
    ].map(([value, text]) => el('option', { value, text })),
  );
  kindSelect.value = draft.action.kind;
  const param = el('input', { class: 'input' });
  const paramWrap = el('div', { class: 'field' }, el('label', { text: t('deck.keys') }), param, el('div', { class: 'hint', text: t('deck.keysHint') }));

  const syncParam = (): void => {
    const kind = kindSelect.value as MacroAction['kind'];
    const first = paramWrap.querySelector('label') as HTMLElement;
    if (kind === 'keys') {
      first.textContent = t('deck.keys');
      param.value = draft.action.kind === 'keys' ? draft.action.keys : '';
    } else if (kind === 'launch') {
      first.textContent = t('deck.launch');
      param.value = draft.action.kind === 'launch' ? draft.action.path : '';
    } else if (kind === 'url') {
      first.textContent = t('deck.url');
      param.value = draft.action.kind === 'url' ? draft.action.url : '';
    } else if (kind === 'text') {
      first.textContent = t('deck.text');
      param.value = draft.action.kind === 'text' ? draft.action.text : '';
    } else if (kind === 'volume') {
      first.textContent = `${t('deck.volume')} (0-100, mute, up, down)`;
      param.value = draft.action.kind === 'volume' ? String(draft.action.level) : '50';
    } else {
      first.textContent = `${t('deck.power')} (lock, sleep, display-off)`;
      param.value = draft.action.kind === 'power' ? draft.action.action : 'lock';
    }
  };
  kindSelect.addEventListener('change', syncParam);
  syncParam();

  const body = el(
    'div',
    {},
    el('div', { class: 'field' }, el('label', { text: t('deck.label') }), label),
    el('div', { class: 'field' }, el('label', { text: 'Label (Deutsch)' }), labelDe),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' },
      el('div', { class: 'field' }, el('label', { text: 'Icon' }), iconSelect),
      el('div', { class: 'field' }, el('label', { text: t('deck.tint') }), tintSelect),
    ),
    el('div', { class: 'field' }, el('label', { text: t('deck.action') }), kindSelect),
    paramWrap,
  );

  const commit = (): void => {
    draft.label = label.value.trim() || draft.label;
    draft.labelDe = labelDe.value.trim() || undefined;
    draft.icon = iconSelect.value;
    draft.tint = tintSelect.value as MacroTint;
    const kind = kindSelect.value as MacroAction['kind'];
    if (kind === 'keys') draft.action = { kind, keys: param.value.trim() || 'ctrl+shift+m' };
    else if (kind === 'launch') draft.action = { kind, path: param.value.trim() };
    else if (kind === 'url') draft.action = { kind, url: param.value.trim() };
    else if (kind === 'text') draft.action = { kind, text: param.value };
    else if (kind === 'volume') {
      const raw = param.value.trim().toLowerCase();
      const level = raw === 'mute' || raw === 'unmute' || raw === 'up' || raw === 'down' ? raw : Number(raw);
      draft.action = { kind, level: Number.isFinite(level as number) ? Number(level) : 50 };
    } else {
      const action = param.value.trim() as 'lock' | 'sleep' | 'display-off';
      draft.action = { kind: 'power', action: ['lock', 'sleep', 'display-off'].includes(action) ? action : 'lock' };
    }
    void api.saveMacro(draft).then(() => {
      document.querySelector('.scrim')?.remove();
      toast(t('settings.saved'));
      ctx.refresh();
    });
  };

  modal(t('deck.edit'), t('deck.title'), body, [
    el('button', { class: 'btn ghost', type: 'button', text: t('common.cancel'), onclick: () => document.querySelector('.scrim')?.remove() }),
    el('button', { class: 'btn primary', type: 'button', text: t('common.save'), onclick: commit }),
  ]);
}

export function deckView(ctx: Ctx): View {
  const { api, t } = ctx;
  const grid = el('div', { class: 'deck' });
  const body = el(
    'div',
    {},
    el(
      'div',
      { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:14px' },
      el('div', { class: 'hint', text: t('deck.title') }),
      el(
        'div',
        { style: 'display:flex;gap:8px' },
        el('button', { class: 'btn ghost sm', type: 'button', onclick: () => {
          const preset = ['preset-mic', 'preset-discord', 'preset-record', 'preset-lock', 'preset-screenoff', 'preset-playpause'];
          void Promise.all(preset.map((id) => api.saveMacro({ ...newMacro(), id }))).then(() => ctx.refresh());
        } }, icon('plus', 12), t('deck.addPresets')),
        el('button', { class: 'btn primary sm', type: 'button', onclick: () => editor(ctx, newMacro()) }, icon('plus', 12), t('deck.newMacro')),
      ),
    ),
    grid,
  );

  const render = (state: AppState): void => {
    grid.replaceChildren();
    const macros = state.settings?.macros ?? [];
    if (!macros.length) {
      grid.append(el('div', { class: 'empty', text: t('deck.empty') }));
      return;
    }
    for (const macro of macros) {
      const key = el(
        'button',
        { class: 'key', type: 'button', 'data-tint': macro.tint, onclick: () => {
          void api.runMacro(macro.id).then((ok) => {
            toast(ok ? `${t('deck.run')} → ${macro.label}` : t('error.server'), ok ? 'ok' : 'err');
          });
        } },
        el('div', { class: 'glyph' }, icon(macro.icon, 15)),
        el('div', {}, el('div', { class: 'name', text: state.lang === 'de' && macro.labelDe ? macro.labelDe : macro.label }), el('div', { class: 'meta', text: describe(macro.action) })),
      );
      const edit = el('button', { class: 'btn sm ghost edit', type: 'button', 'aria-label': t('deck.edit') }, icon('edit', 11));
      edit.addEventListener('click', (event) => {
        event.stopPropagation();
        editor(ctx, macro);
      });
      const del = el('button', { class: 'btn sm ghost', type: 'button', style: 'position:absolute;bottom:8px;right:8px;opacity:0', 'aria-label': t('common.delete') }, icon('trash', 11));
      del.className = 'btn sm ghost';
      del.style.cssText = 'position:absolute;bottom:9px;right:9px;opacity:0;transition:opacity 120ms';
      del.addEventListener('click', (event) => {
        event.stopPropagation();
        void api.deleteMacro(macro.id).then(() => ctx.refresh());
      });
      key.append(edit, del);
      key.addEventListener('mouseenter', () => (del.style.opacity = '1'));
      key.addEventListener('mouseleave', () => (del.style.opacity = '0'));
      grid.append(key);
    }
  };

  render(ctx.state);
  return { el: body, update: render };
}
