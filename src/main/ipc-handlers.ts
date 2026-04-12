/**
 * IPC handlers for main process <-> renderer (React) communication
 * Register all message handlers here
 */
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import {
  ManifestBuildMetadata,
  WorkspaceProject,
  GitHubSession,
  ManifestEntry,
  OperationResult,
} from "../domain/models";
import { workspaceService } from "../services/workspace";
import { manifestService } from "../services/manifest";
import { gitService } from "../services/git";
import { githubService } from "../services/github";
import { zipService } from "../services/zip";

/**
 * Workspace operation handlers
 */
ipcMain.handle(
  "workspace:create",
  async (event, name: string, workingDir: string, description?: string) => {
    return workspaceService.createWorkspace(name, workingDir, description);
  }
);

ipcMain.handle(
  "workspace:createInLibrary",
  async (event, name: string, description?: string) => {
    return workspaceService.createWorkspaceInLibrary(name, description);
  }
);

ipcMain.handle("workspace:open", async (event, workingDir: string) => {
  return workspaceService.openWorkspace(workingDir);
});

ipcMain.handle("workspace:getLibrarySettings", async () => {
  return workspaceService.getWorkspaceLibrarySettings();
});

ipcMain.handle("workspace:setLibraryPath", async (event, libraryPath: string) => {
  return workspaceService.setWorkspaceLibraryPath(libraryPath);
});

ipcMain.handle("workspace:clearLibrarySettings", async () => {
  return workspaceService.clearWorkspaceLibrarySettings();
});

ipcMain.handle("workspace:listLibraryWorkspaces", async () => {
  return workspaceService.listLibraryWorkspaces();
});

ipcMain.handle("workspace:listSimulationExperimentManifests", async (event, workspace: WorkspaceProject) => {
  return workspaceService.listSimulationExperimentManifests(workspace);
});

ipcMain.handle(
  "workspace:createSimulationExperimentManifest",
  async (
    event,
    workspace: WorkspaceProject,
    options: {
      name: string;
      description?: string;
      entries: Array<{ location: string; format: string; master?: boolean; description?: string }>;
    }
  ) => {
    return workspaceService.createSimulationExperimentManifest(workspace, options);
  }
);

ipcMain.handle("workspace:importToLibrary", async (event, sourceWorkspaceDir: string) => {
  return workspaceService.importWorkspaceToLibrary(sourceWorkspaceDir);
});

ipcMain.handle("workspace:rememberLastOpened", async (event, workingDir: string | null) => {
  return workspaceService.rememberLastOpenedWorkspace(workingDir);
});

ipcMain.handle(
  "workspace:updateMetadata",
  async (event, workingDir: string, updates: { name?: string; description?: string }) => {
    return workspaceService.updateWorkspaceMetadata(workingDir, updates);
  }
);

ipcMain.handle(
  "workspace:importFiles",
  async (event, workspace: WorkspaceProject, sourceFiles: string[], overwriteExisting?: boolean) => {
    return workspaceService.importFiles(workspace, sourceFiles, !!overwriteExisting);
  }
);

ipcMain.handle("workspace:listFiles", async (event, workspace: WorkspaceProject) => {
  return workspaceService.listFiles(workspace);
});

ipcMain.handle("workspace:getFileContent", async (event, filePath: string) => {
  return workspaceService.getFileContent(filePath);
});

ipcMain.handle(
  "workspace:deleteFile",
  async (event, workspace: WorkspaceProject, filePath: string) => {
    return workspaceService.deleteFile(workspace, filePath);
  }
);

/**
 * Manifest operation handlers
 */
ipcMain.handle("manifest:parse", async (event, manifestPath: string) => {
  return manifestService.parseManifest(manifestPath);
});

ipcMain.handle(
  "manifest:generate",
  async (event, manifestPath: string, entries: ManifestEntry[], metadata?: ManifestBuildMetadata) => {
    return manifestService.generateManifest(manifestPath, entries, metadata);
  }
);

ipcMain.handle(
  "manifest:upsertEntry",
  async (event, manifestPath: string, entry: ManifestEntry) => {
    return manifestService.upsertEntry(manifestPath, entry);
  }
);

ipcMain.handle(
  "manifest:deleteEntry",
  async (event, manifestPath: string, location: string) => {
    return manifestService.deleteEntry(manifestPath, location);
  }
);

ipcMain.handle("manifest:validate", async (event, manifestPath: string) => {
  return manifestService.validate(manifestPath);
});

