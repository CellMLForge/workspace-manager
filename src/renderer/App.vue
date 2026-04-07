<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from "vue";
import type {
  ArchiveProject,
  CommitSuggestion,
  GitChangeSet,
  GitHubSession,
  ManifestEntry,
  PushContext,
  WorkingTreeFile,
} from "@domain/models";

const currentArchive = ref<ArchiveProject | null>(null);
const githubSession = ref<GitHubSession | null>(null);
const loading = ref(false);
const importing = ref(false);
const exporting = ref(false);
const committing = ref(false);
const dragActive = ref(false);
const error = ref<string | null>(null);
const info = ref<string | null>(null);
const archiveName = ref("My Archive");
const workingPath = ref("C:/tmp/omex-archive");
const zipOutputPath = ref("C:/tmp/omex-archive.zip");
const openCorLaunchUrl = ref<string | null>(null);
const files = ref<WorkingTreeFile[]>([]);
const changeSet = ref<GitChangeSet | null>(null);
const commitSuggestion = ref<CommitSuggestion | null>(null);
const commitSummary = ref("");
const commitDescription = ref("");
const syncing = ref(false);
const showRepoNamePrompt = ref(false);
const repoNamePromptValue = ref("");
const repoNamePromptTitle = ref("GitHub repository name");
let resolveRepoNamePrompt: ((value: string | null) => void) | null = null;
const showRepoBrowser = ref(false);
const repoBrowserQuery = ref("");
const repoBrowserOrgFilter = ref("all");
const repoBrowserItems = ref<Array<{ name: string; url: string; description?: string; owner: string }>>([]);
let resolveRepoBrowser: ((value: string | null) => void) | null = null;
const manifestFormatsByPath = ref<Record<string, string>>({});
const manifestExcludedByPath = ref<Record<string, boolean>>({});
const manifestMasterPath = ref<string | null>(null);
const manifestUseCustomTypeByPath = ref<Record<string, boolean>>({});
const manifestCustomTypeByPath = ref<Record<string, string>>({});
const activityLogEntries = ref<Array<{ id: number; kind: "info" | "error"; message: string; time: string }>>([]);
const logPanelBody = ref<HTMLElement | null>(null);
let nextLogEntryId = 1;

const OPENCOR_DATA_URI_PREFIX =
  "https://opencor.ws/app/?opencor://openFile/#data:application/zip;base64,";

// Extend this list with additional COMBINE specs or project-specific types.
const MANIFEST_FORMAT_CATALOG: Array<{ label: string; value: string }> = [
  { label: "CellML", value: "http://identifiers.org/combine.specifications/cellml" },
  { label: "SED-ML", value: "http://identifiers.org/combine.specifications/sed-ml" },
  { label: "JSON (media type)", value: "http://purl.org/NET/mediatypes/application/json" },
  { label: "PDF (media type)", value: "http://purl.org/NET/mediatypes/application/pdf" },
  { label: "Plain text (media type)", value: "http://purl.org/NET/mediatypes/text/plain" },
  { label: "CSV (media type)", value: "http://purl.org/NET/mediatypes/text/csv" },
  { label: "PNG (media type)", value: "http://purl.org/NET/mediatypes/image/png" },
  { label: "JPEG (media type)", value: "http://purl.org/NET/mediatypes/image/jpeg" },
  { label: "SVG (media type)", value: "http://purl.org/NET/mediatypes/image/svg+xml" },
  { label: "XML (media type)", value: "http://purl.org/NET/mediatypes/application/xml" },
];

const DEFAULT_FORMAT_BY_FILE_NAME: Record<string, string> = {
  "simulation.json": "http://purl.org/NET/mediatypes/application/json",
};

const DEFAULT_FORMAT_BY_EXTENSION: Record<string, string> = {
  ".cellml": "http://identifiers.org/combine.specifications/cellml",
  ".sedml": "http://identifiers.org/combine.specifications/sed-ml",
  ".json": "http://purl.org/NET/mediatypes/application/json",
  ".pdf": "http://purl.org/NET/mediatypes/application/pdf",
  ".txt": "http://purl.org/NET/mediatypes/text/plain",
  ".csv": "http://purl.org/NET/mediatypes/text/csv",
  ".png": "http://purl.org/NET/mediatypes/image/png",
  ".jpg": "http://purl.org/NET/mediatypes/image/jpeg",
  ".jpeg": "http://purl.org/NET/mediatypes/image/jpeg",
  ".svg": "http://purl.org/NET/mediatypes/image/svg+xml",
  ".xml": "http://purl.org/NET/mediatypes/application/xml",
};

const KNOWN_MANIFEST_FORMAT_VALUES = new Set<string>(
  MANIFEST_FORMAT_CATALOG.map((entry) => entry.value)
);
const CUSTOM_TYPE_SENTINEL = "__custom__";

const trimDisplayUrl = (url: string | null, maxLength = 128) => {
  if (!url) {
    return "";
  }

  if (url.length <= maxLength) {
    return url;
  }

  return `${url.slice(0, maxLength - 3)}...`;
};

const appendActivityLog = (kind: "info" | "error", message: string) => {
  activityLogEntries.value.push({
    id: nextLogEntryId++,
    kind,
    message,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  });

  if (activityLogEntries.value.length > 250) {
    activityLogEntries.value.splice(0, activityLogEntries.value.length - 250);
  }

  nextTick(() => {
    if (logPanelBody.value) {
      logPanelBody.value.scrollTop = logPanelBody.value.scrollHeight;
    }
  });
};

watch(error, (nextError) => {
  if (nextError) {
    appendActivityLog("error", nextError);
  }
});

watch(info, (nextInfo) => {
  if (nextInfo) {
    appendActivityLog("info", nextInfo);
  }
});

const buildCommitMessage = () => {
  const summary = commitSummary.value.trim();
  const description = commitDescription.value.trim();

  if (!summary) {
    return "";
  }

  return description ? `${summary}\n\n${description}` : summary;
};

const promptForRepoName = (defaultValue: string): Promise<string | null> => {
  repoNamePromptValue.value = defaultValue;
  repoNamePromptTitle.value = "GitHub repository name";
  showRepoNamePrompt.value = true;

  return new Promise((resolve) => {
    resolveRepoNamePrompt = resolve;
  });
};

const normalizeRepoOwner = (fullName: string) => {
  const slashIndex = fullName.indexOf("/");
  if (slashIndex <= 0) {
    return "personal";
  }

  return fullName.slice(0, slashIndex).toLowerCase();
};

const openRepoBrowser = (
  repositories: Array<{ name: string; url: string; description?: string }>
): Promise<string | null> => {
  repoBrowserItems.value = repositories.map((repo) => ({
    ...repo,
    owner: normalizeRepoOwner(repo.name),
  }));
  repoBrowserQuery.value = "";
  repoBrowserOrgFilter.value = "all";
  showRepoBrowser.value = true;

  return new Promise((resolve) => {
    resolveRepoBrowser = resolve;
  });
};

