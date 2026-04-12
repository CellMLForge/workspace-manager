/**
 * GitHub OAuth and API interactions
 */
import Store from "electron-store";
import fs from "fs";
import * as path from "path";
import * as git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import https from "https";
import { safeStorage, shell } from "electron";
import { GitHubSession, OperationResult, PushContext } from "../domain/models";
import { Octokit } from "@octokit/rest";
import { githubAuthConfig } from "./github-config";

type GitHubStoreShape = {
  sessionMetadata: Omit<GitHubSession, "accessToken"> | null;
  encryptedAccessToken: string | null;
  tokenStorageMode: "safeStorage" | "plain" | null;
};

type AuthProgressEvent = {
  stage: "starting" | "device_code" | "browser_opened" | "waiting" | "success" | "error";
  message: string;
  userCode?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  /** Populated on the "success" stage when GitHub granted fewer scopes than requested */
  scopeWarning?: string;
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

const HTTP_REQUEST_TIMEOUT_MS = 30_000;

function isGitHubAuthError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: unknown }).status;
    return status === 401 || status === 403;
  }
  return false;
}

export class GitHubService {
  private octokit: Octokit | null = null;
  private _authInProgress = false;
  private _authAbortController: { cancelled: boolean } | null = null;
  private store = new Store<GitHubStoreShape>({
    name: "omex-archive-manager",
    defaults: {
      sessionMetadata: null,
      encryptedAccessToken: null,
      tokenStorageMode: null,
    },
  });

  private createOctokit(accessToken: string) {
    return new Octokit({ auth: accessToken });
  }

  private resolveOAuthClientId() {
    return process.env[GITHUB_OAUTH_CLIENT_ID_ENV]?.trim() || githubAuthConfig.clientId;
  }

  getOAuthApplicationId(): string | null {
    const clientId = this.resolveOAuthClientId();
    return clientId ? clientId : null;
  }

  private storeSession(session: GitHubSession) {
    const metadata: Omit<GitHubSession, "accessToken"> = {
      username: session.username,
      avatarUrl: session.avatarUrl,
      scope: session.scope,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
    };

    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(session.accessToken).toString("base64");
      this.store.set("sessionMetadata", metadata);
      this.store.set("encryptedAccessToken", encrypted);
      this.store.set("tokenStorageMode", "safeStorage");
      return;
    }

