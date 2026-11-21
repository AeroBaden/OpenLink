import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { translate } from '../../shared/i18n';
import type { ClientMessage, PhoneNotification, ServerMessage, ServerStatus, Telemetry } from '../../shared/protocol';
import type { MCtx, MState, MView, ScreenId, Transfer } from './ctx';
import { LinkClient } from './lib/link';
import { PhoneRtc } from './lib/rtc';
import { downloadToDevice, readSharedBlob, uploadBlob } from './lib/files';
import { isAndroid, Native } from './lib/native';
import { demoClipboard, demoCredentials, demoMacros, demoMedia, demoNotifications, demoSample, demoStatus } from './lib/demo';
import { loadCredentials, loadSettings, saveCredentials, saveSettings, type AppSettings } from './lib/state';
import { el, fmtBytes, haptic, icon, toast } from './ui';
import { connectView } from './views/connect';
import { homeView } from './views/home';
import { sensorsView } from './views/sensors';
import { deckView } from './views/deck';
import { inboxView } from './views/inbox';
import { settingsView } from './views/settings';
import { keyboardSheet, padSheet, standbyOverlay, type StandbyView } from './views/overlays';

const state: MState = {
  screen: 'connect',
  linkState: 'idle',
  server: null,
  status: null,
  telemetry: null,
  media: null,
  clipboard: [],
  macros: [],
  notifications: [],
  notificationAccess: false,
  transfers: [],
  credentials: null,
  settings: {
    lang: 'en',
    theme: 'dark',
    autosyncPhotos: true,
    autosyncScreenshots: true,
    standbyMs: 15_000,
    standbyLayout: 'auto',
    standbyStyle: 'panels',
    requireBiometric: true,
    haptics: true,
  },
  rtc: { receiving: null, sending: null, error: null },
  standby: false,
  sheet: null,
  lastTab: null,
  shared: { count: 0, text: '', url: '' },
};

let link: LinkClient;
let rtc: PhoneRtc;
let standby: StandbyView | null = null;
let currentView: MView | null = null;
let lastActivity = Date.now();
let unread = 0;
let seenNotifications = new Set<string>();
let lastPhotoTs = 0;

const TABS: { id: ScreenId; icon: string; key: string }[] = [
  { id: 'home', icon: 'link', key: 'nav.overview' },
  { id: 'sensors', icon: 'gauge', key: 'nav.sensors' },
  { id: 'deck', icon: 'grid', key: 'nav.deck' },
  { id: 'inbox', icon: 'inbox', key: 'nav.clipboard' },
  { id: 'settings', icon: 'settings', key: 'nav.settings' },
];

const app = document.getElementById('app')!;
const header = el('div', { class: 'top' });
const screenHost = el('div', { class: 'screen' });
const tabs = el('div', { class: 'tabs' });

const t = (key: string): string => translate(state.settings.lang, key);

const ctx: MCtx = {
  state,
  get link() {
    return link;
  },
  get rtc() {
    return rtc;
  },
  t,
  toast,
  haptics: async (style = 'light') => {
    if (state.settings.haptics) await haptic(style);
  },
  refresh: () => refresh(),
  setScreen: (screen) => setScreen(screen),
  saveSettings: async (patch) => {
    state.settings = { ...state.settings, ...patch };
    await saveSettings(state.settings);
    applyTheme();
    refresh();
  },
  send: async (message) => {
    await link.send(message);
  },
  enterStandby: () => enterStandby(),
  exitStandby: () => exitStandby(),
  openSheet: (sheet) => {
    state.sheet = sheet;
    renderSheet();
  },
  closeSheet: () => {
    state.sheet = null;
    renderSheet();
  },
  lang: () => state.settings.lang,
  notificationsSeen: () => {
    unread = 0;
    renderTabs();
  },
} as MCtx;

function applyTheme(): void {
  document.documentElement.dataset.theme = state.settings.theme;
  void StatusBar.setStyle({ style: state.settings.theme === 'dark' ? Style.Dark : Style.Light }).catch(() => undefined);
  if (isAndroid) void Native.setChrome({ dark: state.settings.theme === 'dark' }).catch(() => undefined);
}