const filteredRepoBrowserItems = () => {
  const query = repoBrowserQuery.value.trim().toLowerCase();

  return repoBrowserItems.value.filter((repo) => {
    if (repoBrowserOrgFilter.value !== "all" && repo.owner !== repoBrowserOrgFilter.value) {
      return false;
    }

    if (!query) {
      return true;
    }

    return (
      repo.name.toLowerCase().includes(query) ||
      (repo.description?.toLowerCase().includes(query) ?? false)
    );
  });
};

const repoBrowserOrgOptions = () => {
  const owners = Array.from(new Set(repoBrowserItems.value.map((repo) => repo.owner))).sort();
  return ["all", ...owners];
};

const groupedRepoBrowserItems = () => {
  const grouped: Record<string, Array<{ name: string; url: string; description?: string; owner: string }>> = {};

  for (const repo of filteredRepoBrowserItems()) {
    grouped[repo.owner] = grouped[repo.owner] ?? [];
    grouped[repo.owner].push(repo);
  }

  return Object.entries(grouped)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([owner, repos]) => ({
      owner,
      repos: repos.sort((left, right) => left.name.localeCompare(right.name)),
    }));
};

const chooseRepoFromBrowser = (repoUrl: string) => {
  showRepoBrowser.value = false;
  const resolver = resolveRepoBrowser;
  resolveRepoBrowser = null;
  resolver?.(repoUrl);
};

const cancelRepoBrowser = () => {
  showRepoBrowser.value = false;
  const resolver = resolveRepoBrowser;
  resolveRepoBrowser = null;
  resolver?.(null);
};

const submitRepoNamePrompt = () => {
  const value = repoNamePromptValue.value.trim();
  showRepoNamePrompt.value = false;
  const resolver = resolveRepoNamePrompt;
  resolveRepoNamePrompt = null;
  resolver?.(value || null);
};

const cancelRepoNamePrompt = () => {
  showRepoNamePrompt.value = false;
  const resolver = resolveRepoNamePrompt;
  resolveRepoNamePrompt = null;
  resolver?.(null);
};

const chooseGitHubRepoUrl = async (session: GitHubSession): Promise<string | null> => {
  if (!window.api?.github?.listRepositories) {
    error.value = "GitHub repository API not available";
    return null;
  }

  const result = await window.api.github.listRepositories(toRaw(session)!);
  if (!result.ok || !result.data || result.data.length === 0) {
    error.value = String(result.error ?? "No repositories available");
    return null;
  }

  return openRepoBrowser(result.data);
};

const summarizeChanges = (changes: GitChangeSet) => {
  const added = changes.added.length;
  const modified = changes.modified.length;
  const deleted = changes.deleted.length;
  return `Added ${added}, Modified ${modified}, Deleted ${deleted}`;
};

const extensionFromPath = (relativePath: string) => {
  const lower = relativePath.toLowerCase();
  const extensionIndex = lower.lastIndexOf(".");
  if (extensionIndex < 0) {
    return "";
  }

  return lower.slice(extensionIndex);
};

const fileNameFromPath = (value: string) => {
  const normalized = value.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
};

const defaultManifestFormatForPath = (relativePath: string) => {
  const lower = relativePath.toLowerCase();
  const baseName = lower.split("/").pop() ?? lower;

  const byName = DEFAULT_FORMAT_BY_FILE_NAME[baseName];
  if (byName) {
    return byName;
  }

  const byExtension = DEFAULT_FORMAT_BY_EXTENSION[extensionFromPath(lower)];
  if (byExtension) {
    return byExtension;
  }

  return "http://purl.org/NET/mediatypes/application/octet-stream";
};

const isFileExcludedFromManifest = (file: WorkingTreeFile) => {
  if (file.isDirectory) {
    return true;
  }

  const lowerPath = file.path.toLowerCase();
  if (lowerPath === "manifest.xml") {
    return false;
  }

  return manifestExcludedByPath.value[file.path] ?? false;
};

const isMasterForFile = (filePath: string) => manifestMasterPath.value === filePath;

const manifestFormatForFile = (file: WorkingTreeFile) => {
  if (file.path.toLowerCase() === "manifest.xml") {
    return "http://identifiers.org/combine.specifications/omex-manifest";
  }

  if (manifestUseCustomTypeByPath.value[file.path]) {
    const customValue = manifestCustomTypeByPath.value[file.path]?.trim();
    if (customValue) {
      return customValue;
    }
  }

  return manifestFormatsByPath.value[file.path] ?? defaultManifestFormatForPath(file.path);
};

const selectorValueForFile = (file: WorkingTreeFile) => {
  const format = manifestFormatForFile(file);
  return KNOWN_MANIFEST_FORMAT_VALUES.has(format) ? format : CUSTOM_TYPE_SENTINEL;
};

const syncManifestEditorState = (workingTreeFiles: WorkingTreeFile[]) => {
  const nextFormats: Record<string, string> = {};
  const nextExcluded: Record<string, boolean> = {};
  const nextUseCustom: Record<string, boolean> = {};
  const nextCustom: Record<string, string> = {};
  let masterStillExists = false;

  for (const file of workingTreeFiles) {
    if (file.isDirectory) {
      continue;
    }

    const existingFormat = manifestFormatsByPath.value[file.path] ?? defaultManifestFormatForPath(file.path);
    nextFormats[file.path] = existingFormat;
    nextExcluded[file.path] = manifestExcludedByPath.value[file.path] ?? false;

    const existingCustom = manifestCustomTypeByPath.value[file.path] ?? "";
    const hasKnownFormat = KNOWN_MANIFEST_FORMAT_VALUES.has(existingFormat);
    const shouldUseCustom = manifestUseCustomTypeByPath.value[file.path] ?? (!hasKnownFormat && !!existingFormat);

    nextUseCustom[file.path] = shouldUseCustom;
    nextCustom[file.path] = existingCustom || (shouldUseCustom ? existingFormat : "");

    if (manifestMasterPath.value === file.path) {
      masterStillExists = true;
    }
  }

  manifestFormatsByPath.value = nextFormats;
  manifestExcludedByPath.value = nextExcluded;
  manifestUseCustomTypeByPath.value = nextUseCustom;
  manifestCustomTypeByPath.value = nextCustom;

  if (!masterStillExists) {
    const firstSedml = workingTreeFiles.find(
      (file) =>
        !file.isDirectory &&
        extensionFromPath(file.path) === ".sedml" &&
        !(nextExcluded[file.path] ?? false)
    );

    manifestMasterPath.value = firstSedml?.path ?? null;
  }
};

const applyManifestSelections = async () => {
  if (!currentArchive.value || !window.api?.manifest?.generate) {
    error.value = "Manifest API not available";
    return;
  }

  const entries: ManifestEntry[] = files.value
    .filter((file) => !file.isDirectory)
    .filter((file) => !isFileExcludedFromManifest(file))
    .map((file) => ({
      location: `./${file.path}`,
      format: manifestFormatForFile(file),
      master: isMasterForFile(file.path),
    }));

  const result = await window.api.manifest.generate(currentArchive.value.manifestPath, entries);
  if (!result.ok) {
    error.value = String(result.error ?? "Failed to update manifest.xml");
    return;
  }

  info.value = "Manifest updated from file type selections.";
};

