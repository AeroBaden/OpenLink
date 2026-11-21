import type { NowPlaying, PhoneNotification, ServerMessage, ServerStatus, Telemetry } from '../../../shared/protocol';
import { translate } from '../../../shared/i18n';
import type { AppState, CastApi, Ctx, OpenLinkApi, PairingTicket, View, ViewId } from './types';
import { createCast, type CastController } from './webrtc';
import { el, icon, loopMark, toast } from './ui';
import { linkView } from './views/link';
import { sensorsView } from './views/sensors';
import { deckView } from './views/deck';
import { filesView } from './views/files';
import { inboxView } from './views/inbox';
import { settingsView } from './views/settings';

let bridge = window.openlink as OpenLinkApi | undefined;
if (!bridge && import.meta.env.DEV) {
  // Browser-only design preview: no Electron preload, sample data only.
  bridge = (await import('./devMock')).installDevMock();
}
if (!bridge) throw new Error('OpenLink preload bridge unavailable');
const api: OpenLinkApi = bridge;

const state: AppState = {
  status: null,
  settings: null,
  telemetry: null,
  media: null,
  clipboard: [],
  transfers: [],
  notifications: [],
  pairing: null,
  theme: (localStorage.getItem('openlink.theme') as 'dark' | 'light') ?? 'dark',
  lang: (localStorage.getItem('openlink.lang') as 'en' | 'de') ?? 'en',
  view: (localStorage.getItem('openlink.view') as ViewId) ?? 'link',
  connected: false,
  lastTab: null,
};

document.documentElement.dataset.theme = state.theme;
document.documentElement.lang = state.lang;

const cast: CastController = createCast({
  send: (signal) => {
    void api.rtcSend(signal);
  },
  notify: (message, kind) => toast(message, kind),
});

const t = (key: string): string => translate(state.lang, key);
const notify = (message: string, kind: 'ok' | 'err' = 'ok'): void => toast(message, kind);

const ctx: Ctx = {
  state,
  api,
  t,
  refresh: () => refresh(),
  setView: (view) => setView(view),
  notify,
  cast: cast as CastApi,
};

const NAV: { id: ViewId; icon: string; key: string }[] = [
  { id: 'link', icon: 'link', key: 'nav.overview' },
  { id: 'sensors', icon: 'gauge', key: 'nav.sensors' },
  { id: 'deck', icon: 'grid', key: 'nav.deck' },
  { id: 'files', icon: 'folder', key: 'nav.files' },
  { id: 'inbox', icon: 'inbox', key: 'nav.clipboard' },
  { id: 'settings', icon: 'settings', key: 'nav.settings' },
];

const rail = el('div', { class: 'rail' });
const topbar = el('div', { class: 'topbar' });
const viewHost = el('div', { id: 'view' });
const app = document.getElementById('app')!;

app.append(rail, el('div', { class: 'main' }, topbar, viewHost));

let currentId: ViewId | null = null;
let currentView: View | null = null;

function buildRail(): void {
  rail.replaceChildren();
  rail.append(el('div', { class: 'brand' }, loopMark(24)));
  for (const item of NAV) {
    const button = el(
      'button',
      { class: 'nav-btn', type: 'button', title: t(item.key), 'aria-current': state.view === item.id ? 'page' : 'false' },
      icon(item.icon, 17),
      el('span', { text: t(item.key) }),
    );
    if (item.id === 'inbox' && state.notifications.length) {
      button.append(el('i', { class: 'dot' }));
    }
    button.addEventListener('click', () => setView(item.id));
    rail.append(button);
  }
  rail.append(el('div', { class: 'rail-spacer' }));
  const themeButton = el(
    'button',
    { class: 'theme-toggle', type: 'button', title: state.theme === 'dark' ? 'Light mode' : 'OLED black', 'aria-label': 'Toggle theme' },
    icon(state.theme === 'dark' ? 'sun' : 'moon', 15),
  );
  themeButton.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    localStorage.setItem('openlink.theme', state.theme);
    buildRail();
  });
  rail.append(themeButton);
}

function buildTopbar(): void {
  const status = state.status;
  const connected = state.connected;
  const name = state.settings?.serverName ?? status?.serverInfo.name ?? 'OpenLink';
  const pills = el('div', { class: 'topbar-actions' });
  pills.append(
    el('span', { class: connected ? 'pill ok' : 'pill' }, el('i', { class: 'led' }), connected ? t('status.connected') : t('status.disconnected')),
  );
  if (connected) {
    pills.append(el('span', { class: 'pill' }, icon(status?.transport === 'usb' ? 'usb' : 'wifi', 11), status?.transport === 'usb' ? t('status.usb') : t('status.wifi')));
  }
  if (state.settings?.devices?.[0]) {
    pills.append(el('span', { class: 'pill' }, icon('phone', 11), state.settings.devices[0].name));
  }
  const pairButton = el('button', { class: 'btn sm', type: 'button' }, icon('qr', 12), t('pair.title'));
  pairButton.addEventListener('click', () => {
    setView('link');
    void api.issuePairing().then((ticket) => {
      state.pairing = ticket;
      refresh();
    });
  });
  pills.append(pairButton);

  topbar.replaceChildren(
    el('div', {}, el('div', { class: 'host-name' }, name, el('small', { text: `${t('app.local')} · v${status?.serverInfo.version ?? '1.0.0'}` }))),
    pills,
  );
}

