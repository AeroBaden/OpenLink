import { Clipboard } from '@capacitor/clipboard';
import type { MCtx, MView, Transfer } from '../ctx';
import { uploadBlob } from '../lib/files';
import { Native } from '../lib/native';
import { el, icon, timeAgo } from '../ui';

export function inboxView(ctx: MCtx): MView {
  const { t, state, link } = ctx;
  const clipList = el('div', { class: 'list' });
  const fileList = el('div', { class: 'list' });
  const notifList = el('div', { class: 'list' });
  const composer = el('textarea', { class: 'input', rows: '2', placeholder: t('clip.placeholder'), style: 'height:auto;padding:10px 12px;resize:none' });
  const tabInput = el('input', { class: 'input', placeholder: 'https://…', inputmode: 'url' });

  const sendClip = async (): Promise<void> => {
    const value = composer.value.trim();
    if (!value) return;
    if (state.linkState !== 'online') {
      ctx.toast(t('error.disconnected'), 'err');
      return;
    }
    await link.send({ t: 'clipboard.push', text: value });
    composer.value = '';
    ctx.toast(t('clip.sent'));
  };

  const pickAndSend = (): void => {
    const input = el('input', { type: 'file' });
    input.style.display = 'none';
    document.body.append(input);
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      if (state.linkState !== 'online') {
        ctx.toast(t('error.disconnected'), 'err');
        return;
      }
      const transfer: Transfer = {
        id: `local-${Date.now()}`,
        name: file.name,
        size: file.size,
        received: 0,
        bps: 0,
        status: 'active',
        direction: 'out',
      };
      state.transfers = [transfer, ...state.transfers];
      ctx.refresh();
      void uploadBlob(link.httpBase, link.token, file.name, file.type, file, (received, _total, bps) => {
        transfer.received = received;
        transfer.bps = bps;
        ctx.refresh();
      })
        .then(() => {
          transfer.received = transfer.size;
          transfer.status = 'done';
          ctx.toast(t('files.done'));
          ctx.refresh();
        })
        .catch((err: Error) => {
          transfer.status = 'failed';
          ctx.toast(err.message, 'err');
          ctx.refresh();
        });
    });
    input.click();
  };

  const shareButton = el('button', { class: 'btn', type: 'button' }, icon('upload', 15), t('files.choose'));
  shareButton.addEventListener('click', pickAndSend);

  const body = el(
    'div',
    {},
    el('div', { class: 'section-title', text: t('clip.title') }),
    el('div', { class: 'card tight' },
      composer,
      el('div', { style: 'display:flex;gap:8px;margin-top:8px' },
        el('button', { class: 'btn sm primary', type: 'button', onclick: () => void sendClip() }, icon('send', 12), t('clip.send')),
        el('button', { class: 'btn sm ghost', type: 'button', onclick: () => { composer.value = ''; } }, t('common.cancel')),
        el('button', { class: 'btn sm ghost', type: 'button', onclick: () => void link.send({ t: 'clipboard.clear' }).then(() => ctx.toast(t('clip.clear'))) }, icon('trash', 12)),
      ),
    ),
    clipList,
    el('div', { class: 'section-title', text: t('files.title') }),
    shareButton,
    el('div', { style: 'height:10px' }),
    fileList,
    el('div', { class: 'section-title', text: t('notif.title') }),
    notifList,
    el('div', { class: 'section-title', text: t('tabs.title') }),
    el('div', { class: 'card tight' },
      tabInput,
      el('button', { class: 'btn sm', type: 'button', style: 'margin-top:8px', onclick: () => {
        const url = tabInput.value.trim();
        if (!/^https?:\/\//i.test(url)) {
          ctx.toast(t('error.server'), 'err');
          return;
        }
        void link.send({ t: 'tab.handoff', url, title: url }).then(() => ctx.toast(t('tabs.opened')));
      } }, icon('arrow', 12), t('tabs.open')),
    ),
  );

  const renderClipboard = (): void => {
    clipList.replaceChildren();
    if (!state.clipboard.length) {
      clipList.append(el('div', { class: 'empty', text: t('clip.empty') }));
      return;
    }
    for (const item of state.clipboard) {
      const row = el(
        'div',
        { class: 'row' },
        el('div', { class: 'grow' },
          el('div', { class: 'title', text: item.text.replace(/\s+/g, ' ').slice(0, 140) }),
          el('div', { class: 'meta', text: `${item.origin === 'pc' ? t('clip.fromPc') : t('clip.fromPhone')} · ${timeAgo(item.ts)}` }),
        ),
      );
      row.addEventListener('click', async () => {
        await Clipboard.write({ string: item.text });
        await ctx.haptics('light');
        ctx.toast(t('common.copied'));
      });
      clipList.append(row);
    }
  };

  const renderFiles = (): void => {
    fileList.replaceChildren();
    if (!state.transfers.length) {
      fileList.append(el('div', { class: 'empty', text: t('files.empty') }));
      return;
    }
    for (const transfer of state.transfers.slice(0, 12)) {
      const row = el(
        'div',
        { class: 'row' },
        el('div', { class: 'grow' },
          el('div', { class: 'title', text: transfer.name }),
          el('div', { class: 'meta', text: `${transfer.direction === 'in' ? '↓' : '↑'} ${(transfer.size / 1024 / 1024).toFixed(1)} MB · ${transfer.status === 'active' ? `${(transfer.bps / 1024 / 1024).toFixed(1)} MB/s` : transfer.status}` }),
          transfer.status === 'active'
            ? el('div', { class: 'therm-bar', style: 'margin-top:6px' }, el('i', { style: `width:${Math.min(100, (transfer.received / Math.max(1, transfer.size)) * 100)}%` }))
            : null,
        ),
        transfer.path
          ? el('button', { class: 'btn sm ghost', type: 'button', onclick: () => void Native.openUrl({ url: transfer.path! }).catch(() => ctx.toast(t('error.unsupported'), 'err')) }, icon('folder', 11))
          : null,
      );
      fileList.append(row);
    }
  };

  const renderNotifications = (): void => {
    notifList.replaceChildren();
    if (!state.notificationAccess) {
      notifList.append(
        el('div', { class: 'empty' },
          el('div', { text: t('notif.permission') }),
          el('button', { class: 'btn sm', type: 'button', style: 'margin:12px auto 0', onclick: () => void Native.openNotificationSettings() }, t('notif.enable')),
        ),
      );
      return;
    }
    if (!state.notifications.length) {
      notifList.append(el('div', { class: 'empty', text: t('notif.empty') }));
      return;
    }
    for (const notification of state.notifications.slice(0, 10)) {
      const input = el('input', { class: 'input', placeholder: t('notif.reply'), style: 'height:34px;font-size:11.5px' });
      const reply = (): void => {
        const value = input.value.trim();
        if (!value) return;
        void Native.replyNotification({ id: notification.id, text: value }).then(({ ok }) => {
          ctx.toast(ok ? t('notif.send') : t('error.unsupported'), ok ? 'ok' : 'err');
          input.value = '';
        });
      };
      input.addEventListener('keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Enter') reply();
      });
      notifList.append(
        el('div', { class: 'row', style: 'display:block' },
          el('div', { class: 'meta', text: `${notification.app} · ${timeAgo(notification.ts)}` }),
          el('div', { style: 'font-size:12.5px;margin-top:2px', text: notification.title }),
          el('div', { class: 'hint', style: 'margin-top:2px', text: notification.text }),
          notification.canReply
            ? el('div', { style: 'display:flex;gap:6px;margin-top:8px' }, input,
                el('button', { class: 'btn sm', type: 'button', onclick: reply }, icon('send', 11)))
            : null,
        ),
      );
    }
  };

  renderClipboard();
  renderFiles();
  renderNotifications();

  return {
    el: body,
    update() {
      renderClipboard();
      renderFiles();
      renderNotifications();
    },
  };
}
