/**
 * GitHub OAuth and API interactions
 */
import Store from "electron-store";
import fs from "fs";
import * as path from "path";
import * as git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import { GitHubSession, OperationResult, PushContext } from "../domain/models";
import { Octokit } from "@octokit/rest";

type GitHubStoreShape = {
  session: GitHubSession | null;
};

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const GITHUB_TOKEN_ENV = "GITHUB_TOKEN";

export class GitHubService {
  private octokit: Octokit | null = null;
  private store = new Store<GitHubStoreShape>({
    name: "omex-archive-manager",
    defaults: {
      session: null,
    },
  });

  private createOctokit(accessToken: string) {
    return new Octokit({ auth: accessToken });
  }

  private async hydrateSessionFromToken(accessToken: string): Promise<GitHubSession> {
    const octokit = this.createOctokit(accessToken);
    const profile = await octokit.users.getAuthenticated();

    const session: GitHubSession = {
      accessToken,
      username: profile.data.login,
      avatarUrl: profile.data.avatar_url,
      scope: [],
    };

    this.octokit = octokit;
    this.store.set("session", session);

    return session;
  }

  /**
   * Initiate OAuth flow and acquire access token
   * Opens browser for GitHub consent, waits for callback
   */
  async authenticateOAuth(): Promise<OperationResult<GitHubSession>> {
    try {
      // MVP auth path: consume token from environment.
      // This allows the integration to work end-to-end before full OAuth app setup.
      const tokenFromEnv = process.env[GITHUB_TOKEN_ENV]?.trim();
      if (!tokenFromEnv) {
        throw new Error(
          `GitHub token not configured. Set ${GITHUB_TOKEN_ENV} before launching the app.`
        );
      }

      const session = await this.hydrateSessionFromToken(tokenFromEnv);
      return { ok: true, data: session };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  }

  /**
   * Restore existing session from secure storage
   */
  async restoreSession(): Promise<OperationResult<GitHubSession | null>> {
    try {
      const session = this.store.get("session", null);
      if (!session) {
        return { ok: true, data: null };
      }

      try {
        this.octokit = this.createOctokit(session.accessToken);
        await this.octokit.users.getAuthenticated();
        return { ok: true, data: session };
      } catch {
        this.store.set("session", null);
        this.octokit = null;
        return { ok: true, data: null };
      }
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  }

  /**
   * Revoke and clear stored session
   */
  async logout(): Promise<OperationResult<void>> {
    try {
      this.store.set("session", null);
      this.octokit = null;
      return { ok: true };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  }

  /**
   * List user's repositories
   */
  async listRepositories(
    session: GitHubSession
  ): Promise<
    OperationResult<{ name: string; url: string; description?: string }[]>
  > {
    try {
      const octokit = this.createOctokit(session.accessToken);
      const repos = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
        per_page: 100,
        sort: "updated",
      });

      return {
        ok: true,
        data: repos.map((repo) => ({
          name: repo.full_name,
          url: repo.clone_url,
          description: repo.description ?? undefined,
        })),
      };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  }

  /**
   * Create a new repository on GitHub
   */
  async createRepository(
    session: GitHubSession,
    repoName: string,
    description?: string,
    isPrivate: boolean = false
  ): Promise<OperationResult<string>> {
    try {
      const octokit = this.createOctokit(session.accessToken);
      const response = await octokit.repos.createForAuthenticatedUser({
        name: repoName,
        description,
        private: isPrivate,
        auto_init: false,
      });

      return { ok: true, data: response.data.clone_url };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  }

  /**
   * Push commits to GitHub repository
   */
  async push(
    session: GitHubSession,
    workingDir: string,
    pushContext: PushContext
  ): Promise<OperationResult<{ message: string; url: string }>> {
    try {
      const dir = path.resolve(workingDir);
      const remoteName = "origin";

      const remotes = await git.listRemotes({ fs, dir });
      const existingRemote = remotes.find((remote) => remote.remote === remoteName);

      if (!existingRemote) {
        await git.addRemote({
          fs,
          dir,
          remote: remoteName,
          url: pushContext.repoUrl,
          force: true,
        });
      } else if (existingRemote.url !== pushContext.repoUrl) {
        await git.deleteRemote({ fs, dir, remote: remoteName });
        await git.addRemote({
          fs,
          dir,
          remote: remoteName,
          url: pushContext.repoUrl,
          force: true,
        });
      }

      await git.push({
        fs,
        http,
        dir,
        remote: remoteName,
        remoteRef: pushContext.branch,
        ref: pushContext.branch,
        force: false,
        onAuth: () => ({
          username: session.username || "x-access-token",
          password: session.accessToken,
        }),
      });

      return {
        ok: true,
        data: {
          message: `Pushed ${pushContext.branch} to ${pushContext.repoUrl}`,
          url: pushContext.repoUrl,
        },
      };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  }

  /**
   * Clone a GitHub repository into a local directory
   */
  async cloneRepository(
    session: GitHubSession,
    repoUrl: string,
    localDir: string
  ): Promise<OperationResult<string>> {
    try {
      const dir = path.resolve(localDir);
      await fs.promises.mkdir(dir, { recursive: true });

      const existingEntries = await fs.promises.readdir(dir);
      if (existingEntries.length > 0) {
        throw new Error("Target folder must be empty before cloning.");
      }

      await git.clone({
        fs,
        http,
        dir,
        url: repoUrl,
        singleBranch: false,
        depth: 1,
        onAuth: () => ({
          username: session.username || "x-access-token",
          password: session.accessToken,
        }),
      });

      return { ok: true, data: dir };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  }

  /**
   * Get repository details by owner/repo
   */
  async getRepositoryDetails(
    session: GitHubSession,
    owner: string,
    repo: string
  ): Promise<OperationResult<{ url: string; isPrivate: boolean }>> {
    try {
      const octokit = this.createOctokit(session.accessToken);
      const response = await octokit.repos.get({ owner, repo });

      return {
        ok: true,
        data: {
          url: response.data.clone_url,
          isPrivate: response.data.private,
        },
      };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  }

  /**
   * Refresh access token if expired
   */
  async refreshToken(
    session: GitHubSession
  ): Promise<OperationResult<GitHubSession>> {
    try {
      // Token refresh depends on OAuth app configuration; validate current token for now.
      const refreshed = await this.hydrateSessionFromToken(session.accessToken);
      return { ok: true, data: refreshed };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  }
}

export const githubService = new GitHubService();