ipcMain.handle(
  "manifest:calculateChecksum",
  async (event, filePath: string) => {
    return manifestService.calculateChecksum(filePath);
  }
);

/**
 * Git operation handlers
 */
ipcMain.handle(
  "git:initRepository",
  async (event, workingDir: string, gitignoreRules?: string[]) => {
    return gitService.initRepository(workingDir, gitignoreRules);
  }
);

ipcMain.handle(
  "git:detectChanges",
  async (event, workspace: WorkspaceProject) => {
    return gitService.detectChanges(workspace);
  }
);

ipcMain.handle("git:suggestCommitMessage", async (event, changes) => {
  return gitService.suggestCommitMessage(changes);
});

ipcMain.handle(
  "git:getWorkspaceSnapshot",
  async (event, workspace: WorkspaceProject) => {
    return gitService.getWorkspaceSnapshot(workspace);
  }
);

ipcMain.handle(
  "git:commit",
  async (event, workspace: WorkspaceProject, message: string) => {
    return gitService.commit(workspace, message);
  }
);

ipcMain.handle("git:getLog", async (event, workingDir: string, limit?: number) => {
  return gitService.getLog(workingDir, limit);
});

ipcMain.handle("git:getCurrentBranch", async (event, workingDir: string) => {
  return gitService.getCurrentBranch(workingDir);
});

ipcMain.handle(
  "git:setRemote",
  async (event, workingDir: string, name: string, url: string) => {
    return gitService.setRemote(workingDir, name, url);
  }
);

ipcMain.handle(
  "git:createBranch",
  async (event, workingDir: string, branchName: string) => {
    return gitService.createBranch(workingDir, branchName);
  }
);

ipcMain.handle(
  "git:checkoutBranch",
  async (event, workingDir: string, branchName: string) => {
    return gitService.checkoutBranch(workingDir, branchName);
  }
);

/**
 * GitHub operation handlers
 */
ipcMain.handle("github:authenticateOAuth", async (event) => {
  const result = await githubService.authenticateOAuth((authEvent) => {
    event.sender.send("github:auth-progress", authEvent);
  });

  if (result.ok && result.data) {
    gitService.setCommitAuthorFromGitHubSession(result.data);
  }

  return result;
});

ipcMain.handle("github:cancelAuth", async () => {
  githubService.cancelAuthFlow();
});

ipcMain.handle("github:getOAuthApplicationId", async () => {
  return githubService.getOAuthApplicationId();
});

ipcMain.handle("github:restoreSession", async () => {
  const result = await githubService.restoreSession();
  if (result.ok) {
    gitService.setCommitAuthorFromGitHubSession(result.data ?? null);
  }
  return result;
});

ipcMain.handle("github:logout", async () => {
  const result = await githubService.logout();
  if (result.ok) {
    gitService.setCommitAuthorFromGitHubSession(null);
  }
  return result;
});

ipcMain.handle("github:listRepositories", async (event, session: GitHubSession) => {
  return githubService.listRepositories(session);
});

ipcMain.handle(
  "github:createRepository",
  async (
    event,
    session: GitHubSession,
    repoName: string,
    description?: string,
    isPrivate?: boolean
  ) => {
    return githubService.createRepository(session, repoName, description, isPrivate);
  }
);

ipcMain.handle(
  "github:push",
  async (event, session: GitHubSession, workingDir: string, pushContext) => {
    return githubService.push(session, workingDir, pushContext);
  }
);

ipcMain.handle(
  "github:cloneRepository",
  async (event, session: GitHubSession, repoUrl: string, localDir: string) => {
    return githubService.cloneRepository(session, repoUrl, localDir);
  }
);

/**
 * Zip operation handlers
 */
ipcMain.handle(
  "zip:build",
  async (event, workingDir: string, outputPath: string, excludePaths?: string[]) => {
    return zipService.buildZip(workingDir, outputPath, excludePaths);
  }
);

ipcMain.handle(
  "zip:buildFromManifest",
  async (event, workingDir: string, outputPath: string, manifestPath: string, metadata?: ManifestBuildMetadata) => {
    return zipService.buildZipFromManifest(workingDir, outputPath, manifestPath, metadata);
  }
);

ipcMain.handle(
  "zip:extract",
  async (event, zipPath: string, outputDir: string) => {
    return zipService.extractZip(zipPath, outputDir);
  }
);

ipcMain.handle(
  "zip:generateBase64",
  async (event, zipPath: string, outputPath: string) => {
    return zipService.generateBase64(zipPath, outputPath);
  }
);

ipcMain.handle("zip:getBase64String", async (event, zipPath: string) => {
  return zipService.getBase64String(zipPath);
});