function renderHeader(): void {
  const online = state.linkState === 'online';
  const name = state.server?.name ?? state.credentials?.serverName ?? 'OpenLink';
  header.replaceChildren(
    el('div', {},
      el('div', { class: 'title', text: state.standby ? '' : name }),
      el('div', { class: 'subtitle', text: state.standby ? '' : online ? `${t('status.encrypted')} · ${t('app.local')}` : t('app.disconnected') }),
    ),
    el('div', { style: 'display:flex;gap:6px;align-items:center' },
      el('span', { class: online ? 'pill ok' : 'pill warn' }, el('i', { class: 'led' }), online ? (link.transport === 'usb' ? t('status.usb') : t('status.wifi')) : t('status.disconnected')),
      el('button', { class: 'pill', type: 'button', 'aria-label': t('common.refresh'), onclick: () => void link.rescan() }, icon('refresh', 11)),
    ),
  );
}

function renderTabs(): void {
  tabs.replaceChildren();
  if (state.screen === 'connect') {
    tabs.style.display = 'none';
    return;
  }
  tabs.style.display = 'flex';
  for (const tab of TABS) {
    const button = el('button', { class: 'tab', type: 'button', 'aria-current': state.screen === tab.id ? 'page' : 'false' }, icon(tab.icon, 19), el('span', { text: t(tab.key) }));
    if (tab.id === 'inbox' && unread > 0) button.append(el('i', { class: 'badge' }));
    button.addEventListener('click', () => setScreen(tab.id));
    tabs.append(button);
  }
}

function refresh(): void {
  renderHeader();
  renderTabs();
  currentView?.update?.(state);
  if (standby) standby.update();
}

function mount(screen: ScreenId): void {
  currentView = null;
  screenHost.replaceChildren();
  switch (screen) {
    case 'connect':
      currentView = connectView(ctx);
      break;
    case 'home':
      currentView = homeView(ctx);
      break;
    case 'sensors':
      currentView = sensorsView(ctx);
      break;
    case 'deck':
      currentView = deckView(ctx);
      break;
    case 'inbox':
      currentView = inboxView(ctx);
      break;
    case 'settings':
      currentView = settingsView(ctx);
      break;
  }
  if (currentView) {
    screenHost.append(currentView.el);
    currentView.update?.(state);
  }
}

function setScreen(screen: ScreenId): void {
  state.screen = screen;
  if (screen === 'inbox') {
    unread = 0;
    ctx.notificationsSeen();
  }
  renderHeader();
  renderTabs();
  mount(screen);
}

function renderSheet(): void {
  document.querySelector('.sheet')?.remove();
  if (!state.sheet) return;
  const node = state.sheet === 'pad' ? padSheet(ctx) : keyboardSheet(ctx);
  document.body.append(node);
}

/* ------------------------------------------------------------------ standby */

function enterStandby(): void {
  if (state.standby) return;
  if (state.settings.standbyMs === 0) return;
  state.standby = true;
  standby = standbyOverlay(ctx);
  document.body.append(standby.el);
  void Native.keepAwake({ enabled: true }).catch(() => undefined);
  void StatusBar.hide().catch(() => undefined);
  renderHeader();
}

function exitStandby(): void {
  if (!state.standby) return;
  state.standby = false;
  standby?.el.remove();
  standby = null;
  void Native.keepAwake({ enabled: false }).catch(() => undefined);
  void StatusBar.show().catch(() => undefined);
  lastActivity = Date.now();
  renderHeader();
  refresh();
}

/* ----------------------------------------------------------------- messages */