function setView(view: ViewId): void {
  state.view = view;
  localStorage.setItem('openlink.view', view);
  buildRail();
  mount(view);
}

function mount(view: ViewId): void {
  currentId = view;
  currentView = null;
  viewHost.replaceChildren();
  switch (view) {
    case 'link':
      currentView = linkView(ctx);
      break;
    case 'sensors':
      currentView = sensorsView(ctx);
      break;
    case 'deck':
      currentView = deckView(ctx);
      break;
    case 'files':
      currentView = filesView(ctx);
      break;
    case 'inbox':
      currentView = inboxView(ctx);
      break;
    case 'settings':
      currentView = settingsView(ctx);
      break;
  }
  if (currentView) {
    viewHost.append(currentView.el);
    currentView.update?.(state);
  }
}

function refresh(): void {
  if (state.settings) {
    state.lang = state.settings.lang;
    document.documentElement.lang = state.lang;
  }
  buildRail();
  buildTopbar();
  if (currentId !== state.view) mount(state.view);
  else currentView?.update?.(state);
}

function activeUpdate(): void {
  currentView?.update?.(state);
}

/* ------------------------------------------------------------------- events */

api.on('status', (payload) => {
  state.status = payload as ServerStatus;
  state.connected = Boolean(state.status?.transport);
  if (!state.connected) state.pairing = null;
  buildTopbar();
  buildRail();
  if (state.view === 'link') activeUpdate();
});

api.on('settings', (payload) => {
  state.settings = payload as AppState['settings'];
  refresh();
});

api.on('telemetry', (payload) => {
  state.telemetry = payload as Telemetry;
  if (state.view === 'sensors') activeUpdate();
});

api.on('media', (payload) => {
  state.media = payload as NowPlaying;
  if (state.view === 'inbox') activeUpdate();
});

api.on('clipboard', (payload) => {
  state.clipboard = payload as AppState['clipboard'];
  if (state.view === 'inbox') activeUpdate();
});

api.on('clipboardIncoming', () => {
  notify(t('clip.received') ?? t('common.copied'));
});

api.on('transfer', (payload) => {
  const update = payload as { id: string; received: number; total: number; bps: number };
  const existing = state.transfers.find((item) => item.id === update.id);
  if (existing) {
    existing.received = update.received;
    existing.bps = update.bps;
    existing.status = 'active';
  } else {
    state.transfers.unshift({
      id: update.id,
      name: update.id,
      size: update.total,
      received: update.received,
      bps: update.bps,
      direction: 'in',
      ts: Date.now(),
      status: 'active',
    });
  }
  if (state.view === 'files') activeUpdate();
});

api.on('pairing', (payload) => {
  state.pairing = payload as PairingTicket;
  setView('link');
  refresh();
});

api.on('phone', (payload) => {
  const message = payload as ServerMessage;
  switch (message.t) {
    case 'rtc.signal':
      void cast.handleSignal(message as never);
      break;
    case 'rtc.request':
      if (message.stream === 'pc-screen' || message.stream === 'pc-audio') {
        void cast.start(message.stream).catch((err: Error) => notify(err.message, 'err'));
      }
      break;
    case 'tab.offered':
      state.lastTab = { url: message.url, title: message.title };
      if (state.view === 'inbox') activeUpdate();
      break;
    case 'notify.incoming': {
      const notification = message.notification as PhoneNotification;
      state.notifications = [notification, ...state.notifications.filter((n) => n.id !== notification.id)].slice(0, 40);
      buildRail();
      if (state.view === 'inbox') activeUpdate();
      break;
    }
    case 'file.done':
      notify(`${t('files.received')}: ${message.name}`);
      void api.settings().then((settings) => {
        state.settings = settings;
        state.transfers = settings.transfers;
        if (state.view === 'files') activeUpdate();
      });
      break;
    case 'clipboard.incoming':
      state.clipboard = [message.entry, ...state.clipboard.filter((entry) => entry.id !== message.entry.id)].slice(0, 20);
      if (state.view === 'inbox') activeUpdate();
      break;
    default:
      break;
  }
});

/* --------------------------------------------------------------------- boot */

async function boot(): Promise<void> {
  try {
    const [status, settings, telemetry, media] = await Promise.all([
      api.status(),
      api.settings(),
      api.telemetry(),
      api.media(),
    ]);
    state.status = status;
    state.connected = Boolean(status?.transport);
    state.settings = settings;
    state.telemetry = telemetry;
    state.media = media;
    state.clipboard = settings.clipboard ?? [];
    state.transfers = settings.transfers ?? [];
    state.lang = settings.lang;
    document.documentElement.lang = state.lang;
  } catch (err) {
    notify((err as Error).message, 'err');
  }
  buildRail();
  buildTopbar();
  mount(state.view);
}

setInterval(() => {
  if (state.view === 'link' && currentView) currentView.update?.(state);
}, 1_000);

void boot();
