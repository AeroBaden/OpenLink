import { contextBridge, ipcRenderer, webUtils } from 'electron';

/**
 * Narrow, explicitly enumerated bridge. The renderer never sees Node or the
 * filesystem; every privileged action goes through a named IPC handler.
 */
const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
  ipcRenderer.invoke(`openlink:${channel}`, ...args);

const subscribe = (channel: string, cb: (payload: unknown) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => cb(payload);
  ipcRenderer.on(`openlink:${channel}`, listener);
  return () => ipcRenderer.removeListener(`openlink:${channel}`, listener);
};

contextBridge.exposeInMainWorld('openlink', {
  status: () => invoke('status'),
  settings: () => invoke('settings'),
  updateSettings: (patch: Record<string, unknown>) => invoke('settings:update', patch),
  issuePairing: () => invoke('pairing:issue'),
  revokePairing: () => invoke('pairing:revoke'),
  resetPairing: () => invoke('pairing:reset'),
  saveMacro: (macro: unknown) => invoke('macros:save', macro),
  deleteMacro: (id: string) => invoke('macros:delete', id),
  runMacro: (id: string) => invoke('macros:run', id),
  clipboard: () => invoke('clipboard'),
  pushClipboard: (text: string) => invoke('clipboard:push', text),
  removeClipboard: (id: string) => invoke('clipboard:remove', id),
  clearClipboard: () => invoke('clipboard:clear'),
  telemetry: () => invoke('telemetry'),
  media: () => invoke('media'),
  mediaCommand: (action: string) => invoke('media:command', action),
  openUrl: (url: string) => invoke('open-url', url),
  pickFiles: () => invoke('files:pick'),
  pushFiles: (paths: string[]) => invoke('files:push-paths', paths),
  reveal: (target: string) => invoke('files:reveal', target),
  openReceiveDir: () => invoke('files:open-dir'),
  rtcSend: (message: unknown) => invoke('rtc:send', message),
  notifyReply: (id: string, text: string) => invoke('notify:reply', id, text),
  enrollUnlock: (deviceId: string, credential: string) => invoke('unlock:enroll', { deviceId, credential }),
  armUnlock: (armed: boolean) => invoke('unlock:arm', armed),
  openLogs: () => invoke('open-logs'),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  on: subscribe,
});
