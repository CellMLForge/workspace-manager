/**
 * Preload script for Electron context isolation
 * Exposes safe IPC methods to renderer (React) process
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("api", {
  // Workspace API
  workspace: {
    create: (name: string, workingDir: string, description?: string) =>
      ipcRenderer.invoke("workspace:create", name, workingDir, description),
    createInLibrary: (name: string, description?: string) =>
      ipcRenderer.invoke("workspace:createInLibrary", name, description),
    open: (workingDir: string) =>
      ipcRenderer.invoke("workspace:open", workingDir),
    getLibrarySettings: () =>
      ipcRenderer.invoke("workspace:getLibrarySettings"),
    setLibraryPath: (libraryPath: string) =>
      ipcRenderer.invoke("workspace:setLibraryPath", libraryPath),
    clearLibrarySettings: () =>
      ipcRenderer.invoke("workspace:clearLibrarySettings"),
    listLibraryWorkspaces: () =>
      ipcRenderer.invoke("workspace:listLibraryWorkspaces"),
    listSimulationExperimentManifests: (workspace: any) =>
      ipcRenderer.invoke("workspace:listSimulationExperimentManifests", workspace),
    createSimulationExperimentManifest: (workspace: any, options: any) =>
      ipcRenderer.invoke("workspace:createSimulationExperimentManifest", workspace, options),
    importToLibrary: (sourceWorkspaceDir: string) =>
      ipcRenderer.invoke("workspace:importToLibrary", sourceWorkspaceDir),
    rememberLastOpened: (workingDir: string | null) =>
      ipcRenderer.invoke("workspace:rememberLastOpened", workingDir),
    updateMetadata: (workingDir: string, updates: { name?: string; description?: string }) =>
      ipcRenderer.invoke("workspace:updateMetadata", workingDir, updates),
    importFiles: (workspace: any, sourceFiles: string[], overwriteExisting?: boolean) =>
      ipcRenderer.invoke("workspace:importFiles", workspace, sourceFiles, overwriteExisting),
    listFiles: (workspace: any) =>
      ipcRenderer.invoke("workspace:listFiles", workspace),
    getFileContent: (filePath: string) =>
      ipcRenderer.invoke("workspace:getFileContent", filePath),
    deleteFile: (workspace: any, filePath: string) =>
      ipcRenderer.invoke("workspace:deleteFile", workspace, filePath),
  },

  // Manifest API
  manifest: {
    parse: (manifestPath: string) =>
      ipcRenderer.invoke("manifest:parse", manifestPath),
    generate: (manifestPath: string, entries: any[], metadata?: any) =>
      ipcRenderer.invoke("manifest:generate", manifestPath, entries, metadata),
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
    detectChanges: (workspace: any) =>
      ipcRenderer.invoke("git:detectChanges", workspace),
    getWorkspaceSnapshot: (workspace: any) =>
      ipcRenderer.invoke("git:getWorkspaceSnapshot", workspace),
    suggestCommitMessage: (changes: any) =>
      ipcRenderer.invoke("git:suggestCommitMessage", changes),
    commit: (workspace: any, message: string) =>
      ipcRenderer.invoke("git:commit", workspace, message),
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
    buildFromManifest: (workingDir: string, outputPath: string, manifestPath: string, metadata?: any) =>
      ipcRenderer.invoke("zip:buildFromManifest", workingDir, outputPath, manifestPath, metadata),
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
    openExternal: (url: string) => ipcRenderer.invoke("ui:openExternal", url),
    confirmImportOverwrite: (collisionNames: string[]) =>
      ipcRenderer.invoke("ui:confirmImportOverwrite", collisionNames),
    selectGitHubRepository: (repositoryNames: string[]) =>
      ipcRenderer.invoke("ui:selectGitHubRepository", repositoryNames),
    selectWorkspace: (workspaceNames: string[]) =>
      ipcRenderer.invoke("ui:selectWorkspace", workspaceNames),
    confirmPrivateRepository: () =>
      ipcRenderer.invoke("ui:confirmPrivateRepository"),
    confirmBuildWithUncommittedChanges: (pendingSummary: string) =>
      ipcRenderer.invoke("ui:confirmBuildWithUncommittedChanges", pendingSummary),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },

  events: {
    onMenuNewWorkspace: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("menu:new-workspace", listener);
      return () => {
        ipcRenderer.removeListener("menu:new-workspace", listener);
      };
    },
    onMenuOpenWorkspace: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("menu:open-workspace", listener);
      return () => {
        ipcRenderer.removeListener("menu:open-workspace", listener);
      };
    },
    onMenuSetWorkspaceLibrary: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("menu:set-workspace-library", listener);
      return () => {
        ipcRenderer.removeListener("menu:set-workspace-library", listener);
      };
    },
    onMenuResetSession: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("menu:reset-session", listener);
      return () => {
        ipcRenderer.removeListener("menu:reset-session", listener);
      };
    },
    onMenuNewWorkspaceGitHub: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("menu:new-workspace-github", listener);
      return () => {
        ipcRenderer.removeListener("menu:new-workspace-github", listener);
      };
    },
    onMenuOpenWorkspaceGitHub: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("menu:open-workspace-github", listener);
      return () => {
        ipcRenderer.removeListener("menu:open-workspace-github", listener);
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
