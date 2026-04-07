/**
 * Core domain models for OMEX Archive Manager
 */

// Workflow state machine states
export enum ArchiveState {
  Empty = "empty",
  WorkingTreeDirty = "working-tree-dirty",
  ManifestUpdated = "manifest-updated",
  ZipBuilt = "zip-built",
  Base64Built = "base64-built",
  CommitReady = "commit-ready",
  Pushing = "pushing",
  Pushed = "pushed",
  Error = "error",
}

// OMEX Manifest entry for archive contents
export interface ManifestEntry {
  format: string; // e.g., "application/pdf", "text/plain"
  location: string; // relative path in archive
  description?: string;
  master?: boolean;
  created?: string; // ISO 8601 timestamp
  modified?: string; // ISO 8601 timestamp
  mediaType?: string;
  checksum?: string; // optional: SHA256 or similar
}

// Represents the archiveized working tree
export interface ArchiveProject {
  id: string; // UUID
  name: string;
  description?: string;
  workingDir: string; // absolute path to extracted working tree
  zipPath: string; // absolute path to output .zip
  artifactsDir: string; // absolute path to base64 and other outputs
  gitRepoUrl?: string; // GitHub repo for pushing
  gitBranch: string; // target branch for commits (default: main)
  manifestPath: string; // path to manifest.xml within working tree
  state: ArchiveState;
  createdAt: string; // ISO 8601
  lastModifiedAt: string; // ISO 8601
}

// Represents a file or folder in the working tree
export interface WorkingTreeFile {
  path: string; // relative within archive
  absolutePath: string; // absolute filesystem path
  isDirectory: boolean;
  size: number; // bytes
  checksum?: string; // lazy-calculated
  modified: string; // ISO 8601
}

// Represents a change in the working tree for commit
export interface GitChangeSet {
  added: string[]; // relative paths
  modified: string[]; // relative paths
  deleted: string[]; // relative paths
}

// User's intent to commit with a message
export interface CommitIntent {
  message: string;
  changes: GitChangeSet;
  timestamp: string; // ISO 8601
}

// Zip artifact metadata
export interface ZipArtifact {
  path: string; // absolute filesystem path to .zip
  size: number; // bytes
  checksum: string; // SHA256
  generatedAt: string; // ISO 8601
}

// Base64-encoded zip artifact
export interface Base64Artifact {
  path: string; // absolute filesystem path to .b64 file
  content: string; // base64-encoded zip
  generatedAt: string; // ISO 8601
}

// GitHub session and auth state
export interface GitHubSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string; // ISO 8601
  username: string;
  avatarUrl: string;
  scope: string[]; // permissions granted
}

// Commit suggestion (auto-generated from changes)
export interface CommitSuggestion {
  defaultMessage: string;
  templates: string[];
  reasoning: string;
}

// Push operation context
export interface PushContext {
  repoUrl: string;
  branch: string;
  isNewRepo: boolean; // true if creating new repo on GitHub
}

// Operation result wrapper
export interface OperationResult<T> {
  ok: boolean;
  data?: T;
  error?: Error | string;
}
