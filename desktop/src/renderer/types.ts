import type {
  ClipboardEntry,
  Lang,
  Macro,
  NowPlaying,
  PhoneNotification,
  ServerStatus,
  Telemetry,
} from '../../../shared/protocol';

export interface DeviceSummary {
  id: string;
  name: string;
  model?: string;
  platform: string;
  lastSeen: number | null;
  unlockEnrolled: boolean;
}

export interface TransferSummary {
  id: string;
  name: string;
  size: number;
  received?: number;
  direction: 'in' | 'out';
  ts: number;
  bps: number;
  status: 'active' | 'done' | 'failed';
  savedPath?: string;
}

export interface UnlockStatus {
  enrolled: boolean;
  armed: boolean;
  lastAt: number | null;
  elevated: boolean;
  taskInstalled: boolean;
  error: string | null;
}

export interface DesktopSettings {
  lang: Lang;
  port: number;
  serverName: string;
  autosyncScreenshots: boolean;
  autosyncPhotos: boolean;
  startup: boolean;
  closeToTray: boolean;
  unlockArmed: boolean;
  requireBiometric: boolean;
  macros: Macro[];
  receiveDir: string;
  screenshotDir: string;
  devices: DeviceSummary[];
  unlockStatus: UnlockStatus;
  clipboard: ClipboardEntry[];
  transfers: TransferSummary[];
  secureStorage: boolean;
}

export interface PairingTicket {
  code: string;
  expiresAt: number;
  uri: string;
  dataUrl: string;
}

export interface AppState {
  status: ServerStatus | null;
  settings: DesktopSettings | null;
  telemetry: Telemetry | null;
  media: NowPlaying | null;
  clipboard: ClipboardEntry[];
  transfers: TransferSummary[];
  notifications: PhoneNotification[];
  pairing: PairingTicket | null;
  theme: 'dark' | 'light';
  lang: Lang;
  view: ViewId;
  connected: boolean;
  lastTab: { url: string; title: string } | null;
}

export type ViewId = 'link' | 'sensors' | 'deck' | 'files' | 'inbox' | 'settings';

export interface CastApi {
  state: { active: boolean; stream: 'pc-screen' | 'pc-audio' | 'phone-camera' | null; error: string | null };
  start(stream: 'pc-screen' | 'pc-audio'): Promise<void>;
  stop(): void;
  attach(video: HTMLVideoElement): void;
  subscribe(cb: () => void): () => void;
}

export interface Ctx {
  state: AppState;
  api: OpenLinkApi;
  t: (key: string) => string;
  refresh: () => void;
  setView: (view: ViewId) => void;
  notify: (message: string, kind?: 'ok' | 'err') => void;
  cast: CastApi;
}

export interface View {
  el: HTMLElement;
  update?: (state: AppState) => void;
}

export interface OpenLinkApi {
  status(): Promise<ServerStatus>;
  settings(): Promise<DesktopSettings>;
  updateSettings(patch: Record<string, unknown>): Promise<DesktopSettings>;
  issuePairing(): Promise<PairingTicket>;
  revokePairing(): Promise<ServerStatus>;
  resetPairing(): Promise<DesktopSettings>;
  saveMacro(macro: Macro): Promise<Macro[]>;
  deleteMacro(id: string): Promise<Macro[]>;
  runMacro(id: string): Promise<boolean>;
  clipboard(): Promise<ClipboardEntry[]>;
  pushClipboard(text: string): Promise<ClipboardEntry>;
  removeClipboard(id: string): Promise<ClipboardEntry[]>;
  clearClipboard(): Promise<ClipboardEntry[]>;
  telemetry(): Promise<Telemetry | null>;
  media(): Promise<NowPlaying | null>;
  mediaCommand(action: 'playpause' | 'next' | 'prev'): Promise<void>;
  openUrl(url: string): Promise<void>;
  pickFiles(): Promise<{ id: string; name: string }[]>;
  pushFiles(paths: string[]): Promise<{ id: string; name: string }[]>;
  reveal(target: string): Promise<void>;
  openReceiveDir(): Promise<void>;
  rtcSend(message: unknown): Promise<boolean>;
  notifyReply(id: string, text: string): Promise<void>;
  enrollUnlock(deviceId: string, credential: string): Promise<{ ok: boolean; error?: string }>;
  armUnlock(armed: boolean): Promise<ServerStatus>;
  openLogs(): Promise<void>;
  pathForFile(file: File): string;
  on(channel: string, cb: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    openlink: OpenLinkApi;
  }
}
