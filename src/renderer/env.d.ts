/// <reference types="vite/client" />

interface IpcResult<T> {
  ok: boolean;
  data?: T;
  error?: unknown;
  /** True when the GitHub token has expired or been revoked; renderer should clear session */
  authExpired?: boolean;
}

interface RendererApi {
  workspace: {
    create: (name: string, workingDir: string, description?: string) => Promise<IpcResult<import("@domain/models").WorkspaceProject>>;
    createInLibrary: (name: string, description?: string) => Promise<IpcResult<import("@domain/models").WorkspaceProject>>;
    open: (workingDir: string) => Promise<IpcResult<import("@domain/models").WorkspaceProject>>;
    getLibrarySettings: () => Promise<IpcResult<import("@domain/models").WorkspaceLibrarySettings>>;
    setLibraryPath: (libraryPath: string) => Promise<IpcResult<import("@domain/models").WorkspaceLibrarySettings>>;
    clearLibrarySettings: () => Promise<IpcResult<import("@domain/models").WorkspaceLibrarySettings>>;
    listLibraryWorkspaces: () => Promise<IpcResult<import("@domain/models").WorkspaceProject[]>>;
    importToLibrary: (sourceWorkspaceDir: string) => Promise<IpcResult<import("@domain/models").WorkspaceProject>>;
    rememberLastOpened: (workingDir: string | null) => Promise<IpcResult<void>>;
    updateMetadata: (workingDir: string, updates: { name?: string; description?: string }) => Promise<IpcResult<{ name: string; description?: string; createdAt: string }>>;
    importFiles: (
      workspace: import("@domain/models").WorkspaceProject,
      sourceFiles: string[],
      overwriteExisting?: boolean
    ) => Promise<IpcResult<import("@domain/models").WorkingTreeFile[]>>;
    listFiles: (workspace: import("@domain/models").WorkspaceProject) => Promise<IpcResult<import("@domain/models").WorkingTreeFile[]>>;
  };
  manifest: {
    parse: (manifestPath: string) => Promise<IpcResult<import("@domain/models").ManifestEntry[]>>;
    generate: (
      manifestPath: string,
      entries: import("@domain/models").ManifestEntry[],
      metadata?: import("@domain/models").ManifestBuildMetadata
    ) => Promise<IpcResult<void>>;
  };
  git: {
    detectChanges: (workspace: import("@domain/models").WorkspaceProject) => Promise<IpcResult<import("@domain/models").GitChangeSet>>;
    getWorkspaceSnapshot: (workspace: import("@domain/models").WorkspaceProject) => Promise<IpcResult<import("@domain/models").WorkspaceGitSnapshot>>;
    suggestCommitMessage: (changes: import("@domain/models").GitChangeSet) => Promise<IpcResult<import("@domain/models").CommitSuggestion>>;
    commit: (workspace: import("@domain/models").WorkspaceProject, message: string) => Promise<IpcResult<string>>;
  };
  github: {
    authenticateOAuth: () => Promise<IpcResult<import("@domain/models").GitHubSession>>;
    cancelAuth: () => Promise<void>;
    getOAuthApplicationId: () => Promise<string | null>;
    restoreSession: () => Promise<IpcResult<import("@domain/models").GitHubSession | null>>;
    logout: () => Promise<IpcResult<void>>;
    listRepositories: (
      session: import("@domain/models").GitHubSession
    ) => Promise<IpcResult<{ name: string; url: string; description?: string }[]>>;
    createRepository: (
      session: import("@domain/models").GitHubSession,
      repoName: string,
      description?: string,
      isPrivate?: boolean
    ) => Promise<IpcResult<string>>;
    push: (
      session: import("@domain/models").GitHubSession,
      workingDir: string,
      pushContext: import("@domain/models").PushContext
    ) => Promise<IpcResult<{ message: string; url: string }>>;
    cloneRepository: (
      session: import("@domain/models").GitHubSession,
      repoUrl: string,
      localDir: string
    ) => Promise<IpcResult<string>>;
  };
  zip: {
    build: (
      workingDir: string,
      outputPath: string,
      excludePaths?: string[]
    ) => Promise<IpcResult<import("@domain/models").ZipArtifact>>;
    generateBase64: (
      zipPath: string,
      outputPath: string
    ) => Promise<IpcResult<import("@domain/models").Base64Artifact>>;
    getBase64String: (zipPath: string) => Promise<IpcResult<string>>;
  };
  ui: {
    pickDirectory: (defaultPath?: string) => Promise<string | null>;
    pickImportPaths: (defaultPath?: string) => Promise<string[]>;
    pickImportDirectory: (defaultPath?: string) => Promise<string | null>;
    openExternal: (url: string) => Promise<void>;
    confirmImportOverwrite: (collisionNames: string[]) => Promise<boolean>;
    selectGitHubRepository: (repositoryNames: string[]) => Promise<number | null>;
    selectWorkspace: (workspaceNames: string[]) => Promise<number | null>;
    confirmPrivateRepository: () => Promise<boolean | null>;
    confirmBuildWithUncommittedChanges: (pendingSummary: string) => Promise<boolean>;
    getPathForFile: (file: File) => string;
  };
  events: {
    onMenuNewWorkspace: (callback: () => void) => () => void;
    onMenuOpenWorkspace: (callback: () => void) => () => void;
    onMenuSetWorkspaceLibrary: (callback: () => void) => () => void;
    onMenuResetSession: (callback: () => void) => () => void;
    onMenuNewWorkspaceGitHub: (callback: () => void) => () => void;
    onMenuOpenWorkspaceGitHub: (callback: () => void) => () => void;
    onGitHubAuthProgress: (
      callback: (details: {
        stage: "starting" | "device_code" | "browser_opened" | "waiting" | "success" | "error";
        message: string;
        userCode?: string;
        verificationUri?: string;
        verificationUriComplete?: string;
        scopeWarning?: string;
      }) => void
    ) => () => void;
  };
}

declare global {
  interface Window {
    api: RendererApi;
  }
}

export {};