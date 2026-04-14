/**
 * Electron main process entry point
 */
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  shell,
  type MessageBoxOptions,
  type MenuItemConstructorOptions,
} from "electron";
import path from "path";

// Import IPC handlers to register all endpoints
import "./ipc-handlers";

let mainWindow: BrowserWindow | null = null;
const isDev = !app.isPackaged;
const REPO_URL = "https://github.com/CellMLForge/workspace-manager";
const NEW_ISSUE_URL = `${REPO_URL}/issues/new/choose`;

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
          label: "New Workspace from GitHub...",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => {
            mainWindow?.webContents.send("menu:new-workspace-github");
          },
        },
        {
          label: "Import Workspace from GitHub...",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => {
            mainWindow?.webContents.send("menu:open-workspace-github");
          },
        },
        { type: "separator" },
        {
          label: "Set Workspace Library...",
          accelerator: "CmdOrCtrl+Shift+L",
          click: () => {
            mainWindow?.webContents.send("menu:set-workspace-library");
          },
        },
        {
          label: "Reset Session",
          click: () => {
            mainWindow?.webContents.send("menu:reset-session");
          },
        },
        { type: "separator" },
        isMac ? { role: "close" as const } : { role: "quit" as const },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "About CellMLForge Workspace Manager",
          click: () => {
            const diagnosticsText = [
              `Version: ${app.getVersion()}`,
              `Electron: ${process.versions.electron ?? "unknown"}`,
              `Chromium: ${process.versions.chrome ?? "unknown"}`,
              `Node.js: ${process.versions.node ?? "unknown"}`,
              `V8: ${process.versions.v8 ?? "unknown"}`,
              `Platform: ${process.platform} (${process.arch})`,
              `Mode: ${isDev ? "Development" : "Packaged"}`,
              `Repository: ${REPO_URL}`,
            ].join("\n");

            const aboutOptions: MessageBoxOptions = {
              type: "info",
              title: "About CellMLForge Workspace Manager",
              message: "CellMLForge Workspace Manager",
              detail: [
                diagnosticsText,
                "Desktop app for managing OMEX/COMBINE archives with git integration.",
              ].join("\n"),
              buttons: ["Copy Diagnostics", "OK"],
              defaultId: 1,
              cancelId: 1,
            };

            const handleResult = (response: number) => {
              if (response === 0) {
                clipboard.writeText(diagnosticsText);
              }
            };

            if (mainWindow) {
              dialog
                .showMessageBox(mainWindow, aboutOptions)
                .then((result) => handleResult(result.response));
            } else {
              dialog
                .showMessageBox(aboutOptions)
                .then((result) => handleResult(result.response));
            }
          },
        },
        { type: "separator" },
        {
          label: "View GitHub Repository",
          click: () => {
            shell.openExternal(REPO_URL);
          },
        },
        {
          label: "Submit an Issue",
          click: () => {
            shell.openExternal(NEW_ISSUE_URL);
          },
        },
      ],
    },
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
