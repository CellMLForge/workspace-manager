/**
 * Workspace management service: create, open, import, and export workspace artifacts
 */
import fsDefault from "fs";
import { constants as fsConstants, promises as fs } from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import * as git from "isomorphic-git";
import { WorkspaceProject, OperationResult, WorkingTreeFile } from "../domain/models";
import { WorkspaceState } from "../domain/models";
import { gitService } from "./git";

const MANIFEST_FILE_NAME = "manifest.xml";
const ARTIFACTS_DIRECTORY_NAME = ".omex-artifacts";

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

export class WorkspaceService {
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
        throw new Error("No .git directory found — the workspace has not been initialised as a git repository.");
      }

      const artifactsDir = path.join(resolvedWorkingDir, ARTIFACTS_DIRECTORY_NAME);
      const name = path.basename(resolvedWorkingDir);
      const zipPath = path.join(artifactsDir, `${buildWorkspaceSlug(name)}.zip`);

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
      const dirStats = await fs.stat(resolvedWorkingDir);

      const workspace: WorkspaceProject = {
        id: randomUUID(),
        name,
        workingDir: resolvedWorkingDir,
        zipPath,
        artifactsDir,
        gitRepoUrl,
        gitBranch,
        manifestPath,
        state: WorkspaceState.WorkingTreeDirty,
        createdAt: dirStats.birthtime.toISOString(),
        lastModifiedAt: manifestStats.mtime.toISOString(),
      };

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
}

export const workspaceService = new WorkspaceService();
