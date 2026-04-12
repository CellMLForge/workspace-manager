const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const git = require("isomorphic-git");
const fsNode = require("fs");
const JSZip = require("jszip");

const { workspaceService } = require("../dist/services/workspace");
const { zipService } = require("../dist/services/zip");
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

test("clearWorkspaceLibrarySettings clears library path and last opened workspace", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cf-workspace-library-test-"));
  const libraryDir = path.join(tempRoot, "library");
  const workspacePath = path.join(libraryDir, "workspace-a");

  try {
    const setResult = await workspaceService.setWorkspaceLibraryPath(libraryDir);
    assert.equal(setResult.ok, true, String(setResult.error || "setWorkspaceLibraryPath should succeed"));

    const rememberResult = await workspaceService.rememberLastOpenedWorkspace(workspacePath);
    assert.equal(
      rememberResult.ok,
      true,
      String(rememberResult.error || "rememberLastOpenedWorkspace should succeed")
    );

    const beforeClear = await workspaceService.getWorkspaceLibrarySettings();
    assert.equal(beforeClear.ok, true, String(beforeClear.error || "getWorkspaceLibrarySettings should succeed"));
    assert.equal(beforeClear.data && beforeClear.data.libraryPath, path.resolve(libraryDir));
    assert.equal(beforeClear.data && beforeClear.data.lastOpenedWorkspacePath, path.resolve(workspacePath));

    const clearResult = await workspaceService.clearWorkspaceLibrarySettings();
    assert.equal(clearResult.ok, true, String(clearResult.error || "clearWorkspaceLibrarySettings should succeed"));
    assert.equal(clearResult.data && clearResult.data.libraryPath, null);
    assert.equal(clearResult.data && clearResult.data.lastOpenedWorkspacePath, null);

    const afterClear = await workspaceService.getWorkspaceLibrarySettings();
    assert.equal(afterClear.ok, true, String(afterClear.error || "getWorkspaceLibrarySettings should succeed"));
    assert.equal(afterClear.data && afterClear.data.libraryPath, null);
    assert.equal(afterClear.data && afterClear.data.lastOpenedWorkspacePath, null);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await workspaceService.clearWorkspaceLibrarySettings();
  }
});

test("buildZipFromManifest includes only selected files and leaves source manifest unchanged", async () => {
  const { tempRoot, workspaceDir } = await makeTempWorkspace();

  try {
    await fs.writeFile(path.join(workspaceDir, "protocol.sedml"), "<sedML />\n", "utf8");
    await fs.writeFile(path.join(workspaceDir, "model.cellml"), "<model />\n", "utf8");
    await fs.writeFile(path.join(workspaceDir, "notes.txt"), "Do not include me\n", "utf8");

    const openResult = await workspaceService.openWorkspace(workspaceDir);
    assert.equal(openResult.ok, true, String(openResult.error || "openWorkspace should succeed"));
    const workspace = openResult.data;

    const createManifestResult = await workspaceService.createSimulationExperimentManifest(workspace, {
      name: "Example Experiment",
      description: "Build only the model and protocol",
      entries: [
        {
          location: "./protocol.sedml",
          format: "http://identifiers.org/combine.specifications/sed-ml",
          master: true,
        },
        {
          location: "./model.cellml",
          format: "http://identifiers.org/combine.specifications/cellml",
        },
      ],
    });

    assert.equal(
      createManifestResult.ok,
      true,
      String(createManifestResult.error || "createSimulationExperimentManifest should succeed")
    );

    const experiment = createManifestResult.data;
    const sourceManifestBeforeBuild = await fs.readFile(experiment.manifestPath, "utf8");
    const zipPath = path.join(workspaceDir, ".omex-artifacts", "example-experiment.zip");

    const zipResult = await zipService.buildZipFromManifest(
      workspace.workingDir,
      zipPath,
      experiment.manifestPath,
      {
        generatedAt: new Date().toISOString(),
        hasUncommittedChanges: false,
        gitBranch: "main",
        gitRevision: "abc123",
      }
    );

    assert.equal(zipResult.ok, true, String(zipResult.error || "buildZipFromManifest should succeed"));

    const sourceManifestAfterBuild = await fs.readFile(experiment.manifestPath, "utf8");
    assert.equal(sourceManifestAfterBuild, sourceManifestBeforeBuild);
    assert.equal(sourceManifestAfterBuild.includes("cellmlforge:hasUncommittedChanges"), false);

    const zipBuffer = await fs.readFile(zipPath);
    const zip = await JSZip.loadAsync(zipBuffer);
    const zipEntries = Object.keys(zip.files).sort();

    assert.deepEqual(zipEntries, ["manifest.xml", "model.cellml", "protocol.sedml"]);

    const manifestXml = await zip.file("manifest.xml").async("string");
    assert.equal(manifestXml.includes("cellmlforge:hasUncommittedChanges"), true);
    assert.equal(manifestXml.includes("./protocol.sedml"), true);
    assert.equal(manifestXml.includes("./model.cellml"), true);
    assert.equal(manifestXml.includes("./notes.txt"), false);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
