import type {
  ClipboardEntry,
  ClientMessage,
  Lang,
  Macro,
  NowPlaying,
  PhoneNotification,
  ServerInfo,
  ServerStatus,
  Telemetry,
} from '../../shared/protocol';
import type { LinkClient, LinkState } from './lib/link';
import type { PhoneRtc, RtcState } from './lib/rtc';
import type { AppSettings, Credentials } from './lib/state';

export type ScreenId = 'connect' | 'home' | 'sensors' | 'deck' | 'inbox' | 'settings';

export interface Transfer {
  id: string;
  name: string;
  size: number;
  received: number;
  bps: number;
  status: 'active' | 'done' | 'failed';
  direction: 'in' | 'out';
  path?: string;
}

export interface MState {
  screen: ScreenId;
  linkState: LinkState;
  server: ServerInfo | null;
  status: ServerStatus | null;
  telemetry: Telemetry | null;
  media: NowPlaying | null;
  clipboard: ClipboardEntry[];
  macros: Macro[];
  notifications: PhoneNotification[];
  notificationAccess: boolean;
  transfers: Transfer[];
  credentials: Credentials | null;
  settings: AppSettings;
  rtc: RtcState;
  standby: boolean;
  sheet: 'pad' | 'keyboard' | null;
  lastTab: { url: string; title: string } | null;
  shared: { count: number; text: string; url: string };
}

export interface MCtx {
  state: MState;
  link: LinkClient;
  rtc: PhoneRtc;
  t: (key: string) => string;
  toast: (message: string, kind?: 'ok' | 'err') => void;
  haptics: (style?: 'light' | 'medium' | 'heavy') => Promise<void>;
  refresh: () => void;
  setScreen: (screen: ScreenId) => void;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
  send: (message: ClientMessage) => Promise<void>;
  enterStandby: () => void;
  exitStandby: () => void;
  openSheet: (sheet: 'pad' | 'keyboard') => void;
  closeSheet: () => void;
  lang: () => Lang;
  notificationsSeen: () => void;
}

export interface MView {
  el: HTMLElement;
  update?: (state: MState) => void;
}
