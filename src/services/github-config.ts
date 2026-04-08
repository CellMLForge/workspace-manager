import rawGithubAuthConfig from "./github-config.json";

type GitHubAuthConfig = {
  clientId: string;
  defaultScope: string;
};

const defaultGitHubAuthConfig: GitHubAuthConfig = {
  clientId: "",
  defaultScope: "repo read:user",
};

export const githubAuthConfig: GitHubAuthConfig = {
  clientId:
    typeof rawGithubAuthConfig.clientId === "string"
      ? rawGithubAuthConfig.clientId.trim()
      : defaultGitHubAuthConfig.clientId,
  defaultScope:
    typeof rawGithubAuthConfig.defaultScope === "string" && rawGithubAuthConfig.defaultScope.trim()
      ? rawGithubAuthConfig.defaultScope.trim()
      : defaultGitHubAuthConfig.defaultScope,
};