ipcMain.handle("zip:verify", async (event, zipPath: string) => {
  return zipService.verifyZip(zipPath);
});

/**
 * Native dialog handlers for better cross-platform UX
 */
ipcMain.handle("ui:pickDirectory", async (event, defaultPath?: string) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const options: OpenDialogOptions = {
    title: "Select a folder",
    defaultPath,
    properties: ["openDirectory", "createDirectory"],
  };

  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle("ui:pickImportPaths", async (event, defaultPath?: string) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const options: OpenDialogOptions = {
    title: "Select files to import",
    defaultPath,
    properties: ["openFile", "multiSelections"],
  };

  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled) {
    return [];
  }

  return result.filePaths;
});

ipcMain.handle("ui:pickImportDirectory", async (event, defaultPath?: string) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const options: OpenDialogOptions = {
    title: "Select a folder to import",
    defaultPath,
    properties: ["openDirectory", "createDirectory"],
  };

  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle("ui:openExternal", async (event, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle("ui:confirmImportOverwrite", async (event, collisionNames: string[]) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const preview = collisionNames.slice(0, 8).join(", ");
  const overflow = collisionNames.length > 8
    ? ` and ${collisionNames.length - 8} more`
    : "";

  const options = {
    type: "warning" as const,
    buttons: ["Overwrite", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: "Overwrite existing files?",
    message: "Some selected files or folders already exist in this workspace.",
    detail: `Existing item(s): ${preview}${overflow}`,
  };

  const result = parentWindow
    ? await dialog.showMessageBox(parentWindow, options)
    : await dialog.showMessageBox(options);

  return result.response === 0;
});

ipcMain.handle("ui:selectGitHubRepository", async (event, repositoryNames: string[]) => {
  if (!repositoryNames.length) {
    return null;
  }

  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const cappedNames = repositoryNames.slice(0, 10);
  const overflowCount = repositoryNames.length - cappedNames.length;

  const options = {
    type: "question" as const,
    buttons: [...cappedNames, "Cancel"],
    defaultId: 0,
    cancelId: cappedNames.length,
    noLink: true,
    title: "Select GitHub repository",
    message: "Choose a repository to link or clone.",
    detail: overflowCount > 0
      ? `Showing first ${cappedNames.length} repositories. ${overflowCount} more are not shown.`
      : "",
  };

  const result = parentWindow
    ? await dialog.showMessageBox(parentWindow, options)
    : await dialog.showMessageBox(options);

  if (result.response < 0 || result.response >= cappedNames.length) {
    return null;
  }

  return result.response;
});

ipcMain.handle("ui:selectWorkspace", async (event, workspaceNames: string[]) => {
  if (!workspaceNames.length) {
    return null;
  }

  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const cappedNames = workspaceNames.slice(0, 12);
  const overflowCount = workspaceNames.length - cappedNames.length;

  const options = {
    type: "question" as const,
    buttons: [...cappedNames, "Cancel"],
    defaultId: 0,
    cancelId: cappedNames.length,
    noLink: true,
    title: "Open workspace",
    message: "Choose a workspace from your library.",
    detail: overflowCount > 0
      ? `Showing first ${cappedNames.length} workspaces. ${overflowCount} more are not shown.`
      : "",
  };

  const result = parentWindow
    ? await dialog.showMessageBox(parentWindow, options)
    : await dialog.showMessageBox(options);

  if (result.response < 0 || result.response >= cappedNames.length) {
    return null;
  }

  return result.response;
});

ipcMain.handle("ui:confirmPrivateRepository", async (event) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const options = {
    type: "question" as const,
    buttons: ["Private", "Public", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: "Repository visibility",
    message: "Select visibility for the new GitHub repository.",
  };

  const result = parentWindow
    ? await dialog.showMessageBox(parentWindow, options)
    : await dialog.showMessageBox(options);

  if (result.response === 2) {
    return null;
  }

  return result.response === 0;
});

ipcMain.handle(
  "ui:confirmBuildWithUncommittedChanges",
  async (event, pendingSummary: string) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;

    const options = {
      type: "warning" as const,
      buttons: ["Build ZIP anyway", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: "Uncommitted changes detected",
      message: "This workspace has uncommitted changes.",
      detail: `${pendingSummary}\n\nIt is recommended to commit changes before creating a ZIP artifact.`,
    };

    const result = parentWindow
      ? await dialog.showMessageBox(parentWindow, options)
      : await dialog.showMessageBox(options);

    return result.response === 0;
  }
);
