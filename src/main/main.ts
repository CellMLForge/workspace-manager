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

// Import IPC handlers to register all endpoints
import "./ipc-handlers";

let mainWindow: BrowserWindow | null = null;
const isDev = !app.isPackaged;

const buildApplicationMenu = () => {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Workspace",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            mainWindow?.webContents.send("menu:new-workspace");
          },
        },
        {
          label: "Open Workspace",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            mainWindow?.webContents.send("menu:open-workspace");
          },
        },
        {
          label: "New Workspace from GitHub...",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => {
            mainWindow?.webContents.send("menu:new-workspace-github");
          },
        },
        {
          label: "Open Workspace from GitHub...",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => {
            mainWindow?.webContents.send("menu:open-workspace-github");
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
  const iconPath = isDev
    ? path.join(__dirname, "../../public/branding/compact-mark.png")
    : path.join(__dirname, "../renderer/branding/compact-mark.png");

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.setTitle("CellMLForge Workspace Manager");

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

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
