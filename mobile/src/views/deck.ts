import type { MCtx, MView } from '../ctx';
import type { MacroAction } from '../../../shared/protocol';
import { el, icon } from '../ui';

function describe(action: MacroAction): string {
  switch (action.kind) {
    case 'keys':
      return action.keys;
    case 'launch':
      return action.path.split(/[\\/]/).pop() ?? action.path;
    case 'url':
      return action.url;
    case 'text':
      return `text · ${action.text.slice(0, 16)}`;
    case 'volume':
      return `vol ${action.level}`;
    case 'power':
      return action.action;
    default:
      return '';
  }
}

export function deckView(ctx: MCtx): MView {
  const { t, state, link } = ctx;
  const grid = el('div', { class: 'deck' });
  const hint = el('div', { class: 'hint', style: 'margin-bottom:10px' });

  const body = el('div', {}, hint, grid);

  const render = (): void => {
    grid.replaceChildren();
    const macros = state.macros;
    hint.textContent = state.linkState === 'online' ? t('deck.title') : t('error.disconnected');
    if (!macros.length) {
      grid.append(el('div', { class: 'empty', text: t('deck.empty') }));
      return;
    }
    for (const macro of macros) {
      const key = el(
        'button',
        { class: 'macro', type: 'button', 'data-tint': macro.tint },
        el('div', { class: 'glyph' }, icon(macro.icon, 14)),
        el('div', {},
          el('div', { class: 'label', text: state.settings.lang === 'de' && macro.labelDe ? macro.labelDe : macro.label }),
          el('div', { class: 'meta', text: describe(macro.action) }),
        ),
      );
      key.addEventListener('click', async () => {
        if (state.linkState !== 'online') {
          ctx.toast(t('error.disconnected'), 'err');
          return;
        }
        await ctx.haptics('medium');
        try {
          if (macro.confirm) {
            key.style.borderColor = 'var(--amber)';
            setTimeout(() => (key.style.borderColor = ''), 250);
          }
          await link.send({ t: 'macro.run', id: macro.id });
          ctx.toast(t('deck.sent'));
        } catch (err) {
          ctx.toast((err as Error).message, 'err');
        }
      });
      grid.append(key);
    }
  };

  render();
  return {
    el: body,
    update() {
      render();
    },
  };
}
