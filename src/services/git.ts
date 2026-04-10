/**
 * Git operations and change detection
 */
import fs from "fs";
import { promises as fsPromises } from "fs";
import * as path from "path";
import * as git from "isomorphic-git";
import {
  GitHubSession,
  WorkspaceProject,
  GitChangeSet,
  CommitSuggestion,
  OperationResult,
  CommitIntent,
  WorkspaceGitSnapshot,
} from "../domain/models";

type CommitAuthor = {
  name: string;
  email: string;
};

export class GitService {
  private commitAuthor: CommitAuthor = {
    name: "CellMLForge Workspace Manager",
    email: "workspace-manager@cellmlforge.local",
  };

  setCommitAuthorFromGitHubSession(session: GitHubSession | null) {
    if (!session?.username) {
      this.commitAuthor = {
        name: "CellMLForge Workspace Manager",
        email: "workspace-manager@cellmlforge.local",
      };
      return;
    }

    const derivedEmail = session.email?.trim() || `${session.username}@users.noreply.github.com`;
    this.commitAuthor = {
      name: session.displayName?.trim() || session.username,
      email: derivedEmail,
    };
  }

  /**
   * Initialize a git repository in working directory
   */
  async initRepository(
    workingDir: string,
    gitignoreRules?: string[]
  ): Promise<OperationResult<void>> {
    try {
      const resolvedWorkingDir = path.resolve(workingDir);
      await fsPromises.mkdir(resolvedWorkingDir, { recursive: true });

      const gitDir = path.join(resolvedWorkingDir, ".git");
      const gitignorePath = path.join(resolvedWorkingDir, ".gitignore");

      const defaultIgnoreRules = [
        ".omex-artifacts/",
        "*.zip",
        "*.b64",
      ];
      const rules = gitignoreRules?.length ? gitignoreRules : defaultIgnoreRules;

      await fsPromises.writeFile(gitignorePath, `${rules.join("\n")}\n`, "utf8");

      try {
        await fsPromises.access(gitDir);
      } catch {
        await git.init({
          fs,
          dir: resolvedWorkingDir,
          defaultBranch: "main",
        });
      }

      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Detect changed files in working tree
   */
  async detectChanges(
    workspace: WorkspaceProject
  ): Promise<OperationResult<GitChangeSet>> {
    try {
      const dir = path.resolve(workspace.workingDir);
      const matrix = await git.statusMatrix({ fs, dir });

      const added: string[] = [];
      const modified: string[] = [];
      const deleted: string[] = [];

      for (const [filePath, head, workdir] of matrix) {
        if (filePath.startsWith(".git/")) {
          continue;
        }

        if (head === 0 && workdir !== 0) {
          added.push(filePath);
          continue;
        }

        if (head !== 0 && workdir === 0) {
          deleted.push(filePath);
          continue;
        }

        if (head !== 0 && workdir === 2) {
          modified.push(filePath);
        }
      }

      added.sort((a, b) => a.localeCompare(b));
      modified.sort((a, b) => a.localeCompare(b));
      deleted.sort((a, b) => a.localeCompare(b));

      return {
        ok: true,
        data: { added, modified, deleted },
      };
    } catch (error) {
      return { ok: false, error };
    }
  }

  async getWorkspaceSnapshot(
    workspace: WorkspaceProject
  ): Promise<OperationResult<WorkspaceGitSnapshot>> {
    try {
      const dir = path.resolve(workspace.workingDir);
      const matrix = await git.statusMatrix({ fs, dir });
      const hasUncommittedChanges = matrix.some(([filePath, head, workdir]) => {
        if (filePath.startsWith(".git/")) {
          return false;
        }

        return head !== workdir;
      });

      let gitBranch: string | undefined;
      let gitRevision: string | undefined;
      let gitRepoUrl: string | undefined;

      try {
        const branch = await git.currentBranch({ fs, dir });
        if (branch) {
          gitBranch = branch;
        }
      } catch {
        // Optional metadata only.
      }

      try {
        const revision = await git.resolveRef({ fs, dir, ref: "HEAD" });
        if (revision) {
          gitRevision = revision;
        }
      } catch {
        // Optional metadata only.
      }

      try {
        const remotes = await git.listRemotes({ fs, dir });
        const preferredRemote =
          remotes.find((remote) => remote.remote === "origin") ??
          remotes.find((remote) => /github\.com/i.test(remote.url)) ??
          remotes[0];

        if (preferredRemote?.url) {
          gitRepoUrl = preferredRemote.url;
        }
      } catch {
        // Optional metadata only.
      }

      return {
        ok: true,
        data: {
          capturedAt: new Date().toISOString(),
          gitBranch,
          gitRevision,
          gitRepoUrl,
          hasUncommittedChanges,
        },
      };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Generate a commit message suggestion from changes
   */
  async suggestCommitMessage(
    changes: GitChangeSet
  ): Promise<OperationResult<CommitSuggestion>> {
    try {
      const addedCount = changes.added.length;
      const modifiedCount = changes.modified.length;
      const deletedCount = changes.deleted.length;
      const totalCount = addedCount + modifiedCount + deletedCount;

      const touchedCellml = [...changes.added, ...changes.modified]
        .find((file) => file.toLowerCase().endsWith(".cellml"));

      const defaultMessage = touchedCellml
        ? `Updating CellML model (${path.basename(touchedCellml)}) due to <enter reason here>`
        : totalCount === 0
          ? "No workspace changes detected"
          : modifiedCount > 0
            ? `Update workspace content (${modifiedCount} modified file${modifiedCount === 1 ? "" : "s"})`
            : addedCount > 0
              ? `Add workspace content (${addedCount} file${addedCount === 1 ? "" : "s"})`
              : `Remove workspace content (${deletedCount} file${deletedCount === 1 ? "" : "s"})`;

      const templates = [
        defaultMessage,
        "Update simulation setup: <short reason>",
        "Refine model parameters: <short reason>",
        "Fix manifest and workspace consistency",
      ];

      const reasoning = [
        `Detected ${addedCount} added, ${modifiedCount} modified, ${deletedCount} deleted files.`,
        "Use a short summary line first (similar to GitHub), then optionally add detail below.",
      ].join(" ");

      return {
        ok: true,
        data: {
          defaultMessage,
          templates,
          reasoning,
        },
      };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Stage all changes and commit with message
   */
  async commit(
    workspace: WorkspaceProject,
    message: string
  ): Promise<OperationResult<string>> {
    try {
      const dir = path.resolve(workspace.workingDir);
      const trimmedMessage = message.trim();

      if (!trimmedMessage) {
        throw new Error("Commit message is required.");
      }

      const matrix = await git.statusMatrix({ fs, dir });
      const changedFiles = matrix
        .filter(([filePath, head, workdir]) => filePath && head !== workdir)
        .map(([filePath]) => filePath);

      if (changedFiles.length === 0) {
        throw new Error("No changes to commit.");
      }

      await Promise.all(
        changedFiles.map((filePath) => git.add({ fs, dir, filepath: filePath }))
      );

      const oid = await git.commit({
        fs,
        dir,
        message: trimmedMessage,
        author: this.commitAuthor,
      });

      return { ok: true, data: oid };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Get git log for current branch
   */
  async getLog(
    workingDir: string,
    limit?: number
  ): Promise<OperationResult<{ hash: string; message: string; date: string }[]>> {
    try {
      // TODO: Implementation
      throw new Error("Not implemented");
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(
    workingDir: string
  ): Promise<OperationResult<string>> {
    try {
      // TODO: Implementation
      throw new Error("Not implemented");
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Set remote URL
   */
  async setRemote(
    workingDir: string,
    name: string,
    url: string
  ): Promise<OperationResult<void>> {
    try {
      // TODO: Implementation
      throw new Error("Not implemented");
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Create a new branch
   */
  async createBranch(
    workingDir: string,
    branchName: string
  ): Promise<OperationResult<void>> {
    try {
      // TODO: Implementation
      throw new Error("Not implemented");
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Checkout a branch
   */
  async checkoutBranch(
    workingDir: string,
    branchName: string
  ): Promise<OperationResult<void>> {
    try {
      // TODO: Implementation
      throw new Error("Not implemented");
    } catch (error) {
      return { ok: false, error };
    }
  }
}

export const gitService = new GitService();
