import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, session, shell, Tray, safeStorage, desktopCapturer } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ClipboardEntry, Macro, ServerStatus, Telemetry } from '../../../shared/protocol';
import { getStore } from './store';
import { PairingManager } from './pairing';
import { TelemetryEngine } from './telemetry';
import { WindowsAgent } from './agent';
import { MediaBridge } from './media';
import { ClipboardSync } from './clipboard';
import { AdbBridge } from './adb';
import { FileService } from './files';
import { UnlockService } from './unlock';
import { LinkServer } from './server';
import { lanAddresses } from './net';

const VERSION = app.getVersion();
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

const store = getStore();
let server: LinkServer;
const resourcesDir = isDev ? path.join(app.getAppPath(), 'resources') : path.join(process.resourcesPath, 'resources');
const logFile = path.join(app.getPath('userData'), 'openlink.log');

function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    fs.appendFileSync(logFile, line, 'utf8');
  } catch {
    /* logging must never crash the app */
  }
  if (isDev) console.log('[openlink]', message);
}

function script(name: string): string {
  return path.join(resourcesDir, name);
}

const pairing = new PairingManager(() => server.port || store.settings.port, () => store.settings.serverName);
const agent = new WindowsAgent(() => script('openlink-agent.ps1'));
const telemetry = new TelemetryEngine({
  volume: () => agent.volume(),
  agentScriptPath: () => script('openlink-agent.ps1'),
});
const media = new MediaBridge(() => script('openlink-media.ps1'));
const clipboardSync = new ClipboardSync(path.join(app.getPath('userData'), 'clipboard.json'), (entry) => {
  server.onClipboardIncoming(entry);
  emit('clipboard', clipboardSync.history);
});
const files = new FileService({
  receiveDir: store.settings.receiveDir,
  photoDir: path.join(store.settings.receiveDir, 'Photos'),
  screenshotDir: store.settings.screenshotDir,
  onProgress: (id, received, total, bps) => {
    server.onFileProgress(id, received, total, bps);
    emit('transfer', { id, received, total, bps });
  },
  onScreenshot: (name, filePath) => server.onScreenshot(name, filePath),
  log,
});
const adb = new AdbBridge(() => server.port || store.settings.port, () => {
  emit('status');
  server.broadcastStatus();
});
const unlock = new UnlockService({
  resourcesDir,
  dataDir: app.getPath('userData'),
  isEnrolled: (deviceId) => store.findDevice(deviceId)?.unlockEnrolled ?? false,
  markEnrolled: (deviceId, value) => store.setUnlockEnrolled(deviceId, value),
  verifySignature: (device, nonce, ts, signature) => {
    const { verifyDeviceSignature } = require('./crypto') as typeof import('./crypto');
    return verifyDeviceSignature(device.pubKey, `${nonce}:${ts}`, signature);
  },
  isArmed: () => store.settings.unlockArmed,
  log,
});

function status(): ServerStatus {
  const device = server.connectedDevice ?? store.settings.paired[0] ?? null;
  return {
    device: device
      ? { id: device.id, name: device.name, model: device.model, platform: device.platform }
      : null,
    transport: server.activeTransport,
    serverInfo: {
      id: pairing.id,
      name: store.settings.serverName,
      version: VERSION,
      platform: 'windows',
      pubKey: '',
      protocol: 1,
      pairing: pairing.active,
    },
    pairingCode: pairing.currentCode,
    pairingExpiresAt: pairing.currentExpiry,
    lanAddresses: lanAddresses(),
    port: server.port || store.settings.port,
    adb: {
      present: adb.current.present,
      serial: adb.current.serial,
      reversed: adb.current.reversed,
    },
    unlock: {
      enrolled: device?.unlockEnrolled ?? false,
      armed: store.settings.unlockArmed,
      lastAt: unlock.status(device?.id ?? null).lastAt,
    },
    autosync: {
      screenshots: store.settings.autosyncScreenshots,
      photos: store.settings.autosyncPhotos,
    },
  };
}

server = new LinkServer({
  store,
  pairing,
  telemetry,
  media,
  agent,
  clipboard: clipboardSync,
  unlock,
  files,
  adb,
  version: VERSION,
  getStatus: status,
  log,
  toRenderer: (message) => emit('phone', message),
  onStatus: () => emit('status'),
});

function emit(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(`openlink:${channel}`, payload);
  }
}

