/**
 * GitHub OAuth and API interactions
 */
import Store from "electron-store";
import fs from "fs";
import * as path from "path";
import * as git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import https from "https";
import { dialog, shell } from "electron";
import { GitHubSession, OperationResult, PushContext } from "../domain/models";
import { Octokit } from "@octokit/rest";

type GitHubStoreShape = {
  session: GitHubSession | null;
};

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const GITHUB_OAUTH_CLIENT_ID_ENV = "GITHUB_OAUTH_CLIENT_ID";
const GITHUB_OAUTH_SCOPE_ENV = "GITHUB_OAUTH_SCOPE";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

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

  private postGitHubOAuthForm(
    url: string,
    payload: Record<string, string>
  ): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      const body = new URLSearchParams(payload).toString();
      const requestUrl = new URL(url);

      const request = https.request(
        {
          protocol: requestUrl.protocol,
          hostname: requestUrl.hostname,
          port: requestUrl.port || 443,
          path: `${requestUrl.pathname}${requestUrl.search}`,
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "Content-Length": Buffer.byteLength(body),
            "User-Agent": "omex-archive-manager",
          },
        },
        (response) => {
          let responseBody = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            responseBody += chunk;
          });
          response.on("end", () => {
            const statusCode = response.statusCode ?? 0;
            if (statusCode < 200 || statusCode >= 300) {
              reject(new Error(`GitHub OAuth request failed with status ${statusCode}.`));
              return;
            }

            try {
              resolve(JSON.parse(responseBody));
            } catch {
              reject(new Error("GitHub OAuth response was not valid JSON."));
            }
          });
        }
      );

      request.on("error", (error) => reject(error));
      request.write(body);
      request.end();
    });
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
  async authenticateOAuth(
    onDeviceCode?: (details: {
      userCode: string;
      verificationUri: string;
      verificationUriComplete?: string;
    }) => void
  ): Promise<OperationResult<GitHubSession>> {
    try {
      const clientId = process.env[GITHUB_OAUTH_CLIENT_ID_ENV]?.trim();
      if (!clientId) {
        throw new Error(
          `GitHub OAuth client ID not configured. Set ${GITHUB_OAUTH_CLIENT_ID_ENV} before launching the app.`
        );
      }

      const requestedScope =
        process.env[GITHUB_OAUTH_SCOPE_ENV]?.trim() || "repo read:user";

      const deviceAuthorization = await this.postGitHubOAuthForm(DEVICE_CODE_URL, {
        client_id: clientId,
        scope: requestedScope,
      });

      const deviceCode = String(deviceAuthorization.device_code ?? "").trim();
      const userCode = String(deviceAuthorization.user_code ?? "").trim();
      const verificationUri = String(deviceAuthorization.verification_uri ?? "").trim();
      const verificationUriComplete = String(deviceAuthorization.verification_uri_complete ?? "").trim();

      if (!deviceCode || !verificationUri) {
        throw new Error("GitHub device authorization did not return the required fields.");
      }

      const authorizationUrl = verificationUriComplete || verificationUri;

      if (onDeviceCode) {
        onDeviceCode({
          userCode,
          verificationUri,
          verificationUriComplete: verificationUriComplete || undefined,
        });
      }

      await dialog.showMessageBox({
        type: "info",
        buttons: ["Continue"],
        defaultId: 0,
        noLink: true,
        title: "Authorize GitHub device",
        message: "Complete GitHub sign-in",
        detail: [
          `Code: ${userCode || "(not provided)"}`,
          `Verification URL: ${verificationUri}`,
          "",
          "A browser window will open for authorization.",
          "If prompted for a device code, enter the code shown above.",
        ].join("\n"),
      });

      try {
        await shell.openExternal(authorizationUrl);
      } catch {
        // If browser launch fails, continue and rely on the error text below.
      }

      const expiresInSeconds = Number(deviceAuthorization.expires_in ?? 900);
      const expiryTimestamp = Date.now() + Math.max(expiresInSeconds, 60) * 1000;
      let pollIntervalMs = Math.max(Number(deviceAuthorization.interval ?? 5), 5) * 1000;

      while (Date.now() < expiryTimestamp) {
        await delay(pollIntervalMs);

        const tokenResponse = await this.postGitHubOAuthForm(ACCESS_TOKEN_URL, {
          client_id: clientId,
          device_code: deviceCode,
          grant_type: DEVICE_GRANT_TYPE,
        });

        if (tokenResponse.error) {
          const oauthError = String(tokenResponse.error);
          if (oauthError === "authorization_pending") {
            continue;
          }

          if (oauthError === "slow_down") {
            pollIntervalMs += 5000;
            continue;
          }

          if (oauthError === "access_denied") {
            throw new Error("GitHub sign-in was cancelled.");
          }

          if (oauthError === "expired_token") {
            throw new Error("GitHub sign-in expired before authorization completed.");
          }

          const description = String(tokenResponse.error_description ?? "").trim();
          throw new Error(description || `GitHub OAuth error: ${oauthError}`);
        }

        const accessToken = String(tokenResponse.access_token ?? "").trim();
        if (!accessToken) {
          throw new Error("GitHub OAuth did not return an access token.");
        }

        const session = await this.hydrateSessionFromToken(accessToken);
        const grantedScopeRaw = String(tokenResponse.scope ?? "").trim();
        session.scope = grantedScopeRaw
          ? grantedScopeRaw.split(/[\s,]+/).filter((entry) => entry.length > 0)
          : [];

        this.store.set("session", session);
        return { ok: true, data: session };
      }

      throw new Error(
        `GitHub sign-in timed out. Complete authorization at ${verificationUri} using code ${userCode}.`
      );

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
