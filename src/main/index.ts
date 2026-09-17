import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, session, shell } from "electron";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { resolveStoreDir } from "./lib/storeDir.js";
import { migrateLegacySettings } from "./lib/legacySettings.js";
import { shouldAutostart } from "./lib/autostart.js";
import { createSupervisor } from "./sidecar/supervisor.js";
import { registerHandlers } from "./ipc/registerHandlers.js";
import * as proxyDaemon from "./daemon/proxyDaemon.js";
import { startActivityForwarder } from "./lib/activityForwarder.js";
import type { Supervisor } from "./sidecar/supervisor.js";

const dirName = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let supervisor: Supervisor | null = null;
let stopActivityForwarder: (() => void) | null = null;

function createWindow(): void {
  const isMac = process.platform === "darwin";
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: "#08090b",
    // macOS keeps native traffic lights inset into our bar; other platforms are fully frameless with custom controls.
    ...(isMac ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 14 } } : { frame: false }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // The ESM preload cannot load in a sandboxed renderer; contextIsolation still isolates the renderer.
      sandbox: false,
      preload: join(dirName, "../preload/index.mjs"),
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(dirName, "../renderer/index.html"));
  }
}

function registerWindowControls(): void {
  ipcMain.on("window:minimize", () => mainWindow?.minimize());
  ipcMain.on("window:maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on("window:close", () => mainWindow?.close());
}

function autostartProxyIfConfigured(storeDir: string): void {
  let configured = false;
  try {
    const raw = readFileSync(join(storeDir, "config", "forebay.json"), "utf8");
    configured = shouldAutostart(JSON.parse(raw));
  } catch {
    configured = false;
  }
  if (configured) {
    proxyDaemon.start().catch((error) => console.error("proxy autostart failed:", error));
  }
}

function createTray(): void {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("Forebay");
  tray.setContextMenu(Menu.buildFromTemplate([{ label: "Quit", click: () => app.quit() }]));
}

function applyContentSecurityPolicy(): void {
  const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
  const scriptSrc = isDev ? "'self' 'unsafe-eval' 'unsafe-inline'" : "'self'";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        // img-src allows data: so plugin/app brand marks (inlined SVG data URIs) render,
        // and avatars.githubusercontent.com so GitHub account avatars render.
        "Content-Security-Policy": [
          `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com;`,
        ],
      },
    });
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    applyContentSecurityPolicy();

    const storeDir = resolveStoreDir(process.env, process.platform, homedir());
    migrateLegacySettings(storeDir);
    supervisor = createSupervisor({
      sidecarPath: join(dirName, "sidecar.js"),
      storeDir,
      onProgress: (progress) => mainWindow?.webContents.send("downloads:progress", progress),
      onJob: (job) => mainWindow?.webContents.send("jobs:event", job),
    });
    registerHandlers(supervisor);
    registerWindowControls();
    proxyDaemon.onStatusChange((status) => mainWindow?.webContents.send("server:status", status));
    stopActivityForwarder = await startActivityForwarder((record) => mainWindow?.webContents.send("activity:event", record));
    autostartProxyIfConfigured(storeDir);

    createWindow();
    createTray();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    stopActivityForwarder?.();
    supervisor?.dispose();
  });
}
