/**
 * Workspace management service: create, open, import, and export workspace artifacts
 */
import fsDefault from "fs";
import { constants as fsConstants, promises as fs } from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import * as git from "isomorphic-git";
import Store from "electron-store";
import {
  WorkspaceLibrarySettings,
  WorkspaceProject,
  OperationResult,
  WorkingTreeFile,
} from "../domain/models";
import { WorkspaceState } from "../domain/models";
import { gitService } from "./git";

// Read app version from package.json for versioning config files
const packageJson = require("../../package.json") as { version: string };
const APP_VERSION = packageJson.version;

const MANIFEST_FILE_NAME = "manifest.xml";
const ARTIFACTS_DIRECTORY_NAME = ".omex-artifacts";
const WORKSPACE_CONFIG_FILE_NAME = "cellmlforge-workspace-manager.json";
const WORKSPACE_CONFIG_SCHEMA_VERSION = "1.0";

type WorkspaceStoreShape = WorkspaceLibrarySettings;

type StoredWorkspaceMetadata = {
  schemaVersion: string;
  appVersion: string;
  name: string;
  description?: string;
  createdAt: string;
  lastModifiedBy?: string;
};

const normalizeSlashes = (value: string) => value.split(path.sep).join("/");

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

const buildWorkspaceSlug = (name: string) => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "workspace";
};

const createManifestStub = (workspaceName: string) => `<?xml version="1.0" encoding="UTF-8"?>
<omexManifest xmlns="http://identifiers.org/combine.specifications/omex-manifest">
  <content location="." format="http://identifiers.org/combine.specifications/omex" />
  <content location="./${MANIFEST_FILE_NAME}" format="http://identifiers.org/combine.specifications/omex-manifest" />
</omexManifest>
`;