const onManifestFormatChanged = async (filePath: string, nextValue: string) => {
  if (nextValue === CUSTOM_TYPE_SENTINEL) {
    manifestUseCustomTypeByPath.value[filePath] = true;
    manifestCustomTypeByPath.value[filePath] = manifestCustomTypeByPath.value[filePath] || "";
    await applyManifestSelections();
    return;
  }

  manifestUseCustomTypeByPath.value[filePath] = false;
  manifestFormatsByPath.value[filePath] = nextValue;
  await applyManifestSelections();
};

const onManifestCustomTypeChanged = (filePath: string, nextValue: string) => {
  manifestUseCustomTypeByPath.value[filePath] = true;
  manifestCustomTypeByPath.value[filePath] = nextValue;
};

const onManifestCustomTypeCommitted = async (filePath: string) => {
  const customValue = manifestCustomTypeByPath.value[filePath]?.trim();
  if (!customValue) {
    error.value = "Custom type cannot be empty when custom mode is selected.";
    return;
  }

  manifestFormatsByPath.value[filePath] = customValue;
  await applyManifestSelections();
};

const onManifestExcludeChanged = async (filePath: string, excluded: boolean) => {
  manifestExcludedByPath.value[filePath] = excluded;

  if (excluded && manifestMasterPath.value === filePath) {
    manifestMasterPath.value = null;
  }

  await applyManifestSelections();
};

const onManifestMasterChanged = async (filePath: string) => {
  manifestMasterPath.value = filePath;
  await applyManifestSelections();
};

const refreshFiles = async () => {
  if (!currentArchive.value || !window.api?.archive?.listFiles) {
    return;
  }

  const result = await window.api.archive.listFiles(toRaw(currentArchive.value)!);
  if (result.ok) {
    files.value = result.data ?? [];
    syncManifestEditorState(files.value);
    return;
  }

  error.value = String(result.error ?? "Unable to list archive files");
};

const refreshGitInsights = async () => {
  if (!currentArchive.value || !window.api?.git?.detectChanges) {
    return;
  }

  const changeResult = await window.api.git.detectChanges(toRaw(currentArchive.value)!);
  if (!changeResult.ok || !changeResult.data) {
    return;
  }

  changeSet.value = changeResult.data;

  if (!window.api.git.suggestCommitMessage) {
    return;
  }

  const suggestionResult = await window.api.git.suggestCommitMessage(changeResult.data);
  if (suggestionResult.ok && suggestionResult.data) {
    commitSuggestion.value = suggestionResult.data;

    if (!commitSummary.value.trim()) {
      commitSummary.value = suggestionResult.data.defaultMessage;
    }

    if (!commitDescription.value.trim()) {
      commitDescription.value = "Reason:\n- <enter context here>\n\nImpact:\n- <enter expected effect here>";
    }
  }
};

const handleCommitChanges = async () => {
  if (!currentArchive.value || !window.api?.git?.commit) {
    error.value = "Git commit API not available";
    return;
  }

  const summary = commitSummary.value.trim();
  if (!summary) {
    error.value = "Please provide a short commit summary.";
    return;
  }

  if (summary.length > 72) {
    error.value = "Commit summary should be 72 characters or fewer.";
    return;
  }

  const message = buildCommitMessage();
  committing.value = true;
  error.value = null;

  try {
    const result = await window.api.git.commit(toRaw(currentArchive.value)!, message);
    if (!result.ok) {
      error.value = String(result.error ?? "Commit failed");
      return;
    }

    info.value = `Committed changes (${result.data?.slice(0, 7) ?? "unknown"}).`;
    commitDescription.value = "";
    await refreshFiles();
    await refreshGitInsights();
  } catch (caughtError) {
    error.value = caughtError instanceof Error ? caughtError.message : "Unexpected commit error";
  } finally {
    committing.value = false;
  }
};

const handleSyncToGitHub = async () => {
  if (!githubSession.value) {
    error.value = "Sign in to GitHub before syncing.";
    return;
  }

  if (!currentArchive.value || !window.api?.github?.push) {
    error.value = "GitHub push API not available";
    return;
  }

  syncing.value = true;
  error.value = null;

  try {
    let repoUrl = currentArchive.value.gitRepoUrl ?? "";
    if (!repoUrl) {
      const selectedRepoUrl = await chooseGitHubRepoUrl(githubSession.value);
      if (!selectedRepoUrl) {
        info.value = "Sync cancelled.";
        return;
      }

      repoUrl = selectedRepoUrl;

      currentArchive.value = {
        ...currentArchive.value,
        gitRepoUrl: repoUrl,
      };
    }

    const pushContext: PushContext = {
      repoUrl,
      branch: currentArchive.value.gitBranch || "main",
      isNewRepo: false,
    };

    const result = await window.api.github.push(
      toRaw(githubSession.value)!,
      currentArchive.value.workingDir,
      pushContext
    );

    if (!result.ok) {
      error.value = String(result.error ?? "GitHub sync failed");
      return;
    }

    info.value = result.data?.message ?? "Synced to GitHub successfully.";
  } catch (caughtError) {
    error.value = caughtError instanceof Error ? caughtError.message : "Unexpected GitHub sync error";
  } finally {
    syncing.value = false;
  }
};

const bootstrapArchiveContext = async (archive: ArchiveProject) => {
  currentArchive.value = archive;
  workingPath.value = archive.workingDir;
  zipOutputPath.value = archive.zipPath;
  openCorLaunchUrl.value = null;
  info.value = `Archive loaded at ${archive.workingDir}`;
  await refreshFiles();
  await refreshGitInsights();
};

const handleCreateArchive = async (name: string) => {
  if (!window.api?.archive?.create) {
    error.value = "API not available";
    return;
  }

  loading.value = true;
  error.value = null;
  info.value = null;

  try {
    const workingDir = workingPath.value.trim();
    if (!workingDir) {
      error.value = "Please provide a working directory path.";
      return;
    }

    const result = await window.api.archive.create(name, workingDir);

    if (result.ok && result.data) {
      await bootstrapArchiveContext(result.data);
      return;
    }

    error.value = String(result.error ?? "Failed to create archive");
  } catch (caughtError) {
    error.value = caughtError instanceof Error ? caughtError.message : "Unknown error";
  } finally {
    loading.value = false;
  }
};

const handleOpenArchive = async () => {
  if (!window.api?.archive?.open) {
    error.value = "Archive open API not available";
    return;
  }

  loading.value = true;
  error.value = null;
  info.value = null;

  try {
    const targetPath = workingPath.value.trim();
    if (!targetPath) {
      error.value = "Please provide a directory to open.";
      return;
    }

    const result = await window.api.archive.open(targetPath);
    if (result.ok && result.data) {
      await bootstrapArchiveContext(result.data);
      return;
    }

    error.value = String(result.error ?? "Failed to open archive");
  } catch (caughtError) {
    error.value = caughtError instanceof Error ? caughtError.message : "Unknown error";
  } finally {
    loading.value = false;
  }
};