    this.store.set("sessionMetadata", metadata);
    this.store.set("encryptedAccessToken", session.accessToken);
    this.store.set("tokenStorageMode", "plain");
    console.warn(
      "[GitHubService] OS-level encryption is unavailable. GitHub access token is stored in plain text. " +
        "Ensure the application data directory is protected by OS file permissions."
    );
  }

  private clearStoredSession() {
    this.store.set("sessionMetadata", null);
    this.store.set("encryptedAccessToken", null);
    this.store.set("tokenStorageMode", null);
  }

  private readStoredSessionToken(): string | null {
    const payload = this.store.get("encryptedAccessToken", null);
    const mode = this.store.get("tokenStorageMode", null);

    if (!payload || !mode) {
      return null;
    }

    if (mode === "safeStorage") {
      if (!safeStorage.isEncryptionAvailable()) {
        return null;
      }

      try {
        return safeStorage.decryptString(Buffer.from(payload, "base64"));
      } catch {
        return null;
      }
    }

    return payload;
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
            clearTimeout(requestTimer);
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

      let requestTimer: ReturnType<typeof setTimeout>;
      requestTimer = setTimeout(() => {
        request.destroy(new Error("GitHub OAuth request timed out."));
      }, HTTP_REQUEST_TIMEOUT_MS);

      request.on("error", (error) => {
        clearTimeout(requestTimer);
        reject(error);
      });
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
      displayName: profile.data.name ?? undefined,
      email: profile.data.email ?? undefined,
      avatarUrl: profile.data.avatar_url,
      scope: [],
    };

    this.octokit = octokit;
    return session;
  }

  /**
   * Initiate OAuth flow and acquire access token.
   * Uses GitHub Device Flow — opens browser for user consent, polls for completion.
   */
  async authenticateOAuth(
    onProgress?: (event: AuthProgressEvent) => void
  ): Promise<OperationResult<GitHubSession>> {
    if (this._authInProgress) {
      return { ok: false, error: "GitHub authorization is already in progress." };
    }

    const abort = { cancelled: false };
    this._authAbortController = abort;
    this._authInProgress = true;

    try {
      onProgress?.({ stage: "starting", message: "Starting GitHub device authorization..." });

      const clientId = this.resolveOAuthClientId();
      if (!clientId) {
        throw new Error(
          `GitHub OAuth client ID not configured. Set ${GITHUB_OAUTH_CLIENT_ID_ENV} or provide a packaged default.`
        );
      }

      const requestedScope =
        process.env[GITHUB_OAUTH_SCOPE_ENV]?.trim() || githubAuthConfig.defaultScope;

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

      onProgress?.({
        stage: "device_code",
        message: "GitHub device code received. Use the copy icon next to the code, then authorize in your browser.",
        userCode,
        verificationUri,
        verificationUriComplete: verificationUriComplete || undefined,
      });

      try {
        await shell.openExternal(authorizationUrl);
        onProgress?.({ stage: "browser_opened", message: "Browser opened for GitHub authorization." });
      } catch {
        // If browser launch fails, continue and rely on the error text below.
        onProgress?.({
          stage: "browser_opened",
          message: "Open browser manually to complete GitHub authorization.",
        });
      }

      const expiresInSeconds = Number(deviceAuthorization.expires_in ?? 900);
      const expiryTimestamp = Date.now() + Math.max(expiresInSeconds, 60) * 1000;
      let pollIntervalMs = Math.max(Number(deviceAuthorization.interval ?? 5), 5) * 1000;
      onProgress?.({ stage: "waiting", message: "Waiting for GitHub authorization confirmation..." });

      while (Date.now() < expiryTimestamp) {
        if (abort.cancelled) {
          throw new Error("GitHub sign-in was cancelled.");
        }

        await delay(pollIntervalMs);

        if (abort.cancelled) {
          throw new Error("GitHub sign-in was cancelled.");
        }

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

        this.storeSession(session);

        // Validate that all requested scopes were granted.
        const requestedScopes = requestedScope.split(/[\s,]+/).filter((s) => s.length > 0);
        const missingScopes = requestedScopes.filter((s) => !session.scope.includes(s));
        const successMessage =
          missingScopes.length > 0
            ? `GitHub authentication complete. Note: some requested permissions were not granted: ${missingScopes.join(", ")}.`
            : "GitHub authentication complete.";

        onProgress?.({
          stage: "success",
          message: successMessage,
          scopeWarning: missingScopes.length > 0 ? `Missing scopes: ${missingScopes.join(", ")}` : undefined,
        });
        return { ok: true, data: session };
      }

      throw new Error(
        `GitHub sign-in timed out. Complete authorization at ${verificationUri} using code ${userCode}.`
      );
    } catch (error) {
      const message = toErrorMessage(error);
      onProgress?.({ stage: "error", message });
      return { ok: false, error: message };
    } finally {
      this._authInProgress = false;
      this._authAbortController = null;
    }
  }

  /**
   * Cancel an in-progress device authorization flow.
   * Has no effect if no flow is currently active.
   */
  cancelAuthFlow(): void {
    if (this._authAbortController) {
      this._authAbortController.cancelled = true;
    }
  }

  /**
   * Restore existing session from secure storage
   */
  async restoreSession(): Promise<OperationResult<GitHubSession | null>> {
    try {
      const legacySession = (this.store as Store<any>).get("session", null) as GitHubSession | null;
      if (legacySession?.accessToken) {
        this.storeSession(legacySession);
        (this.store as Store<any>).set("session", null);
      }

      const sessionMetadata = this.store.get("sessionMetadata", null);
      const accessToken = this.readStoredSessionToken();

      if (!sessionMetadata || !accessToken) {
        return { ok: true, data: null };
      }

      const session: GitHubSession = {
        ...sessionMetadata,
        accessToken,
      };

      try {
        this.octokit = this.createOctokit(session.accessToken);
        await this.octokit.users.getAuthenticated();
        this.storeSession(session);
        return { ok: true, data: session };
      } catch {
        this.clearStoredSession();
        this.octokit = null;
        return { ok: true, data: null };
      }
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  }

  /**
   * Revoke and clear stored session.
   * Attempts server-side token revocation when a client secret is available via
   * the GITHUB_OAUTH_CLIENT_SECRET environment variable.
   */
  async logout(): Promise<OperationResult<void>> {
    try {
      const accessToken = this.readStoredSessionToken();
      const clientId = this.resolveOAuthClientId();
      const clientSecret = process.env["GITHUB_OAUTH_CLIENT_SECRET"]?.trim();

      if (accessToken && clientId && clientSecret) {
        await this.revokeGitHubToken(clientId, clientSecret, accessToken).catch(() => {
          // Server-side revocation failed; token may already be invalid or revoked.
          // Always clear local storage regardless.
        });
      }

      this.clearStoredSession();
      this.octokit = null;
      return { ok: true };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error) };
    }
  }

  private revokeGitHubToken(clientId: string, clientSecret: string, accessToken: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ access_token: accessToken });
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      let timer: ReturnType<typeof setTimeout>;

      const request = https.request(
        {
          hostname: "api.github.com",
          port: 443,
          path: `/applications/${encodeURIComponent(clientId)}/token`,
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/vnd.github+json",
            Authorization: `Basic ${credentials}`,
            "User-Agent": "omex-archive-manager",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (response) => {
          clearTimeout(timer);
          response.resume(); // consume the body to free the socket
          const status = response.statusCode ?? 0;
          if (status === 204 || status === 404) {
            resolve(); // 204 = revoked, 404 = token already gone
          } else {
            reject(new Error(`Token revocation failed with status ${status}.`));
          }
        }
      );

      timer = setTimeout(() => {
        request.destroy(new Error("Token revocation request timed out."));
      }, HTTP_REQUEST_TIMEOUT_MS);

      request.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      request.write(body);
      request.end();
    });
  }

  /**
   * Wraps Octokit API calls with automatic session invalidation on 401/403 errors.
   */
  private async withOctokit<T>(
    accessToken: string,
    fn: (octokit: Octokit) => Promise<T>
  ): Promise<OperationResult<T>> {
    try {
      const octokit = this.createOctokit(accessToken);
      const data = await fn(octokit);
      return { ok: true, data };
    } catch (error) {
      if (isGitHubAuthError(error)) {
        this.clearStoredSession();
        this.octokit = null;
        return { ok: false, error: toErrorMessage(error), authExpired: true };
      }
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
    return this.withOctokit(session.accessToken, async (octokit) => {
      const repos = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
        per_page: 100,
        sort: "updated",
      });
      return repos.map((repo) => ({
        name: repo.full_name,
        url: repo.clone_url,
        description: repo.description ?? undefined,
      }));
    });
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
    return this.withOctokit(session.accessToken, async (octokit) => {
      const response = await octokit.repos.createForAuthenticatedUser({
        name: repoName,
        description,
        private: isPrivate,
        auto_init: false,
      });
      return response.data.clone_url;
    });
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

      let authFailed = false;
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
        onAuthFailure: () => {
          authFailed = true;
          return { cancel: true };
        },
      });

      if (authFailed) {
        this.clearStoredSession();
        this.octokit = null;
        return {
          ok: false,
          error: "GitHub authentication expired. Please sign in again.",
          authExpired: true,
        };
      }

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

      let authFailed = false;
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
        onAuthFailure: () => {
          authFailed = true;
          return { cancel: true };
        },
      });

      if (authFailed) {
        this.clearStoredSession();
        this.octokit = null;
        return {
          ok: false,
          error: "GitHub authentication expired. Please sign in again.",
          authExpired: true,
        };
      }

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
    return this.withOctokit(session.accessToken, async (octokit) => {
      const response = await octokit.repos.get({ owner, repo });
      return {
        url: response.data.clone_url,
        isPrivate: response.data.private,
      };
    });
  }

  /**
   * Refresh access token if expired
   */
  async refreshToken(
    session: GitHubSession
  ): Promise<OperationResult<GitHubSession>> {
    return this.withOctokit(session.accessToken, async (octokit) => {
      const profile = await octokit.users.getAuthenticated();
      const refreshed: GitHubSession = {
        ...session,
        username: profile.data.login,
        avatarUrl: profile.data.avatar_url,
      };
      this.storeSession(refreshed);
      return refreshed;
    });
  }
}

export const githubService = new GitHubService();