const collectWorkingTreeEntries = async (
  rootDir: string,
  currentDir: string,
  excludedDirectories: Set<string>
): Promise<WorkingTreeFile[]> => {
  const directoryEntries = await fs.readdir(currentDir, { withFileTypes: true });
  const files: WorkingTreeFile[] = [];

  for (const entry of directoryEntries) {
    if (excludedDirectories.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = normalizeSlashes(path.relative(rootDir, absolutePath));
    const stats = await fs.stat(absolutePath);

    files.push({
      path: relativePath,
      absolutePath,
      isDirectory: entry.isDirectory(),
      size: stats.size,
      modified: stats.mtime.toISOString(),
    });

    if (entry.isDirectory()) {
      files.push(...(await collectWorkingTreeEntries(rootDir, absolutePath, excludedDirectories)));
    }
  }

  return files;
};

const toWorkingTreeEntry = async (
  rootDir: string,
  absolutePath: string
): Promise<WorkingTreeFile> => {
  const stats = await fs.stat(absolutePath);

  return {
    path: normalizeSlashes(path.relative(rootDir, absolutePath)),
    absolutePath,
    isDirectory: stats.isDirectory(),
    size: stats.size,
    modified: stats.mtime.toISOString(),
  };
};

const isPathInside = (candidatePath: string, parentPath: string) => {
  const relative = path.relative(parentPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const normalizeGitHubRemoteUrl = (remoteUrl: string): string => {
  const trimmed = remoteUrl.trim();

  if (!trimmed) {
    return trimmed;
  }

  // Convert SSH-style remotes to https for consistent UI display.
  const sshMatch = /^git@github\.com:(.+?)(?:\.git)?$/i.exec(trimmed);
  if (sshMatch?.[1]) {
    return `https://github.com/${sshMatch[1]}`;
  }

  const httpsMatch = /^https?:\/\/github\.com\/(.+?)(?:\.git)?$/i.exec(trimmed);
  if (httpsMatch?.[1]) {
    return `https://github.com/${httpsMatch[1]}`;
  }

  return trimmed;
};

const detectHasUncommittedChanges = async (workingDir: string) => {
  try {
    const matrix = await git.statusMatrix({ fs: fsDefault, dir: workingDir });
    return matrix.some(([, head, workdir, stage]) => head !== workdir || workdir !== stage);
  } catch {
    return true;
  }
};

export class WorkspaceService {
  private store = new Store<WorkspaceStoreShape>({
    name: "cellmlforge-workspace-manager-workspaces",
    defaults: {
      libraryPath: null,
      lastOpenedWorkspacePath: null,
    },
  });

  private getWorkspaceMetadataPath(workingDir: string) {
    return path.join(workingDir, WORKSPACE_CONFIG_FILE_NAME);
  }

  private readWorkspaceLibrarySettings(): WorkspaceLibrarySettings {
    return {
      libraryPath: this.store.get("libraryPath", null),
      lastOpenedWorkspacePath: this.store.get("lastOpenedWorkspacePath", null),
    };
  }

  private async writeWorkspaceMetadata(
    workingDir: string,
    metadata: Partial<StoredWorkspaceMetadata>
  ) {
    const metadataPath = this.getWorkspaceMetadataPath(workingDir);
    // Ensure the metadata includes version info
    const versionedMetadata = {
      ...metadata,
      schemaVersion: WORKSPACE_CONFIG_SCHEMA_VERSION,
      appVersion: APP_VERSION,
    } as StoredWorkspaceMetadata;
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await fs.writeFile(metadataPath, JSON.stringify(versionedMetadata, null, 2), "utf8");
  }

  private async readWorkspaceMetadata(
    workingDir: string
  ): Promise<StoredWorkspaceMetadata | null> {
    try {
      const content = await fs.readFile(this.getWorkspaceMetadataPath(workingDir), "utf8");
      const parsed = JSON.parse(content) as Partial<StoredWorkspaceMetadata>;
      if (!parsed.name || !parsed.createdAt) {
        return null;
      }

      return {
        schemaVersion: parsed.schemaVersion || WORKSPACE_CONFIG_SCHEMA_VERSION,
        appVersion: parsed.appVersion || APP_VERSION,
        name: parsed.name,
        description: parsed.description?.trim() || undefined,
        createdAt: parsed.createdAt,
        lastModifiedBy: parsed.lastModifiedBy,
      };
    } catch {
      return null;
    }
  }

  private async ensureWorkspaceMetadata(
    workingDir: string,
    fallbackName?: string
  ): Promise<StoredWorkspaceMetadata> {
    const existingMetadata = await this.readWorkspaceMetadata(workingDir);
    if (existingMetadata) {
      return existingMetadata;
    }

    const dirStats = await fs.stat(workingDir);
    const defaultMetadata: StoredWorkspaceMetadata = {
      schemaVersion: WORKSPACE_CONFIG_SCHEMA_VERSION,
      appVersion: APP_VERSION,
      name: (fallbackName || path.basename(workingDir)).trim() || "workspace",
      createdAt: dirStats.birthtime.toISOString(),
      lastModifiedBy: APP_VERSION,
    };

    await this.writeWorkspaceMetadata(workingDir, defaultMetadata);
    return defaultMetadata;
  }

  private async buildWorkspaceProject(
    resolvedWorkingDir: string
  ): Promise<WorkspaceProject> {
    const manifestPath = path.join(resolvedWorkingDir, MANIFEST_FILE_NAME);
    await fs.access(manifestPath);

    const gitDir = path.join(resolvedWorkingDir, ".git");
    await fs.access(gitDir);

    const artifactsDir = path.join(resolvedWorkingDir, ARTIFACTS_DIRECTORY_NAME);
    const fallbackName = path.basename(resolvedWorkingDir);
    const metadata = await this.ensureWorkspaceMetadata(resolvedWorkingDir, fallbackName);
    const workspaceName = metadata?.name?.trim() || fallbackName;
    const zipPath = path.join(artifactsDir, `${buildWorkspaceSlug(workspaceName)}.zip`);

    let gitBranch = "main";
    let gitRepoUrl: string | undefined;
    try {
      const branch = await git.currentBranch({ fs: fsDefault, dir: resolvedWorkingDir });
      if (branch) {
        gitBranch = branch;
      }

      const remotes = await git.listRemotes({ fs: fsDefault, dir: resolvedWorkingDir });
      const githubRemotes = remotes.filter((remote) => /github\.com/i.test(remote.url));
      const preferredRemote =
        githubRemotes.find((remote) => remote.remote === "origin") ??
        githubRemotes[0];

      if (preferredRemote?.url) {
        gitRepoUrl = normalizeGitHubRemoteUrl(preferredRemote.url);
      }
    } catch {
      // Non-fatal — fall back to defaults
    }

    const manifestStats = await fs.stat(manifestPath);

    const hasUncommittedChanges = await detectHasUncommittedChanges(resolvedWorkingDir);

    return {
      id: randomUUID(),
      name: workspaceName,
      description: metadata?.description,
      workingDir: resolvedWorkingDir,
      zipPath,
      artifactsDir,
      gitRepoUrl,
      gitBranch,
      manifestPath,
      state: hasUncommittedChanges ? WorkspaceState.WorkingTreeDirty : WorkspaceState.CommitReady,
      createdAt: metadata.createdAt,
      lastModifiedAt: manifestStats.mtime.toISOString(),
    };
  }

  async getWorkspaceLibrarySettings(): Promise<OperationResult<WorkspaceLibrarySettings>> {
    try {
      return { ok: true, data: this.readWorkspaceLibrarySettings() };
    } catch (error) {
      return { ok: false, error };
    }
  }

  async setWorkspaceLibraryPath(
    libraryPath: string
  ): Promise<OperationResult<WorkspaceLibrarySettings>> {
    try {
      const trimmedPath = libraryPath.trim();
      if (!trimmedPath) {
        throw new Error("A workspace library directory is required.");
      }

      const resolvedLibraryPath = path.resolve(trimmedPath);
      await fs.mkdir(resolvedLibraryPath, { recursive: true });

      this.store.set("libraryPath", resolvedLibraryPath);

      const lastOpenedWorkspacePath = this.store.get("lastOpenedWorkspacePath", null);
      if (lastOpenedWorkspacePath && !isPathInside(lastOpenedWorkspacePath, resolvedLibraryPath)) {
        this.store.set("lastOpenedWorkspacePath", null);
      }

      return { ok: true, data: this.readWorkspaceLibrarySettings() };
    } catch (error) {
      return { ok: false, error };
    }
  }

  async rememberLastOpenedWorkspace(
    workingDir: string | null
  ): Promise<OperationResult<void>> {
    try {
      const trimmedPath = workingDir?.trim() ?? "";
      if (!trimmedPath) {
        this.store.set("lastOpenedWorkspacePath", null);
        return { ok: true };
      }

      this.store.set("lastOpenedWorkspacePath", path.resolve(trimmedPath));
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  async listLibraryWorkspaces(): Promise<OperationResult<WorkspaceProject[]>> {
    try {
      const { libraryPath } = this.readWorkspaceLibrarySettings();
      if (!libraryPath) {
        return { ok: true, data: [] };
      }

      await fs.mkdir(libraryPath, { recursive: true });
      const entries = await fs.readdir(libraryPath, { withFileTypes: true });
      const workspaces: WorkspaceProject[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const candidatePath = path.join(libraryPath, entry.name);
        try {
          workspaces.push(await this.buildWorkspaceProject(candidatePath));
        } catch {
          // Ignore folders that are not valid workspaces.
        }
      }

      workspaces.sort((left, right) => left.name.localeCompare(right.name));
      return { ok: true, data: workspaces };
    } catch (error) {
      return { ok: false, error };
    }
  }

  async createWorkspaceInLibrary(
    name: string,
    description?: string
  ): Promise<OperationResult<WorkspaceProject>> {
    try {
      const { libraryPath } = this.readWorkspaceLibrarySettings();
      if (!libraryPath) {
        throw new Error("Set a workspace library location before creating a workspace.");
      }

      const workspaceSlug = buildWorkspaceSlug(name);
      const targetDir = path.join(libraryPath, workspaceSlug);

      try {
        await fs.access(targetDir);
        throw new Error(
          `A workspace named '${workspaceSlug}' already exists in the current workspace library.`
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }

      return this.createWorkspace(name, targetDir, description);
    } catch (error) {
      return { ok: false, error };
    }
  }

  async importWorkspaceToLibrary(
    sourceWorkspaceDir: string
  ): Promise<OperationResult<WorkspaceProject>> {
    try {
      const { libraryPath } = this.readWorkspaceLibrarySettings();
      if (!libraryPath) {
        throw new Error("Set a workspace library location before importing a workspace.");
      }

      const sourcePath = path.resolve(sourceWorkspaceDir.trim());
      if (!sourceWorkspaceDir.trim()) {
        throw new Error("Select a workspace directory to import.");
      }

      const sourceWorkspace = await this.buildWorkspaceProject(sourcePath);
      const targetDir = path.join(libraryPath, buildWorkspaceSlug(sourceWorkspace.name));

      if (normalizeSlashes(sourcePath) === normalizeSlashes(targetDir)) {
        throw new Error("The selected workspace is already inside the current workspace library.");
      }

      try {
        await fs.access(targetDir);
        throw new Error(
          `A workspace named '${path.basename(targetDir)}' already exists in the current workspace library.`
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }

      await fs.cp(sourcePath, targetDir, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });

      return this.openWorkspace(targetDir);
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
  * Create a new empty workspace project
   */
  async createWorkspace(
    name: string,
    workingDir: string,
    description?: string
  ): Promise<OperationResult<WorkspaceProject>> {
    try {
      const trimmedName = name.trim();
      const resolvedWorkingDir = path.resolve(workingDir.trim());

      if (!trimmedName) {
        throw new Error("Workspace name is required.");
      }

      if (!workingDir.trim()) {
        throw new Error("A workspace directory is required.");
      }

      await fs.mkdir(resolvedWorkingDir, { recursive: true });

      const existingEntries = await fs.readdir(resolvedWorkingDir);
      if (existingEntries.length > 0) {
        throw new Error("The selected workspace must be empty to create a new workspace.");
      }

      const artifactsDir = path.join(resolvedWorkingDir, ARTIFACTS_DIRECTORY_NAME);
      const manifestPath = path.join(resolvedWorkingDir, MANIFEST_FILE_NAME);
      const zipPath = path.join(artifactsDir, `${buildWorkspaceSlug(trimmedName)}.zip`);
      const now = new Date().toISOString();

      await fs.mkdir(artifactsDir, { recursive: true });
      await fs.writeFile(manifestPath, createManifestStub(trimmedName), "utf8");
      await this.writeWorkspaceMetadata(resolvedWorkingDir, {
        name: trimmedName,
        description: description?.trim() || undefined,
        createdAt: now,
      });

      const gitResult = await gitService.initRepository(resolvedWorkingDir, [
        `${ARTIFACTS_DIRECTORY_NAME}/`,
        "*.zip",
        "*.b64",
      ]);

      if (!gitResult.ok) {
        throw toErrorMessage(gitResult.error);
      }

      const workspace: WorkspaceProject = {
        id: randomUUID(),
        name: trimmedName,
        description: description?.trim() || undefined,
        workingDir: resolvedWorkingDir,
        zipPath,
        artifactsDir,
        gitBranch: "main",
        manifestPath,
        state: WorkspaceState.Empty,
        createdAt: now,
        lastModifiedAt: now,
      };

      return { ok: true, data: workspace };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
    * Open an existing workspace from a working directory
   */
  async openWorkspace(
    workingDir: string
  ): Promise<OperationResult<WorkspaceProject>> {
    try {
      const resolvedWorkingDir = path.resolve(workingDir.trim());

      if (!workingDir.trim()) {
        throw new Error("A workspace directory is required.");
      }

      await fs.access(resolvedWorkingDir);

      let workspace: WorkspaceProject;
      try {
        workspace = await this.buildWorkspaceProject(resolvedWorkingDir);
      } catch {
        const manifestPath = path.join(resolvedWorkingDir, MANIFEST_FILE_NAME);
        try {
          await fs.access(manifestPath);
        } catch {
          throw new Error("No manifest.xml found — this directory is not an OMEX workspace.");
        }

        const gitDir = path.join(resolvedWorkingDir, ".git");
        try {
          await fs.access(gitDir);
        } catch {
          throw new Error(
            "No .git directory found — the workspace has not been initialised as a git repository."
          );
        }

        throw new Error("Unable to open the selected workspace.");
      }

      return { ok: true, data: workspace };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
    * Import files from filesystem into workspace working tree
   */
  async importFiles(
    archive: WorkspaceProject,
    sourceFiles: string[],
    overwriteExisting = false
  ): Promise<OperationResult<WorkingTreeFile[]>> {
    try {
      const resolvedWorkingDir = path.resolve(archive.workingDir);
      const selectedSources = sourceFiles
        .map((sourcePath) => sourcePath.trim())
        .filter((sourcePath) => sourcePath.length > 0);

      if (selectedSources.length === 0) {
        return { ok: true, data: [] };
      }

      await fs.access(resolvedWorkingDir);

      const reservedNames = new Set<string>([
        ".git",
        path.basename(archive.artifactsDir),
      ]);

      const destinationPaths = new Set<string>();
      const importPlan: Array<{ sourceAbsolutePath: string; destinationAbsolutePath: string; isDirectory: boolean }> = [];

      for (const selectedSource of selectedSources) {
        const sourceAbsolutePath = path.resolve(selectedSource);
        const sourceName = path.basename(sourceAbsolutePath);

        if (reservedNames.has(sourceName)) {
          throw new Error(`Cannot import reserved entry '${sourceName}'.`);
        }

        if (isPathInside(sourceAbsolutePath, resolvedWorkingDir)) {
          throw new Error(`Cannot import '${sourceName}' from inside the current workspace.`);
        }

        const sourceStats = await fs.stat(sourceAbsolutePath);
        const destinationAbsolutePath = path.join(resolvedWorkingDir, sourceName);

        if (destinationPaths.has(destinationAbsolutePath)) {
          throw new Error(`Multiple selected sources resolve to the same destination '${sourceName}'.`);
        }

        destinationPaths.add(destinationAbsolutePath);

        try {
          await fs.access(destinationAbsolutePath);
          if (!overwriteExisting) {
            throw new Error(`Import collision: '${sourceName}' already exists in the workspace.`);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }

        importPlan.push({
          sourceAbsolutePath,
          destinationAbsolutePath,
          isDirectory: sourceStats.isDirectory(),
        });
      }

      const importedEntries: WorkingTreeFile[] = [];

      for (const planItem of importPlan) {
        if (overwriteExisting) {
          await fs.rm(planItem.destinationAbsolutePath, {
            recursive: true,
            force: true,
          });
        }

        if (planItem.isDirectory) {
          await fs.cp(planItem.sourceAbsolutePath, planItem.destinationAbsolutePath, {
            recursive: true,
            force: overwriteExisting,
            errorOnExist: !overwriteExisting,
          });

          importedEntries.push(await toWorkingTreeEntry(resolvedWorkingDir, planItem.destinationAbsolutePath));
          importedEntries.push(
            ...(await collectWorkingTreeEntries(
              resolvedWorkingDir,
              planItem.destinationAbsolutePath,
              new Set<string>()
            ))
          );
          continue;
        }

        await fs.copyFile(
          planItem.sourceAbsolutePath,
          planItem.destinationAbsolutePath,
          overwriteExisting ? 0 : fsConstants.COPYFILE_EXCL
        );

        importedEntries.push(await toWorkingTreeEntry(resolvedWorkingDir, planItem.destinationAbsolutePath));
      }

      importedEntries.sort((left, right) => left.path.localeCompare(right.path));
      archive.state = WorkspaceState.WorkingTreeDirty;
      archive.lastModifiedAt = new Date().toISOString();

      return { ok: true, data: importedEntries };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error).message };
    }
  }

  /**
   * List files in working tree
   */
  async listFiles(
    archive: WorkspaceProject
  ): Promise<OperationResult<WorkingTreeFile[]>> {
    try {
      const excludedDirectories = new Set<string>([
        ".git",
        path.basename(archive.artifactsDir),
      ]);

      const files = await collectWorkingTreeEntries(
        archive.workingDir,
        archive.workingDir,
        excludedDirectories
      );

      files.sort((left, right) => left.path.localeCompare(right.path));
      return { ok: true, data: files };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Get file content (for text files)
   */
  async getFileContent(
    filePath: string
  ): Promise<OperationResult<string>> {
    try {
      // TODO: Implementation
      throw new Error("Not implemented");
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Delete a file or directory from working tree
   */
  async deleteFile(
    archive: WorkspaceProject,
    filePath: string
  ): Promise<OperationResult<void>> {
    try {
      // TODO: Implementation
      throw new Error("Not implemented");
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Export (download) the final .zip artifact
   */
  async exportZip(archive: WorkspaceProject): Promise<OperationResult<string>> {
    try {
      // TODO: Implementation
      // Returns path to .zip file
      throw new Error("Not implemented");
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Update workspace metadata (name, description)
   */
  async updateWorkspaceMetadata(
    workingDir: string,
    updates: Partial<StoredWorkspaceMetadata>
  ): Promise<OperationResult<StoredWorkspaceMetadata>> {
    try {
      const resolvedWorkingDir = path.resolve(workingDir.trim());
      const existingMetadata = await this.ensureWorkspaceMetadata(resolvedWorkingDir);

      const updatedMetadata: StoredWorkspaceMetadata = {
        schemaVersion: existingMetadata.schemaVersion,
        appVersion: APP_VERSION,
        name: updates.name?.trim() || existingMetadata.name,
        description: updates.description !== undefined ? updates.description?.trim() || undefined : existingMetadata.description,
        createdAt: existingMetadata.createdAt,
        lastModifiedBy: APP_VERSION,
      };

      await this.writeWorkspaceMetadata(resolvedWorkingDir, updatedMetadata);
      return { ok: true, data: updatedMetadata };
    } catch (error) {
      return { ok: false, error };
    }
  }
}

export const workspaceService = new WorkspaceService();