const importFiles = async (sourcePaths: string[]) => {
  if (!currentArchive.value || !window.api?.archive?.importFiles) {
    error.value = "Import API not available";
    return;
  }

  if (sourcePaths.length === 0) {
    info.value = "No files were detected in the drop action.";
    return;
  }

  importing.value = true;
  error.value = null;
  info.value = null;

  try {
    const existingRootNames = new Set(
      files.value
        .map((file) => file.path.split("/")[0])
        .filter((name) => name.length > 0)
    );

    const collidingSourceNames = Array.from(
      new Set(
        sourcePaths
          .map((sourcePath) => fileNameFromPath(sourcePath.trim()))
          .filter((name) => existingRootNames.has(name))
      )
    );

    let overwriteExisting = false;
    if (collidingSourceNames.length > 0) {
      if (window.api?.ui?.confirmImportOverwrite) {
        overwriteExisting = await window.api.ui.confirmImportOverwrite(collidingSourceNames);
      } else {
        const collisionSummary = collidingSourceNames.slice(0, 5).join(", ");
        const hasMore = collidingSourceNames.length > 5 ? ` and ${collidingSourceNames.length - 5} more` : "";
        overwriteExisting = window.confirm(
          `The following item(s) already exist in the workspace: ${collisionSummary}${hasMore}. Overwrite existing files/folders?`
        );
      }

      if (!overwriteExisting) {
        info.value = "Import cancelled. Existing files were not overwritten.";
        return;
      }
    }

    const result = await window.api.archive.importFiles(
      toRaw(currentArchive.value)!,
      sourcePaths,
      overwriteExisting
    );
    if (!result.ok) {
      error.value = String(result.error ?? "Failed to import files");
      return;
    }

    const importedCount = (result.data ?? []).length;
    info.value = `Imported ${importedCount} file(s) into the working tree.`;
    await refreshFiles();
    await refreshGitInsights();
  } catch (caughtError) {
    error.value = caughtError instanceof Error ? caughtError.message : "Unexpected import error";
  } finally {
    importing.value = false;
  }
};

const parseDroppedUriPath = (rawValue: string): string | null => {
  const value = rawValue.trim();
  if (!value) {
    return null;
  }

  if (value.startsWith("file://")) {
    try {
      const url = new URL(value);
      let pathname = decodeURIComponent(url.pathname);

      // Normalize Windows drive paths from file:///C:/...
      if (/^\/[A-Za-z]:\//.test(pathname)) {
        pathname = pathname.slice(1);
      }

      return pathname;
    } catch {
      return null;
    }
  }

  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/")) {
    return value;
  }

  return null;
};

const collectDroppedSourcePaths = (event: DragEvent): string[] => {
  const paths = new Set<string>();

  const transferFiles = Array.from(event.dataTransfer?.files ?? []);
  for (const file of transferFiles) {
    // webUtils.getPathForFile is the Electron 32+ way to get a dropped file's OS path.
    // Fall back to the legacy file.path property for older environments.
    const absolutePath =
      window.api?.ui?.getPathForFile?.(file) ||
      (file as File & { path?: string }).path;
    if (absolutePath) {
      paths.add(absolutePath);
    }
  }

  // Fallback for environments where File.path is unavailable.
  if (paths.size === 0) {
    const uriList = event.dataTransfer?.getData("text/uri-list") ?? "";
    for (const line of uriList.split(/\r?\n/)) {
      if (line.startsWith("#")) {
        continue;
      }

      const parsedPath = parseDroppedUriPath(line);
      if (parsedPath) {
        paths.add(parsedPath);
      }
    }

    const plainText = event.dataTransfer?.getData("text/plain") ?? "";
    for (const line of plainText.split(/\r?\n/)) {
      const parsedPath = parseDroppedUriPath(line);
      if (parsedPath) {
        paths.add(parsedPath);
      }
    }
  }

  return Array.from(paths);
};

const onDrop = async (event: DragEvent) => {
  event.preventDefault();
  dragActive.value = false;

  const sourcePaths = collectDroppedSourcePaths(event);
  if (sourcePaths.length === 0) {
    const types = Array.from(event.dataTransfer?.types ?? []);
    const uriList = event.dataTransfer?.getData("text/uri-list") ?? "";
    const plainText = event.dataTransfer?.getData("text/plain") ?? "";
    info.value = [
      "No files were detected in the drop action.",
      `Drop types: ${types.join(", ") || "(none)"}.`,
      `URI payload length: ${uriList.length}.`,
      `Plain-text payload length: ${plainText.length}.`,
    ].join(" ");
    return;
  }

  await importFiles(sourcePaths);
};

const onDragOver = (event: DragEvent) => {
  event.preventDefault();
  dragActive.value = true;
};

const onDragLeave = () => {
  dragActive.value = false;
};

const pickWorkingDirectory = async () => {
  if (!window.api?.ui?.pickDirectory) {
    error.value = "Native folder picker API not available";
    return;
  }

  const selectedPath = await window.api.ui.pickDirectory(workingPath.value);
  if (selectedPath) {
    workingPath.value = selectedPath;
  }
};

const pickOpenDirectory = async () => {
  if (!window.api?.ui?.pickDirectory) {
    error.value = "Native folder picker API not available";
    return;
  }

  const selectedPath = await window.api.ui.pickDirectory(workingPath.value);
  if (selectedPath) {
    workingPath.value = selectedPath;
  }
};

const pickImportSources = async () => {
  if (!currentArchive.value) {
    error.value = "Load or create an archive before importing files.";
    return;
  }

  if (!window.api?.ui?.pickImportPaths) {
    const availableUiMethods = Object.keys(window.api?.ui ?? {}).join(", ") || "none";
    error.value = `Native import picker API not available. ui methods: ${availableUiMethods}`;
    return;
  }

  const sourcePaths = await window.api.ui.pickImportPaths(currentArchive.value.workingDir);
  await importFiles(sourcePaths);
};

const pickImportDirectory = async () => {
  if (!currentArchive.value) {
    error.value = "Load or create an archive before importing files.";
    return;
  }

  if (!window.api?.ui?.pickImportDirectory) {
    const availableUiMethods = Object.keys(window.api?.ui ?? {}).join(", ") || "none";
    error.value = `Native folder picker API not available. ui methods: ${availableUiMethods}`;
    return;
  }

  const sourcePath = await window.api.ui.pickImportDirectory(currentArchive.value.workingDir);
  if (!sourcePath) {
    return;
  }

  await importFiles([sourcePath]);
};

const pickZipOutputPath = async () => {
  if (!window.api?.ui?.pickSaveZipPath) {
    error.value = "Native save dialog API not available";
    return;
  }

  const selectedPath = await window.api.ui.pickSaveZipPath(zipOutputPath.value);
  if (selectedPath) {
    zipOutputPath.value = selectedPath;
  }
};