async function handleMessage(message: ServerMessage): Promise<void> {
  switch (message.t) {
    case 'telemetry':
      state.telemetry = message.sample as Telemetry;
      break;
    case 'media':
      state.media = message.state;
      break;
    case 'clipboard':
      state.clipboard = message.items;
      break;
    case 'clipboard.incoming':
      state.clipboard = [message.entry, ...state.clipboard.filter((item) => item.id !== message.entry.id)].slice(0, 20);
      break;
    case 'macro.list':
      state.macros = message.macros;
      break;
    case 'file.push':
      toast(`${message.offer.name} · ${fmtBytes(message.offer.size)}`);
      try {
        const path = await downloadToDevice(link.httpBase, link.token, message.url, message.offer.name, message.offer.mime);
        const received: Transfer = {
          id: message.offer.id,
          name: message.offer.name,
          size: message.offer.size,
          received: message.offer.size,
          bps: 0,
          status: 'done',
          direction: 'in',
          path,
        };
        state.transfers = [received, ...state.transfers].slice(0, 20);
      } catch (err) {
        toast((err as Error).message, 'err');
      }
      break;
    case 'file.progress': {
      const existing = state.transfers.find((item) => item.id === message.id);
      if (existing) {
        existing.received = message.received;
        existing.bps = message.bps;
      }
      break;
    }
    case 'file.done': {
      const existing = state.transfers.find((item) => item.id === message.id);
      if (existing) existing.status = 'done';
      else if (message.path) {
        const done: Transfer = {
          id: message.id,
          name: message.name,
          size: 0,
          received: 0,
          bps: 0,
          status: 'done',
          direction: 'out',
          path: message.path,
        };
        state.transfers = [done, ...state.transfers].slice(0, 20);
      }
      break;
    }
    case 'unlock.challenge': {
      try {
        const ts = Date.now();
        const signature = await signWithBiometric(`${message.nonce}:${ts}`, t('unlock.authenticate'));
        await link.send({ t: 'unlock.signature', nonce: message.nonce, signature, ts });
      } catch (err) {
        toast((err as Error).message || t('unlock.failed'), 'err');
      }
      break;
    }
    case 'unlock.result':
      toast(message.ok ? t('unlock.success') : `${t('unlock.failed')}${message.reason ? ` · ${message.reason}` : ''}`, message.ok ? 'ok' : 'err');
      break;
    case 'notify.reply':
      await Native.replyNotification({ id: message.id, text: message.text }).catch(() => undefined);
      break;
    case 'rtc.signal':
      await rtc.handleSignal(message as never).catch(() => undefined);
      state.rtc = rtc.state;
      break;
    case 'tab.offered':
      state.lastTab = { url: message.url, title: message.title };
      toast(t('tabs.opened'));
      break;
    case 'status':
      state.status = message.status as ServerStatus;
      break;
    case 'error':
      toast(message.message, 'err');
      break;
    default:
      return;
  }
  refresh();
}

async function signWithBiometric(payload: string, reason: string): Promise<string> {
  const { signIdentity } = await import('./lib/native');
  return signIdentity(payload, reason, state.settings.requireBiometric);
}

/* ------------------------------------------------------------------ pollers */

async function pollNotifications(): Promise<void> {
  if (!isAndroid || state.linkState !== 'online') return;
  try {
    const { access, notifications } = await Native.notifications();
    const wasAllowed = state.notificationAccess;
    state.notificationAccess = access;
    if (!access) {
      if (wasAllowed) refresh();
      return;
    }
    const fresh = (notifications as PhoneNotification[]).filter((item) => !seenNotifications.has(item.id));
    if (fresh.length) {
      seenNotifications = new Set(notifications.map((item) => item.id));
      unread += fresh.length;
      for (const notification of fresh.slice(0, 5)) {
        await link.send({ t: 'notify.push', notification }).catch(() => undefined);
      }
      renderTabs();
    }
  } catch {
    /* notification listener not connected yet */
  }
}

async function syncPhotos(): Promise<void> {
  if (!isAndroid || state.linkState !== 'online' || !state.settings.autosyncPhotos) return;
  try {
    const { photos } = await Native.getRecentPhotos({ since: lastPhotoTs, limit: 3 });
    for (const photo of photos) {
      await link.send({ t: 'photo.push', photo });
      lastPhotoTs = Math.max(lastPhotoTs, photo.takenAt);
    }
  } catch {
    /* permission or MediaStore hiccup */
  }
}

async function consumeShare(): Promise<void> {
  if (!isAndroid) return;
  try {
    const shared = await Native.getSharedContent();
    if (!shared.text && !shared.url && !shared.items.length) return;
    if (state.linkState !== 'online') {
      toast(t('error.disconnected'), 'err');
      return;
    }
    if (shared.text) await link.send({ t: 'clipboard.push', text: shared.text });
    if (shared.url) await link.send({ t: 'tab.handoff', url: shared.url, title: shared.url });
    for (const item of shared.items) {
      const blob = await readSharedBlob(item.path);
      const transfer: Transfer = { id: `share-${Date.now()}`, name: item.name, size: item.size, received: 0, bps: 0, status: 'active', direction: 'out' };
      state.transfers = [transfer, ...state.transfers];
      refresh();
      await uploadBlob(link.httpBase, link.token, item.name, item.mime, blob, (received, _total, bps) => {
        transfer.received = received;
        transfer.bps = bps;
      });
      transfer.status = 'done';
      transfer.received = transfer.size;
    }
    toast(t('files.done'));
    await Native.clearShared();
    refresh();
  } catch (err) {
    toast((err as Error).message, 'err');
  }
}

/* --------------------------------------------------------------------- demo */

