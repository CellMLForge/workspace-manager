/**
 * Preload script for Electron context isolation
 * Exposes safe IPC methods to renderer (React) process
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("api", {
  // Archive API
  archive: {
    create: (name: string, workingDir: string, description?: string) =>
      ipcRenderer.invoke("archive:create", name, workingDir, description),
    open: (workingDir: string) =>
      ipcRenderer.invoke("archive:open", workingDir),
    importFiles: (archive: any, sourceFiles: string[], overwriteExisting?: boolean) =>
      ipcRenderer.invoke("archive:importFiles", archive, sourceFiles, overwriteExisting),
    listFiles: (archive: any) =>
      ipcRenderer.invoke("archive:listFiles", archive),
    getFileContent: (filePath: string) =>
      ipcRenderer.invoke("archive:getFileContent", filePath),
    deleteFile: (archive: any, filePath: string) =>
      ipcRenderer.invoke("archive:deleteFile", archive, filePath),
  },

  // Manifest API
  manifest: {
    parse: (manifestPath: string) =>
      ipcRenderer.invoke("manifest:parse", manifestPath),
    generate: (manifestPath: string, entries: any[]) =>
      ipcRenderer.invoke("manifest:generate", manifestPath, entries),
    upsertEntry: (manifestPath: string, entry: any) =>
      ipcRenderer.invoke("manifest:upsertEntry", manifestPath, entry),
    deleteEntry: (manifestPath: string, location: string) =>
      ipcRenderer.invoke("manifest:deleteEntry", manifestPath, location),
    validate: (manifestPath: string) =>
      ipcRenderer.invoke("manifest:validate", manifestPath),
    calculateChecksum: (filePath: string) =>
      ipcRenderer.invoke("manifest:calculateChecksum", filePath),
  },

  // Git API
  git: {
    initRepository: (workingDir: string, gitignoreRules?: string[]) =>
      ipcRenderer.invoke("git:initRepository", workingDir, gitignoreRules),
    detectChanges: (archive: any) =>
      ipcRenderer.invoke("git:detectChanges", archive),
    suggestCommitMessage: (changes: any) =>
      ipcRenderer.invoke("git:suggestCommitMessage", changes),
    commit: (archive: any, message: string) =>
      ipcRenderer.invoke("git:commit", archive, message),
    getLog: (workingDir: string, limit?: number) =>
      ipcRenderer.invoke("git:getLog", workingDir, limit),
    getCurrentBranch: (workingDir: string) =>
      ipcRenderer.invoke("git:getCurrentBranch", workingDir),
    setRemote: (workingDir: string, name: string, url: string) =>
      ipcRenderer.invoke("git:setRemote", workingDir, name, url),
    createBranch: (workingDir: string, branchName: string) =>
      ipcRenderer.invoke("git:createBranch", workingDir, branchName),
    checkoutBranch: (workingDir: string, branchName: string) =>
      ipcRenderer.invoke("git:checkoutBranch", workingDir, branchName),
  },

  // GitHub API
  github: {
    authenticateOAuth: () =>
      ipcRenderer.invoke("github:authenticateOAuth"),
    cancelAuth: () =>
      ipcRenderer.invoke("github:cancelAuth"),
    getOAuthApplicationId: () =>
      ipcRenderer.invoke("github:getOAuthApplicationId"),
    restoreSession: () =>
      ipcRenderer.invoke("github:restoreSession"),
    logout: () =>
      ipcRenderer.invoke("github:logout"),
    listRepositories: (session: any) =>
      ipcRenderer.invoke("github:listRepositories", session),
    createRepository: (session: any, repoName: string, description?: string, isPrivate?: boolean) =>
      ipcRenderer.invoke("github:createRepository", session, repoName, description, isPrivate),
    push: (session: any, workingDir: string, pushContext: any) =>
      ipcRenderer.invoke("github:push", session, workingDir, pushContext),
    cloneRepository: (session: any, repoUrl: string, localDir: string) =>
      ipcRenderer.invoke("github:cloneRepository", session, repoUrl, localDir),
  },

  // Zip API
  zip: {
    build: (workingDir: string, outputPath: string, excludePaths?: string[]) =>
      ipcRenderer.invoke("zip:build", workingDir, outputPath, excludePaths),
    extract: (zipPath: string, outputDir: string) =>
      ipcRenderer.invoke("zip:extract", zipPath, outputDir),
    generateBase64: (zipPath: string, outputPath: string) =>
      ipcRenderer.invoke("zip:generateBase64", zipPath, outputPath),
    getBase64String: (zipPath: string) =>
      ipcRenderer.invoke("zip:getBase64String", zipPath),
    verify: (zipPath: string) =>
      ipcRenderer.invoke("zip:verify", zipPath),
  },

  // Native UI dialogs
  ui: {
    pickDirectory: (defaultPath?: string) =>
      ipcRenderer.invoke("ui:pickDirectory", defaultPath),
    pickImportPaths: (defaultPath?: string) =>
      ipcRenderer.invoke("ui:pickImportPaths", defaultPath),
    pickImportDirectory: (defaultPath?: string) =>
      ipcRenderer.invoke("ui:pickImportDirectory", defaultPath),
    pickSaveZipPath: (defaultPath?: string) =>
      ipcRenderer.invoke("ui:pickSaveZipPath", defaultPath),
    openExternal: (url: string) => ipcRenderer.invoke("ui:openExternal", url),
    confirmImportOverwrite: (collisionNames: string[]) =>
      ipcRenderer.invoke("ui:confirmImportOverwrite", collisionNames),
    selectGitHubRepository: (repositoryNames: string[]) =>
      ipcRenderer.invoke("ui:selectGitHubRepository", repositoryNames),
    confirmPrivateRepository: () =>
      ipcRenderer.invoke("ui:confirmPrivateRepository"),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },

  events: {
    onMenuNewArchive: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("menu:new-archive", listener);
      return () => {
        ipcRenderer.removeListener("menu:new-archive", listener);
      };
    },
    onMenuOpenArchive: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("menu:open-archive", listener);
      return () => {
        ipcRenderer.removeListener("menu:open-archive", listener);
      };
    },
    onMenuNewArchiveGitHub: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("menu:new-archive-github", listener);
      return () => {
        ipcRenderer.removeListener("menu:new-archive-github", listener);
      };
    },
    onMenuOpenArchiveGitHub: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("menu:open-archive-github", listener);
      return () => {
        ipcRenderer.removeListener("menu:open-archive-github", listener);
      };
    },
    onGitHubAuthProgress: (
      callback: (details: {
        stage: "starting" | "device_code" | "browser_opened" | "waiting" | "success" | "error";
        message: string;
        userCode?: string;
        verificationUri?: string;
        verificationUriComplete?: string;
        scopeWarning?: string;
      }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        details: {
          stage: "starting" | "device_code" | "browser_opened" | "waiting" | "success" | "error";
          message: string;
          userCode?: string;
          verificationUri?: string;
          verificationUriComplete?: string;
          scopeWarning?: string;
        }
      ) => callback(details);
      ipcRenderer.on("github:auth-progress", listener);
      return () => {
        ipcRenderer.removeListener("github:auth-progress", listener);
      };
    },
  },
});