/* ------------------------------------------------------------------ window */

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#000000',
    title: 'OpenLink',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', (event) => {
    if (!quitting && store.settings.closeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const rendererFile = path.join(app.getAppPath(), 'dist', 'renderer', 'index.html');
  if (isDev && process.env.OPENLINK_DEV_URL) {
    void mainWindow.loadURL(process.env.OPENLINK_DEV_URL);
  } else {
    void mainWindow.loadFile(rendererFile);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

function trayIcon(): Electron.NativeImage {
  const candidates = [
    path.join(app.getAppPath(), 'build', 'icon.png'),
    path.join(resourcesDir, 'icon.png'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const image = nativeImage.createFromPath(candidate);
      if (!image.isEmpty()) return image.resize({ width: 16, height: 16 });
    }
  }
  return nativeImage.createEmpty();
}

function createTray(): void {
  tray = new Tray(trayIcon());
  tray.setToolTip('OpenLink — local link to your phone');
  const menu = Menu.buildFromTemplate([
    { label: 'Open OpenLink', click: () => showWindow() },
    {
      label: 'Pair a phone',
      click: () => {
        showWindow();
        void issuePairing().then((ticket) => emit('pairing', ticket));
      },
    },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: store.settings.startup,
      click: (item) => {
        store.update({ startup: item.checked });
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => showWindow());
}

function showWindow(): void {
  if (!mainWindow) createWindow();
  mainWindow?.show();
  mainWindow?.focus();
}

async function issuePairing() {
  const ticket = await pairing.issue(adb.current.present);
  server.broadcastStatus();
  emit('status');
  log(`pairing code issued (${adb.current.reversed ? 'usb' : 'wifi'})`);
  return ticket;
}

/* --------------------------------------------------------------------- ipc */

function sanitisedSettings() {
  return {
    lang: store.settings.lang,
    port: store.settings.port,
    serverName: store.settings.serverName,
    autosyncScreenshots: store.settings.autosyncScreenshots,
    autosyncPhotos: store.settings.autosyncPhotos,
    startup: store.settings.startup,
    closeToTray: store.settings.closeToTray,
    unlockArmed: store.settings.unlockArmed,
    requireBiometric: store.settings.requireBiometric,
    macros: store.settings.macros,
    receiveDir: store.settings.receiveDir,
    screenshotDir: store.settings.screenshotDir,
    devices: store.settings.paired.map((d) => ({
      id: d.id,
      name: d.name,
      model: d.model,
      platform: d.platform,
      lastSeen: d.lastSeen,
      unlockEnrolled: d.unlockEnrolled,
    })),
    unlockStatus: unlock.status(store.settings.paired[0]?.id ?? null),
    clipboard: clipboardSync.history,
    transfers: files.transfers,
    secureStorage: safeStorage.isEncryptionAvailable(),
  };
}

function registerIpc(): void {
  ipcMain.handle('openlink:status', () => status());
  ipcMain.handle('openlink:settings', () => sanitisedSettings());
  ipcMain.handle('openlink:settings:update', (_e, patch: Record<string, unknown>) => {
    const allowed = [
      'lang',
      'port',
      'serverName',
      'autosyncScreenshots',
      'autosyncPhotos',
      'startup',
      'closeToTray',
      'unlockArmed',
      'requireBiometric',
    ] as const;
    const clean: Record<string, unknown> = {};
    for (const key of allowed) if (key in patch) clean[key] = patch[key];
    const before = store.settings.port;
    store.update(clean as never);
    if ('startup' in clean) {
      app.setLoginItemSettings({ openAtLogin: Boolean(clean.startup), args: ['--hidden'] });
    }
    if (store.settings.port !== before) {
      void server.start(store.settings.port).then(() => {
        adb.refresh();
        emit('status');
      });
    }
    if (store.settings.autosyncScreenshots) files.startScreenshotWatch();
    log('settings updated');
    return sanitisedSettings();
  });
  ipcMain.handle('openlink:pairing:issue', () => issuePairing());
  ipcMain.handle('openlink:pairing:revoke', () => {
    pairing.revoke();
    server.broadcastStatus();
    return status();
  });
  ipcMain.handle('openlink:pairing:reset', () => {
    store.resetPairing();
    unlock.clearCredential();
    server.broadcastStatus();
    emit('status');
    return sanitisedSettings();
  });
  ipcMain.handle('openlink:macros:save', (_e, macro: Macro) => {
    const macros = store.settings.macros.slice();
    const index = macros.findIndex((m) => m.id === macro.id);
    if (index >= 0) macros[index] = macro;
    else macros.push({ ...macro, id: macro.id || randomUUID() });
    store.update({ macros });
    server.sendToPhone({ t: 'macro.list', macros });
    return macros;
  });
  ipcMain.handle('openlink:macros:delete', (_e, id: string) => {
    const macros = store.settings.macros.filter((m) => m.id !== id);
    store.update({ macros });
    server.sendToPhone({ t: 'macro.list', macros });
    return macros;
  });
  ipcMain.handle('openlink:clipboard', () => clipboardSync.history);
  ipcMain.handle('openlink:clipboard:push', (_e, text: string) => {
    const value = String(text ?? '');
    try {
      clipboard.writeText(value);
    } catch {
      /* clipboard unavailable (locked session) */
    }
    const entry = clipboardSync.record(value, 'pc');
    server.sendToPhone({ t: 'clipboard', items: clipboardSync.history });
    return entry;
  });
  ipcMain.handle('openlink:macros:run', (_e, id: string) => server.runMacroById(id));
  ipcMain.handle('openlink:clipboard:remove', (_e, id: string) => {
    clipboardSync.remove(id);
    server.sendToPhone({ t: 'clipboard', items: clipboardSync.history });
    return clipboardSync.history;
  });
  ipcMain.handle('openlink:clipboard:clear', () => {
    clipboardSync.clear();
    server.sendToPhone({ t: 'clipboard', items: [] });
    return [];
  });
  ipcMain.handle('openlink:telemetry', () => telemetry.latest);
  ipcMain.handle('openlink:media', () => media.latest);
  ipcMain.handle('openlink:media:command', (_e, action: 'playpause' | 'next' | 'prev') => media.command(action));
  ipcMain.handle('openlink:open-url', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  ipcMain.handle('openlink:files:pick', async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Send files to your phone',
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    return pushFiles(result.filePaths);
  });
  ipcMain.handle('openlink:files:push-paths', (_e, paths: string[]) => pushFiles((paths ?? []).slice(0, 40)));
  ipcMain.handle('openlink:files:reveal', (_e, target: string) => {
    if (target && fs.existsSync(target)) shell.showItemInFolder(target);
  });
  ipcMain.handle('openlink:files:open-dir', () => {
    void shell.openPath(store.settings.receiveDir);
  });
  ipcMain.handle('openlink:rtc:send', (_e, message: { kind: 'offer' | 'answer' | 'ice'; stream: string; sdp?: string; candidate?: string }) => {
    return server.sendToPhone({
      t: 'rtc.signal',
      kind: message.kind,
      stream: message.stream as never,
      sdp: message.sdp,
      candidate: message.candidate,
    });
  });
  ipcMain.handle('openlink:notify:reply', (_e, id: string, text: string) => {
    server.sendToPhone({ t: 'notify.reply', id, text });
  });
  ipcMain.handle('openlink:unlock:enroll', async (_e, payload: { deviceId: string; credential: string }) => {
    const record = store.findDevice(payload.deviceId);
    if (!record) return { ok: false, error: 'no paired device' };
    try {
      await unlock.enroll(record, payload.credential);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
  ipcMain.handle('openlink:unlock:arm', (_e, armed: boolean) => {
    store.update({ unlockArmed: Boolean(armed) });
    server.broadcastStatus();
    return status();
  });
  ipcMain.handle('openlink:open-logs', () => {
    void shell.openPath(app.getPath('userData'));
  });
  ipcMain.handle('openlink:reveal', (_e, target: string) => {
    if (target) revealInFolder(target);
  });
}

function revealInFolder(target: string): void {
  try {
    shell.showItemInFolder(target);
  } catch {
    /* ignore */
  }
}

function pushFiles(paths: string[]) {
  const pushed: { id: string; name: string }[] = [];
  for (const filePath of paths) {
    const entry = files.registerOutgoing(filePath);
    if (!entry) continue;
    server.sendToPhone({
      t: 'file.push',
      offer: {
        id: entry.token,
        name: entry.name,
        size: entry.size,
        mime: entry.mime,
        direction: 'pc-to-phone',
      },
      url: `/api/file/${entry.token}`,
    });
    pushed.push({ id: entry.token, name: entry.name });
  }
  if (pushed.length) log(`pushed ${pushed.length} file(s) to phone`);
  return pushed;
}

function emitClipboard(entry?: ClipboardEntry): void {
  emit('clipboard', clipboardSync.history);
  if (entry) emit('clipboardIncoming', entry);
}

/* ------------------------------------------------------------------- boot */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    app.setAppUserModelId('dev.openlink.desktop');
    registerIpc();
    // PC → phone casting: hand the primary screen plus Windows loopback audio
    // to the renderer's getDisplayMedia call, without a picker dialog.
    session.defaultSession.setDisplayMediaRequestHandler(
      async (_request, callback) => {
        try {
          const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
          if (!sources.length) {
            callback({});
            return;
          }
          callback({ video: sources[0], audio: 'loopback' });
        } catch (err) {
          log(`display capture failed: ${(err as Error).message}`);
          callback({});
        }
      },
      { useSystemPicker: false },
    );
    createWindow();
    createTray();

    clipboardSync.onChange((items) => {
      server.onClipboard(items);
      emitClipboard();
    });
    clipboardSync.start();
    media.start();
    media.onChange((state) => {
      server.onMedia(state);
      emit('media', state);
    });
    telemetry.start((sample: Telemetry) => {
      server.onTelemetry(sample);
      emit('telemetry', sample);
    });
    adb.start();
    if (store.settings.autosyncScreenshots) files.startScreenshotWatch();

    try {
      await server.start(store.settings.port);
    } catch {
      const fallback = store.settings.port + 1;
      log(`falling back to port ${fallback}`);
      await server.start(fallback).catch((err: Error) => log(`server failed: ${err.message}`));
    }
    server.broadcastStatus();
    log(`OpenLink ${VERSION} started (port ${server.port})`);

    if (process.argv.includes('--hidden')) mainWindow?.hide();
  });

  app.on('window-all-closed', () => {
    if (!store.settings.closeToTray) app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    telemetry.stop();
    media.stop();
    clipboardSync.stop();
    adb.stop();
    files.stop();
    agent.stop();
    void server.stop();
  });

  app.on('activate', () => showWindow());
}

export { log, status };
