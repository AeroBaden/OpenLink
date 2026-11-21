import type { AppState, Ctx, View } from '../types';
import { clear, el, icon, timeAgo } from '../ui';

export function inboxView(ctx: Ctx): View {
  const { api, t, cast } = ctx;
  const mediaNode = el('div', { class: 'card' });
  const clipNode = el('div', { class: 'list' });
  const notifNode = el('div', { class: 'list' });
  const video = el('video', { class: 'spark', style: 'height:auto;aspect-ratio:16/9;background:#000;border-radius:10px;object-fit:contain', autoplay: 'true', playsinline: 'true', muted: 'true' });
  const castStatus = el('div', { class: 'hint' });
  cast.attach(video);

  const castButtons = el(
    'div',
    { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' },
    el('button', { class: 'btn sm', type: 'button', onclick: () => void cast.start('pc-screen').catch((e: Error) => ctx.notify(e.message, 'err')) }, icon('monitor', 12), t('settings.pcScreen')),
    el('button', { class: 'btn sm', type: 'button', onclick: () => void cast.start('pc-audio').catch((e: Error) => ctx.notify(e.message, 'err')) }, icon('speaker', 12), t('settings.pcAudio')),
    el('button', { class: 'btn sm ghost', type: 'button', onclick: () => cast.stop() }, icon('close', 12), t('common.close')),
  );

  const body = el(
    'div',
    {},
    el('div', { class: 'split' }, mediaNode, el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('div', { class: 'card-title' }, icon('monitor', 13), t('settings.session'))), video, castStatus, castButtons)),
    el('div', { class: 'section-title', text: t('clip.history') }),
    clipNode,
    el('div', { class: 'section-title', text: t('notif.title') }),
    notifNode,
  );

  const renderMedia = (state: AppState): void => {
    clear(mediaNode);
    const media = state.media;
    mediaNode.append(
      el('div', { class: 'card-head' }, el('div', { class: 'card-title' }, icon('speaker', 13), t('media.title')), el('span', { class: media?.playing ? 'pill ok' : 'pill' }, el('i', { class: 'led' }), media?.playing ? 'Playing' : 'Paused')),
      el('div', { style: 'font-size:16px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: media?.title || t('media.none') }),
      el('div', { class: 'sub', text: media?.artist || '—' }),
      el(
        'div',
        { style: 'display:flex;gap:8px;margin-top:14px' },
        el('button', { class: 'btn sm ghost', type: 'button', 'aria-label': t('media.prev'), onclick: () => void api.mediaCommand('prev') }, icon('prev', 12)),
        el('button', { class: 'btn sm', type: 'button', 'aria-label': t('media.play'), onclick: () => void api.mediaCommand('playpause') }, icon(media?.playing ? 'pause' : 'play', 12)),
        el('button', { class: 'btn sm ghost', type: 'button', 'aria-label': t('media.next'), onclick: () => void api.mediaCommand('next') }, icon('next', 12)),
      ),
    );
    if (state.lastTab) {
      mediaNode.append(
        el('div', { style: 'margin-top:14px' },
          el('div', { class: 'hint', text: t('tabs.title') }),
          el('div', { class: 'mono-line', text: state.lastTab.url }),
          el('button', { class: 'btn sm ghost', type: 'button', style: 'margin-top:6px', onclick: () => void api.openUrl(state.lastTab!.url) }, icon('link', 11), t('tabs.open')),
        ),
      );
    }
  };

  const renderClipboard = (state: AppState): void => {
    clipNode.replaceChildren();
    const items = state.clipboard.slice(0, 20);
    if (!items.length) {
      clipNode.append(el('div', { class: 'empty', text: t('clip.empty') }));
      return;
    }
    for (const item of items) {
      const preview = item.text.replace(/\s+/g, ' ').slice(0, 160);
      clipNode.append(
        el(
          'div',
          { class: 'row' },
          el('div', { class: 'grow' },
            el('div', { class: 'title', text: preview || '∅' }),
            el('div', { class: 'meta', text: `${item.origin === 'pc' ? t('clip.fromPc') : t('clip.fromPhone')} · ${timeAgo(item.ts)}` }),
          ),
          el(
            'div',
            { class: 'actions' },
            el('button', { class: 'btn sm ghost', type: 'button', onclick: () => { void api.pushClipboard(item.text); ctx.notify(t('common.copied')); } }, icon('copy', 11)),
            el('button', { class: 'btn sm ghost', type: 'button', onclick: () => void api.removeClipboard(item.id) }, icon('trash', 11)),
          ),
        ),
      );
    }
  };

  const renderNotifications = (state: AppState): void => {
    notifNode.replaceChildren();
    if (!state.notifications.length) {
      notifNode.append(el('div', { class: 'empty', text: t('notif.empty') }));
      return;
    }
    for (const notification of state.notifications.slice(0, 12)) {
      const input = el('input', { class: 'input', placeholder: t('notif.reply') });
      const send = (): void => {
        const value = input.value.trim();
        if (!value) return;
        void api.notifyReply(notification.id, value);
        input.value = '';
        ctx.notify(t('notif.send'));
      };
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') send();
      });
      notifNode.append(
        el('div', { class: 'notif' },
          el('div', { class: 'grow' },
            el('div', { class: 'app', text: `${notification.app} · ${timeAgo(notification.ts)}` }),
            el('div', { class: 'title', text: notification.title }),
            el('div', { class: 'body', text: notification.text }),
            notification.canReply
              ? el('div', { class: 'reply' }, input, el('button', { class: 'btn sm', type: 'button', onclick: send }, icon('arrow', 11), t('notif.send')))
              : null,
          ),
        ),
      );
    }
  };

  const renderCast = (): void => {
    castStatus.textContent = cast.state.active ? `Cast: ${cast.state.stream}` : cast.state.error ?? '';
    video.style.display = cast.state.stream === 'phone-camera' || cast.state.active ? 'block' : 'none';
  };

  cast.subscribe(renderCast);

  renderMedia(ctx.state);
  renderClipboard(ctx.state);
  renderNotifications(ctx.state);
  renderCast();

  return {
    el: body,
    update(state) {
      renderMedia(state);
      renderClipboard(state);
      renderNotifications(state);
      renderCast();
    },
  };
}