const handleExportZip = async () => {
  if (!currentArchive.value) {
    error.value = "Load or create an archive before exporting.";
    return;
  }

  if (!window.api?.zip?.build) {
    error.value = "ZIP export API not available";
    return;
  }

  const targetPath = zipOutputPath.value.trim();
  if (!targetPath) {
    error.value = "Choose a ZIP output path before exporting.";
    return;
  }

  exporting.value = true;
  error.value = null;
  info.value = null;
  openCorLaunchUrl.value = null;

  try {
    const result = await window.api.zip.build(currentArchive.value.workingDir, targetPath, [
      ".git",
      "node_modules",
      "dist",
    ]);

    if (!result.ok) {
      error.value = String(result.error ?? "Failed to build ZIP archive");
      return;
    }

    const builtZipPath = result.data?.path ?? targetPath;
    info.value = `ZIP exported to ${builtZipPath}`;

    if (!window.api?.zip?.getBase64String) {
      return;
    }

    const base64Result = await window.api.zip.getBase64String(builtZipPath);
    if (!base64Result.ok || !base64Result.data) {
      error.value = String(base64Result.error ?? "ZIP was built, but Base64 generation failed");
      return;
    }

    openCorLaunchUrl.value = `${OPENCOR_DATA_URI_PREFIX}${base64Result.data}`;
    info.value = `ZIP exported to ${builtZipPath}. OpenCOR launch link generated.`;
  } catch (caughtError) {
    error.value = caughtError instanceof Error ? caughtError.message : "Unexpected export error";
  } finally {
    exporting.value = false;
  }
};

const handleLaunchOpenCor = async () => {
  if (!openCorLaunchUrl.value) {
    return;
  }

  try {
    if (window.api?.ui?.openExternal) {
      await window.api.ui.openExternal(openCorLaunchUrl.value);
      return;
    }

    window.open(openCorLaunchUrl.value, "_blank", "noopener,noreferrer");
  } catch (caughtError) {
    error.value = caughtError instanceof Error ? caughtError.message : "Unable to open OpenCOR URL";
  }
};

const handleCopyOpenCorUrl = async () => {
  if (!openCorLaunchUrl.value) {
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(openCorLaunchUrl.value);
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = openCorLaunchUrl.value;
      textArea.setAttribute("readonly", "true");
      textArea.style.position = "absolute";
      textArea.style.left = "-9999px";
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }

    info.value = "OpenCOR URL copied to clipboard.";
  } catch (caughtError) {
    error.value = caughtError instanceof Error ? caughtError.message : "Unable to copy OpenCOR URL";
  }
};

const handleMenuNewArchive = async () => {
  await pickWorkingDirectory();
  if (!workingPath.value.trim()) {
    return;
  }

  await handleCreateArchive(archiveName.value || "My Archive");
};

const handleMenuOpenArchive = async () => {
  await pickOpenDirectory();
  if (!workingPath.value.trim()) {
    return;
  }

  await handleOpenArchive();
};

const handleMenuNewArchiveGitHub = async () => {
  if (!githubSession.value) {
    error.value = "Sign in to GitHub before using New from GitHub.";
    return;
  }

  await handleMenuNewArchive();
  if (!currentArchive.value) {
    return;
  }

  const repoName = (currentArchive.value.name || "omex-archive")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "omex-archive";

  const enteredRepoName = await promptForRepoName(repoName);
  if (!enteredRepoName) {
    info.value = "GitHub workspace creation cancelled.";
    return;
  }

  const normalizedRepoName = enteredRepoName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "omex-archive";

  let isPrivate = false;
  if (window.api?.ui?.confirmPrivateRepository) {
    const visibilityChoice = await window.api.ui.confirmPrivateRepository();
    if (visibilityChoice === null) {
      info.value = "GitHub workspace creation cancelled.";
      return;
    }

    isPrivate = visibilityChoice;
  }

  const createResult = await window.api.github.createRepository(
    toRaw(githubSession.value)!,
    normalizedRepoName,
    `Workspace for ${currentArchive.value.name}`,
    isPrivate
  );

  if (!createResult.ok || !createResult.data) {
    error.value = String(createResult.error ?? "Failed to create GitHub repository");
    return;
  }

  currentArchive.value = {
    ...currentArchive.value,
    gitRepoUrl: createResult.data,
  };

  info.value = `Created and linked GitHub repository: ${createResult.data}`;
};

const handleMenuOpenArchiveGitHub = async () => {
  if (!githubSession.value) {
    error.value = "Sign in to GitHub before using Open from GitHub.";
    return;
  }

  const repoUrl = await chooseGitHubRepoUrl(githubSession.value);
  if (!repoUrl) {
    info.value = "Repository linking skipped.";
    return;
  }

  const selectedPath = await window.api.ui.pickDirectory(workingPath.value);
  if (!selectedPath) {
    info.value = "Open from GitHub cancelled.";
    return;
  }

  workingPath.value = selectedPath;

  if (!window.api?.github?.cloneRepository) {
    error.value = "GitHub clone API not available";
    return;
  }

  const cloneResult = await window.api.github.cloneRepository(
    toRaw(githubSession.value)!,
    repoUrl,
    selectedPath
  );

  if (!cloneResult.ok || !cloneResult.data) {
    error.value = String(cloneResult.error ?? "Failed to clone repository");
    return;
  }

  const openResult = await window.api.archive.open(cloneResult.data);
  if (!openResult.ok || !openResult.data) {
    error.value = String(openResult.error ?? "Repository cloned but archive open failed");
    return;
  }

  const linkedArchive: ArchiveProject = {
    ...openResult.data,
    gitRepoUrl: repoUrl,
  };

  await bootstrapArchiveContext(linkedArchive);

  info.value = `Cloned and opened GitHub repository: ${repoUrl}`;
};

const handleGitHubLogin = async () => {
  if (!window.api?.github?.authenticateOAuth) {
    error.value = "GitHub API not available";
    return;
  }

  loading.value = true;
  error.value = null;

  try {
    const result = await window.api.github.authenticateOAuth();

    if (result.ok) {
      githubSession.value = result.data ?? null;
      return;
    }

    error.value = String(result.error ?? "GitHub authentication failed");
  } catch (caughtError) {
    error.value = caughtError instanceof Error ? caughtError.message : "Unknown error";
  } finally {
    loading.value = false;
  }
};

const handleGitHubLogout = async () => {
  if (!window.api?.github?.logout) {
    error.value = "GitHub API not available";
    return;
  }

  loading.value = true;

  try {
    await window.api.github.logout();
    githubSession.value = null;
  } catch (caughtError) {
    error.value = caughtError instanceof Error ? caughtError.message : "Logout failed";
  } finally {
    loading.value = false;
  }
};

let detachMenuNew: (() => void) | undefined;
let detachMenuOpen: (() => void) | undefined;
let detachMenuNewGitHub: (() => void) | undefined;
let detachMenuOpenGitHub: (() => void) | undefined;

