const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const git = require("isomorphic-git");
const fsNode = require("fs");

const { workspaceService } = require("../dist/services/workspace");
const packageJson = require("../package.json");

const CONFIG_FILE_NAME = "cellmlforge-workspace-manager.json";
const MANIFEST_FILE_NAME = "manifest.xml";

const makeTempWorkspace = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cf-workspace-test-"));
  const workspaceDir = path.join(tempRoot, "workspace-under-test");
  await fs.mkdir(workspaceDir, { recursive: true });

  await fs.writeFile(
    path.join(workspaceDir, MANIFEST_FILE_NAME),
    `<?xml version="1.0" encoding="UTF-8"?>\n<omexManifest xmlns="http://identifiers.org/combine.specifications/omex-manifest" />\n`,
    "utf8"
  );

  await git.init({ fs: fsNode, dir: workspaceDir, defaultBranch: "main" });
  return { tempRoot, workspaceDir };
};

const readConfig = async (workspaceDir) => {
  const configPath = path.join(workspaceDir, CONFIG_FILE_NAME);
  const content = await fs.readFile(configPath, "utf8");
  return JSON.parse(content);
};

test("openWorkspace creates default config when missing", async () => {
  const { tempRoot, workspaceDir } = await makeTempWorkspace();

  try {
    const configPath = path.join(workspaceDir, CONFIG_FILE_NAME);
    await assert.rejects(fs.access(configPath));

    const result = await workspaceService.openWorkspace(workspaceDir);
    assert.equal(result.ok, true, String(result.error || "openWorkspace should succeed"));

    const config = await readConfig(workspaceDir);
    assert.equal(config.schemaVersion, "1.0");
    assert.equal(config.appVersion, packageJson.version);
    assert.equal(config.lastModifiedBy, packageJson.version);
    assert.equal(config.name, path.basename(workspaceDir));
    assert.ok(typeof config.createdAt === "string" && config.createdAt.length > 0);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("updateWorkspaceMetadata bootstraps config when missing", async () => {
  const { tempRoot, workspaceDir } = await makeTempWorkspace();

  try {
    const result = await workspaceService.updateWorkspaceMetadata(workspaceDir, {
      name: "Renamed Workspace",
      description: "Workspace used for migration/bootstrap testing",
    });

    assert.equal(result.ok, true, String(result.error || "updateWorkspaceMetadata should succeed"));
    assert.equal(result.data && result.data.name, "Renamed Workspace");
    assert.equal(
      result.data && result.data.description,
      "Workspace used for migration/bootstrap testing"
    );

    const config = await readConfig(workspaceDir);
    assert.equal(config.name, "Renamed Workspace");
    assert.equal(config.description, "Workspace used for migration/bootstrap testing");
    assert.equal(config.schemaVersion, "1.0");
    assert.equal(config.appVersion, packageJson.version);
    assert.equal(config.lastModifiedBy, packageJson.version);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