function seedDemo(mode: string): void {
  const params = new URLSearchParams(location.search);
  const style = params.get('style');
  if (style === 'text' || style === 'panels') state.settings.standbyStyle = style;
  const layout = params.get('layout');
  if (layout === 'portrait' || layout === 'landscape') state.settings.standbyLayout = layout;
  state.linkState = 'online';
  state.status = demoStatus;
  state.server = demoStatus.serverInfo;
  state.media = demoMedia;
  state.macros = demoMacros;
  state.clipboard = demoClipboard;
  state.notifications = demoNotifications;
  state.notificationAccess = true;
  state.lastTab = { url: 'https://github.com/AeroBaden/OpenLink', title: 'OpenLink — local continuity' };
  let tick = 0;
  state.telemetry = demoSample(tick);
  setInterval(() => {
    tick += 1;
    state.telemetry = demoSample(tick);
    if (state.screen === 'home' || state.screen === 'sensors') refresh();
  }, 1_000);

  const screen =
    mode === 'sensors' ? 'sensors' : mode === 'deck' ? 'deck' : mode === 'inbox' ? 'inbox' : mode === 'settings' ? 'settings' : 'home';
  setScreen(screen);
  if (mode === 'standby') enterStandby();
}

/* --------------------------------------------------------------------- boot */

async function boot(): Promise<void> {
  // `?demo` renders the real UI with sample data in a desktop browser (design
  // review and screenshots only; stripped from release builds).
  const demoParams = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
  const demoMode = demoParams?.has('demo') ? demoParams.get('demo') || 'home' : null;
  state.settings = await loadSettings();
  state.credentials = demoMode ? demoCredentials : await loadCredentials();
  link = new LinkClient(state.credentials);
  rtc = new PhoneRtc(link);
  await link.initDeviceInfo();
  applyTheme();

  link.on('state', (value) => {
    state.linkState = value;
    if (value === 'online') {
      lastActivity = Date.now();
      void consumeShare();
      if (state.screen === 'connect') setScreen('home');
    }
    if (value === 'offline' && state.screen !== 'connect' && !state.credentials) setScreen('connect');
    refresh();
  });
  link.on('server', (server) => {
    state.server = server;
    renderHeader();
  });
  link.on('credentials', async (credentials) => {
    state.credentials = credentials;
    await saveCredentials(credentials);
    setScreen('home');
  });
  link.on('status', (status) => {
    state.status = status;
    refresh();
  });
  link.on('message', (message) => void handleMessage(message));
  link.on('error', (error) => {
    toast(error === 'auth.reject' ? t('pair.failed') : t('error.network'), 'err');
  });

  app.append(header, screenHost, tabs);
  renderHeader();
  renderTabs();

  if (demoMode) {
    seedDemo(demoMode);
  } else if (state.credentials) {
    setScreen('home');
    mount('home');
    void link.connect();
  } else {
    setScreen('connect');
  }

  window.addEventListener('openlink:camera', () => {
    void rtc.startCamera().then(() => {
      state.rtc = rtc.state;
      refresh();
    }).catch((err: Error) => toast(err.message, 'err'));
  });
  window.addEventListener('openlink:stop-camera', () => {
    rtc.stopCamera();
    state.rtc = rtc.state;
    refresh();
  });
  rtc.subscribe(() => {
    state.rtc = rtc.state;
    refresh();
  });

  for (const event of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(event, () => (lastActivity = Date.now()), { passive: true });
  }

  setInterval(() => {
    if (standby) standby.update();
    if (state.standby) return;
    if (state.settings.standbyMs > 0 && state.linkState === 'online' && Date.now() - lastActivity > state.settings.standbyMs) {
      enterStandby();
    }
  }, 1_000);

  const landscape = window.matchMedia('(orientation: landscape)');
  landscape.addEventListener('change', (event) => {
    if (event.matches && state.linkState === 'online' && state.settings.standbyMs > 0) enterStandby();
  });

  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) {
      void consumeShare();
      void pollNotifications();
      if (state.credentials && state.linkState !== 'online') void link.connect();
    }
  });
  App.addListener('backButton', () => {
    if (state.sheet) {
      state.sheet = null;
      renderSheet();
      return;
    }
    if (state.standby) {
      exitStandby();
      return;
    }
    if (state.screen !== 'home') setScreen('home');
    else void App.exitApp();
  });

  setInterval(() => void pollNotifications(), 6_000);
  setInterval(() => void syncPhotos(), 300_000);
  void pollNotifications();
}

void boot();

export type { AppSettings, ClientMessage };