onMounted(async () => {
  detachMenuNew = window.api?.events?.onMenuNewArchive?.(handleMenuNewArchive);
  detachMenuOpen = window.api?.events?.onMenuOpenArchive?.(handleMenuOpenArchive);
  detachMenuNewGitHub = window.api?.events?.onMenuNewArchiveGitHub?.(handleMenuNewArchiveGitHub);
  detachMenuOpenGitHub = window.api?.events?.onMenuOpenArchiveGitHub?.(handleMenuOpenArchiveGitHub);

  if (!window.api?.github?.restoreSession) {
    return;
  }

  try {
    const result = await window.api.github.restoreSession();
    if (result.ok && result.data) {
      githubSession.value = result.data;
    }
  } catch (caughtError) {
    console.error("Failed to restore GitHub session", caughtError);
  }
});

onBeforeUnmount(() => {
  if (resolveRepoNamePrompt) {
    resolveRepoNamePrompt(null);
    resolveRepoNamePrompt = null;
  }

  if (resolveRepoBrowser) {
    resolveRepoBrowser(null);
    resolveRepoBrowser = null;
  }

  detachMenuNew?.();
  detachMenuOpen?.();
  detachMenuNewGitHub?.();
  detachMenuOpenGitHub?.();
});
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Desktop-first OMEX workflow</p>
        <h1>OMEX Archive Manager</h1>
        <p v-if="currentArchive" class="project-name">{{ currentArchive.name }}</p>
      </div>

      <div class="account-panel">
        <template v-if="githubSession">
          <div class="account-chip">
            <PAvatar :image="githubSession.avatarUrl" shape="circle" />
            <span>{{ githubSession.username }}</span>
          </div>
          <PButton label="Logout" severity="secondary" :disabled="loading" @click="handleGitHubLogout" />
        </template>
        <PButton
          v-else
          label="Sign in with GitHub"
          icon="pi pi-github"
          :loading="loading"
          @click="handleGitHubLogin"
        />
      </div>
    </header>

    <main class="content-grid">
      <div v-if="showRepoNamePrompt" class="modal-backdrop" @click="cancelRepoNamePrompt">
        <div class="modal-panel" @click.stop>
          <h3 class="modal-title">{{ repoNamePromptTitle }}</h3>
          <input
            v-model="repoNamePromptValue"
            class="field-input"
            type="text"
            placeholder="owner-repo-name"
            @keydown.enter.prevent="submitRepoNamePrompt"
          />
          <div class="hero-actions">
            <PButton label="Cancel" severity="secondary" @click="cancelRepoNamePrompt" />
            <PButton label="Continue" @click="submitRepoNamePrompt" />
          </div>
        </div>
      </div>

      <div v-if="showRepoBrowser" class="modal-backdrop" @click="cancelRepoBrowser">
        <div class="modal-panel modal-panel--wide" @click.stop>
          <h3 class="modal-title">Choose a GitHub repository</h3>
          <div class="repo-browser-toolbar">
            <input
              v-model="repoBrowserQuery"
              class="field-input"
              type="text"
              placeholder="Search by repository name or description"
            />
            <select v-model="repoBrowserOrgFilter" class="manifest-type-select">
              <option v-for="owner in repoBrowserOrgOptions()" :key="owner" :value="owner">
                {{ owner === "all" ? "All owners" : owner }}
              </option>
            </select>
          </div>

          <div class="repo-browser-list">
            <div v-if="groupedRepoBrowserItems().length === 0" class="empty-state">
              No repositories match your filters.
            </div>

            <section v-for="group in groupedRepoBrowserItems()" :key="group.owner" class="repo-group">
              <h4 class="repo-group-title">{{ group.owner }}</h4>
              <button
                v-for="repo in group.repos"
                :key="repo.url"
                type="button"
                class="repo-choice"
                @click="chooseRepoFromBrowser(repo.url)"
              >
                <span class="repo-choice-name">{{ repo.name }}</span>
                <span v-if="repo.description" class="repo-choice-description">{{ repo.description }}</span>
              </button>
            </section>
          </div>

          <div class="hero-actions">
            <PButton label="Cancel" severity="secondary" @click="cancelRepoBrowser" />
          </div>
        </div>
      </div>

      <section class="hero-card">
        <PCard>
          <template #title>Archive overview</template>
          <template #content>
            <p class="menu-hint">Use the File menu to create a new archive or open an existing one.</p>
            <div class="field-grid">
              <label class="field-label" for="archiveName">Archive name</label>
              <input id="archiveName" v-model="archiveName" class="field-input" type="text" />

              <label class="field-label" for="workingPath">Workspace location</label>
              <input
                id="workingPath"
                v-model="workingPath"
                class="field-input field-input--readonly"
                type="text"
                readonly
              />
            </div>

            <ul class="status-list">
              <li>
                <strong>Archive state:</strong>
                {{ currentArchive ? currentArchive.state : "Not loaded" }}
              </li>
              <li>
                <strong>GitHub session:</strong>
                {{ githubSession ? "Connected" : "Not connected" }}
              </li>
              <li v-if="currentArchive?.gitRepoUrl">
                <strong>Linked repository:</strong>
                {{ currentArchive.gitRepoUrl }}
              </li>
              <li v-if="changeSet">
                <strong>Pending changes:</strong>
                {{ summarizeChanges(changeSet) }}
              </li>
            </ul>

            <div class="hero-actions">
              <PButton label="Refresh files" text :disabled="!currentArchive || loading" @click="refreshFiles" />
              <PButton label="Refresh git insights" text :disabled="!currentArchive" @click="refreshGitInsights" />
            </div>
          </template>
        </PCard>
      </section>

      <section class="dropzone-panel">
        <PCard>
          <template #title>Import files</template>
          <template #content>
            <div
              class="dropzone"
              :class="{ active: dragActive, disabled: !currentArchive }"
              @drop="onDrop"
              @dragover="onDragOver"
              @dragleave="onDragLeave"
            >
              <p class="dropzone-title">Drag files or folders from your desktop</p>
              <p class="dropzone-subtitle">Imported files will be copied into the archive working tree.</p>
              <PButton
                label="Choose files"
                icon="pi pi-upload"
                severity="secondary"
                :disabled="!currentArchive || importing"
                :loading="importing"
                @click="pickImportSources"
              />
              <PButton
                label="Choose folder"
                icon="pi pi-folder-open"
                severity="secondary"
                :disabled="!currentArchive || importing"
                :loading="importing"
                @click="pickImportDirectory"
              />
            </div>
          </template>
        </PCard>
      </section>

      <section class="files-panel">
        <PCard>
          <template #title>Archive files ({{ files.length }})</template>
          <template #content>
            <div v-if="files.length === 0" class="empty-state">
              No files loaded yet.
            </div>
            <ul v-else class="file-list">
              <li class="file-row file-row--header" aria-hidden="true">
                <span class="file-path">Path</span>
                <span class="file-meta">Size</span>
                <span>Type</span>
                <span>Exclude</span>
                <span>Master</span>
              </li>
              <li v-for="file in files" :key="file.path" class="file-row">
                <span class="file-path" :title="file.path">{{ file.path }}</span>
                <span class="file-meta">{{ file.isDirectory ? 'Directory' : `${file.size} bytes` }}</span>
                <div v-if="!file.isDirectory" class="manifest-type-editor">
                  <select
                    class="manifest-type-select"
                    :disabled="isFileExcludedFromManifest(file)"
                    :value="selectorValueForFile(file)"
                    @change="onManifestFormatChanged(file.path, (($event.target as HTMLSelectElement).value))"
                  >
                    <option
                      v-for="entry in MANIFEST_FORMAT_CATALOG"
                      :key="entry.value"
                      :value="entry.value"
                    >
                      {{ entry.label }}
                    </option>
                    <option :value="CUSTOM_TYPE_SENTINEL">Custom...</option>
                  </select>
                  <input
                    v-if="manifestUseCustomTypeByPath[file.path]"
                    class="manifest-custom-type-input"
                    type="text"
                    :disabled="isFileExcludedFromManifest(file)"
                    :value="manifestCustomTypeByPath[file.path]"
                    placeholder="Enter custom format URI"
                    @input="onManifestCustomTypeChanged(file.path, ($event.target as HTMLInputElement).value)"
                    @blur="onManifestCustomTypeCommitted(file.path)"
                    @keydown.enter.prevent="onManifestCustomTypeCommitted(file.path)"
                  />
                </div>
                <span v-else class="manifest-type-placeholder">(not in manifest)</span>
                <label class="manifest-toggle" title="Exclude file from manifest.xml">
                  <input
                    type="checkbox"
                    :disabled="file.isDirectory || file.path.toLowerCase() === 'manifest.xml'"
                    :checked="isFileExcludedFromManifest(file)"
                    @change="onManifestExcludeChanged(file.path, ($event.target as HTMLInputElement).checked)"
                  />
                </label>
                <label class="manifest-toggle" title="Mark as master file">
                  <input
                    type="radio"
                    name="manifest-master-file"
                    :disabled="file.isDirectory || isFileExcludedFromManifest(file)"
                    :checked="isMasterForFile(file.path)"
                    @change="onManifestMasterChanged(file.path)"
                  />
                </label>
              </li>
            </ul>
          </template>
        </PCard>
      </section>

      <section class="artifacts-panel">
        <PCard>
          <template #title>Artifacts</template>
          <template #content>
            <div class="field-grid compact">
              <label class="field-label" for="zipOutputPath">ZIP output path</label>
              <div
                class="input-row input-row--interactive"
                role="button"
                tabindex="0"
                @click="pickZipOutputPath"
                @keydown.enter.prevent="pickZipOutputPath"
                @keydown.space.prevent="pickZipOutputPath"
              >
                <input
                  id="zipOutputPath"
                  v-model="zipOutputPath"
                  class="field-input field-input--readonly"
                  type="text"
                  readonly
                />
                <PButton label="Save As..." severity="secondary" text @click.stop="pickZipOutputPath" />
                <PButton
                  label="Build ZIP"
                  icon="pi pi-file-export"
                  :disabled="!currentArchive || exporting"
                  :loading="exporting"
                  @click.stop="handleExportZip"
                />
              </div>
            </div>

            <div class="field-grid compact">
              <label class="field-label" for="openCorUrl">OpenCOR URL</label>
              <div class="input-row">
                <input
                  id="openCorUrl"
                  :value="trimDisplayUrl(openCorLaunchUrl)"
                  class="field-input field-input--readonly"
                  type="text"
                  readonly
                  placeholder="Build ZIP to generate OpenCOR launch URL"
                />
                <PButton
                  label="Launch"
                  icon="pi pi-external-link"
                  severity="secondary"
                  :disabled="!openCorLaunchUrl"
                  @click="handleLaunchOpenCor"
                />
                <PButton
                  label="Copy"
                  icon="pi pi-copy"
                  severity="secondary"
                  :disabled="!openCorLaunchUrl"
                  @click="handleCopyOpenCorUrl"
                />
              </div>
            </div>
          </template>
        </PCard>
      </section>

      <section class="git-panel">
        <PCard>
          <template #title>Commit assistant</template>
          <template #content>
            <div v-if="!commitSuggestion" class="empty-state">No commit suggestion available yet.</div>
            <div v-else class="suggestion-block">
              <p><strong>Suggested message:</strong> {{ commitSuggestion.defaultMessage }}</p>
              <p><strong>Reasoning:</strong> {{ commitSuggestion.reasoning }}</p>
              <p><strong>Templates:</strong></p>
              <ul class="template-list">
                <li v-for="template in commitSuggestion.templates" :key="template">{{ template }}</li>
              </ul>
            </div>

            <div class="field-grid compact">
              <label class="field-label" for="commitSummary">Commit summary</label>
              <input
                id="commitSummary"
                v-model="commitSummary"
                class="field-input"
                type="text"
                maxlength="72"
                placeholder="Short summary (recommended <= 72 characters)"
              />

              <label class="field-label" for="commitDescription">Commit description</label>
              <textarea
                id="commitDescription"
                v-model="commitDescription"
                class="field-input commit-description"
                rows="5"
                placeholder="Optional details, context, and impact"
              />
            </div>

            <div class="hero-actions">
              <PButton label="Refresh git insights" text :disabled="!currentArchive" @click="refreshGitInsights" />
              <PButton
                label="Commit changes"
                icon="pi pi-check"
                :loading="committing"
                :disabled="!currentArchive || !changeSet || committing"
                @click="handleCommitChanges"
              />
              <PButton
                label="Sync to GitHub"
                icon="pi pi-upload"
                severity="secondary"
                :loading="syncing"
                :disabled="!currentArchive || !githubSession || syncing"
                @click="handleSyncToGitHub"
              />
            </div>
          </template>
        </PCard>
      </section>
    </main>

    <section class="activity-log-panel" aria-live="polite" aria-label="Activity log">
      <div class="activity-log-header">
        <strong>Activity log</strong>
        <span>{{ activityLogEntries.length }} message{{ activityLogEntries.length === 1 ? "" : "s" }}</span>
      </div>
      <div ref="logPanelBody" class="activity-log-body">
        <div v-if="activityLogEntries.length === 0" class="activity-log-empty">
          No messages yet.
        </div>
        <div
          v-for="entry in activityLogEntries"
          :key="entry.id"
          class="activity-log-line"
          :class="{ 'activity-log-line--error': entry.kind === 'error' }"
        >
          <span class="activity-log-time">{{ entry.time }}</span>
          <span class="activity-log-text">{{ entry.message }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.app-shell {
  height: 100vh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  padding: 2rem;
  gap: 1rem;
  overflow: hidden;
  color: #18212f;
  background:
    radial-gradient(circle at top left, rgba(255, 208, 123, 0.28), transparent 35%),
    linear-gradient(180deg, #f7f3e8 0%, #eef5f3 52%, #dde9eb 100%);
}

.topbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1.5rem;
}

.eyebrow {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #8a5b1f;
}

h1 {
  margin: 0;
  font-size: clamp(2rem, 3vw, 3rem);
  line-height: 1;
}

.project-name {
  margin: 0.65rem 0 0;
  font-size: 1rem;
  color: #4b5b70;
}

.account-panel {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.account-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.55rem 0.8rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(8px);
}

.content-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.25rem;
  min-height: 0;
  overflow: auto;
  align-content: start;
  padding-right: 0.2rem;
}

