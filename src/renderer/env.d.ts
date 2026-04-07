/// <reference types="vite/client" />

interface IpcResult<T> {
  ok: boolean;
  data?: T;
  error?: unknown;
}

interface RendererApi {
  archive: {
    create: (name: string, workingDir: string, description?: string) => Promise<IpcResult<import("@domain/models").ArchiveProject>>;
    open: (workingDir: string) => Promise<IpcResult<import("@domain/models").ArchiveProject>>;
    importFiles: (
      archive: import("@domain/models").ArchiveProject,
      sourceFiles: string[],
      overwriteExisting?: boolean
    ) => Promise<IpcResult<import("@domain/models").WorkingTreeFile[]>>;
    listFiles: (archive: import("@domain/models").ArchiveProject) => Promise<IpcResult<import("@domain/models").WorkingTreeFile[]>>;
  };
  manifest: {
    parse: (manifestPath: string) => Promise<IpcResult<import("@domain/models").ManifestEntry[]>>;
    generate: (
      manifestPath: string,
      entries: import("@domain/models").ManifestEntry[]
    ) => Promise<IpcResult<void>>;
  };
  git: {
    detectChanges: (archive: import("@domain/models").ArchiveProject) => Promise<IpcResult<import("@domain/models").GitChangeSet>>;
    suggestCommitMessage: (changes: import("@domain/models").GitChangeSet) => Promise<IpcResult<import("@domain/models").CommitSuggestion>>;
    commit: (archive: import("@domain/models").ArchiveProject, message: string) => Promise<IpcResult<string>>;
  };
  github: {
    authenticateOAuth: () => Promise<IpcResult<import("@domain/models").GitHubSession>>;
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
    pickSaveZipPath: (defaultPath?: string) => Promise<string | null>;
    openExternal: (url: string) => Promise<void>;
    confirmImportOverwrite: (collisionNames: string[]) => Promise<boolean>;
    selectGitHubRepository: (repositoryNames: string[]) => Promise<number | null>;
    confirmPrivateRepository: () => Promise<boolean | null>;
    getPathForFile: (file: File) => string;
  };
  events: {
    onMenuNewArchive: (callback: () => void) => () => void;
    onMenuOpenArchive: (callback: () => void) => () => void;
    onMenuNewArchiveGitHub: (callback: () => void) => () => void;
    onMenuOpenArchiveGitHub: (callback: () => void) => () => void;
    onGitHubAuthDeviceCode: (
      callback: (details: {
        userCode: string;
        verificationUri: string;
        verificationUriComplete?: string;
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