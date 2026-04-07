/**
 * Electron main process entry point
 */
import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
} from "electron";
import path from "path";
import isDev from "electron-is-dev";

// Import IPC handlers to register all endpoints
import "./ipc-handlers";

let mainWindow: BrowserWindow | null = null;

const buildApplicationMenu = () => {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "New",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            mainWindow?.webContents.send("menu:new-archive");
          },
        },
        {
          label: "Open",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            mainWindow?.webContents.send("menu:open-archive");
          },
        },
        {
          label: "New from GitHub...",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => {
            mainWindow?.webContents.send("menu:new-archive-github");
          },
        },
        {
          label: "Open from GitHub...",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => {
            mainWindow?.webContents.send("menu:open-archive-github");
          },
        },
        { type: "separator" },
        isMac ? { role: "close" as const } : { role: "quit" as const },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  const startUrl = isDev
    ? "http://localhost:5173"
    : `file://${path.join(__dirname, "../renderer/index.html")}`;

  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  buildApplicationMenu();
};

app.on("ready", createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC handlers will be registered in ipc-handlers.ts
// See main preload script for exposition of safe IPC methods