.hero-card,
.dropzone-panel,
.files-panel,
.git-panel {
  min-width: 0;
}

.dropzone-panel,
.files-panel,
.git-panel,
.artifacts-panel {
  grid-column: 1 / -1;
}

.field-grid {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 0.75rem;
  align-items: center;
}

.field-grid.compact {
  margin-bottom: 0.75rem;
}

.menu-hint {
  margin: 0 0 0.9rem;
  color: #4d5f75;
}

.field-label {
  font-weight: 600;
  color: #314359;
}

.field-input {
  width: 100%;
  border: 1px solid #b8c4cf;
  border-radius: 10px;
  padding: 0.6rem 0.75rem;
  font-size: 0.95rem;
  background: rgba(255, 255, 255, 0.8);
}

.field-input--readonly {
  cursor: default;
  color: #465a72;
  background: rgba(245, 248, 250, 0.96);
}

.input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
  align-items: center;
}

.input-row--interactive {
  padding: 0.2rem;
  border-radius: 12px;
  transition: background-color 0.18s ease, box-shadow 0.18s ease;
  cursor: pointer;
}

.input-row--interactive:hover {
  background: rgba(27, 111, 209, 0.08);
}

.input-row--interactive:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(27, 111, 209, 0.22);
}

.dropzone {
  border: 2px dashed #9fb4c7;
  border-radius: 14px;
  padding: 1.2rem;
  background: rgba(255, 255, 255, 0.65);
  display: grid;
  gap: 0.6rem;
  justify-items: start;
}

.dropzone.active {
  border-color: #1b6fd1;
  background: rgba(226, 239, 255, 0.9);
}

.dropzone.disabled {
  opacity: 0.6;
}

.dropzone-title {
  margin: 0;
  font-weight: 700;
}

.dropzone-subtitle {
  margin: 0;
  color: #4d5f75;
}

.empty-state {
  color: #5f6f84;
}

.file-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.35rem;
}

.file-row {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) auto minmax(320px, 1fr) auto auto;
  gap: 0.75rem;
  align-items: center;
  border-bottom: 1px solid rgba(24, 33, 47, 0.12);
  padding: 0.4rem 0;
}

.file-row--header {
  font-weight: 700;
  color: #4d5f75;
  border-bottom: 1px solid rgba(24, 33, 47, 0.24);
}

.file-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  color: #60748c;
  font-size: 0.9rem;
}

.manifest-type-select {
  width: 100%;
  border: 1px solid #b8c4cf;
  border-radius: 10px;
  padding: 0.5rem 0.6rem;
  background: rgba(255, 255, 255, 0.95);
}

.manifest-type-editor {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.35rem;
}

.manifest-custom-type-input {
  width: 100%;
  border: 1px solid #b8c4cf;
  border-radius: 10px;
  padding: 0.5rem 0.6rem;
  background: rgba(255, 255, 255, 0.95);
}

.manifest-type-placeholder {
  color: #7d8da1;
}

.manifest-toggle {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  color: #4d5f75;
  justify-content: center;
}

.commit-description {
  resize: vertical;
  min-height: 6rem;
  font-family: inherit;
}

.suggestion-block p {
  margin: 0.35rem 0;
}

.template-list {
  margin: 0;
  padding-left: 1.1rem;
  display: grid;
  gap: 0.3rem;
}

.hero-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-top: 1.2rem;
}

.status-list {
  display: grid;
  gap: 0.55rem;
  padding: 0;
  margin: 1rem 0 0;
  list-style: none;
}

.status-list strong {
  margin-right: 0.4rem;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: grid;
  place-items: center;
  z-index: 50;
}

.modal-panel {
  width: min(520px, calc(100vw - 2rem));
  background: #ffffff;
  border-radius: 12px;
  padding: 1rem;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
}

.modal-title {
  margin: 0 0 0.75rem;
}

.modal-panel--wide {
  width: min(900px, calc(100vw - 2rem));
}

.repo-browser-toolbar {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.75rem;
  align-items: center;
}

.repo-browser-list {
  margin-top: 1rem;
  max-height: min(52vh, 600px);
  overflow: auto;
  display: grid;
  gap: 1rem;
}

.repo-group {
  display: grid;
  gap: 0.5rem;
}

.repo-group-title {
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 0.8rem;
  color: #4d5f75;
}

.repo-choice {
  width: 100%;
  text-align: left;
  border: 1px solid rgba(77, 95, 117, 0.25);
  border-radius: 10px;
  background: #f8fbff;
  padding: 0.65rem 0.75rem;
  display: grid;
  gap: 0.2rem;
  cursor: pointer;
}

.repo-choice:hover {
  border-color: #285da8;
  background: #eef5ff;
}

.repo-choice-name {
  font-weight: 600;
  color: #1f2d3d;
}

.repo-choice-description {
  color: #4d5f75;
  font-size: 0.9rem;
}

.activity-log-panel {
  border: 1px solid rgba(24, 33, 47, 0.2);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(6px);
  overflow: hidden;
}

.activity-log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.55rem 0.8rem;
  border-bottom: 1px solid rgba(24, 33, 47, 0.12);
  color: #314359;
  font-size: 0.9rem;
}

.activity-log-body {
  max-height: 100px;
  overflow-y: auto;
  padding: 0.45rem 0.8rem 0.65rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 0.85rem;
  line-height: 1.45;
}

.activity-log-empty {
  color: #60748c;
}

.activity-log-line {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.55rem;
  align-items: start;
  color: #2d4158;
  padding: 0.1rem 0;
}

.activity-log-line--error .activity-log-text {
  font-weight: 700;
}

.activity-log-time {
  color: #60748c;
  white-space: nowrap;
}

.activity-log-text {
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 900px) {
  .app-shell {
    padding: 1rem;
    gap: 0.75rem;
  }

  .topbar {
    flex-direction: column;
  }

  .content-grid {
    grid-template-columns: 1fr;
  }

  .field-grid {
    grid-template-columns: 1fr;
  }

  .repo-browser-toolbar {
    grid-template-columns: 1fr;
  }

  .file-row {
    grid-template-columns: 1fr;
  }

  .dropzone-panel,
  .files-panel,
  .git-panel,
  .artifacts-panel {
    grid-column: auto;
  }

  .account-panel {
    justify-content: flex-start;
  }
}
</style>