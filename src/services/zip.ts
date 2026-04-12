/**
 * Zip file handling: rebuild archive, generate base64
 */
import { createHash } from "crypto";
import { promises as fs } from "fs";
import * as path from "path";
import JSZip from "jszip";
import { ZipArtifact, Base64Artifact, ManifestBuildMetadata, OperationResult } from "../domain/models";
import { manifestService } from "./manifest";

const addDirectoryToZip = async (
  zip: JSZip,
  dirPath: string,
  zipPrefix: string,
  excludeSet: Set<string>
): Promise<void> => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    const archivePath = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;
    const normalizedArchivePath = archivePath.replace(/\\/g, "/").replace(/^\.\//, "");

    if (
      excludeSet.has(entry.name) ||
      excludeSet.has(normalizedArchivePath) ||
      excludeSet.has(`./${normalizedArchivePath}`) ||
      Array.from(excludeSet).some(
        (excludedPath) =>
          excludedPath.endsWith("/") &&
          (normalizedArchivePath === excludedPath.slice(0, -1) || normalizedArchivePath.startsWith(excludedPath))
      )
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, absolutePath, archivePath, excludeSet);
    } else {
      const content = await fs.readFile(absolutePath);
      zip.file(archivePath, content);
    }
  }
};

const getZipBase64 = async (zipPath: string): Promise<string> => {
  const resolvedZipPath = path.resolve(zipPath);
  const zipBuffer = await fs.readFile(resolvedZipPath);
  return zipBuffer.toString("base64");
};

export class ZipService {
  /**
   * Rebuild zip archive from working tree
   */
  async buildZip(
    workingDir: string,
    outputPath: string,
    excludePaths?: string[]
  ): Promise<OperationResult<ZipArtifact>> {
    try {
      const resolvedWorkingDir = path.resolve(workingDir);
      const resolvedOutputPath = path.resolve(outputPath);

      const normalizeExclude = (value: string) => value.replace(/\\/g, "/").replace(/^\.\//, "");
      const excludeSet = new Set<string>([
        ".git",
        ".omex-artifacts",
        ...(excludePaths ?? []),
      ].map(normalizeExclude));

      const zip = new JSZip();
      await addDirectoryToZip(zip, resolvedWorkingDir, "", excludeSet);

      await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true });

      const content = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });

      await fs.writeFile(resolvedOutputPath, content);

      const checksum = createHash("sha256").update(content).digest("hex");
      const stats = await fs.stat(resolvedOutputPath);

      return {
        ok: true,
        data: {
          path: resolvedOutputPath,
          size: stats.size,
          checksum,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return { ok: false, error };
    }
  }

  async buildZipFromManifest(
    workingDir: string,
    outputPath: string,
    manifestPath: string,
    metadata?: ManifestBuildMetadata
  ): Promise<OperationResult<ZipArtifact>> {
    try {
      const resolvedWorkingDir = path.resolve(workingDir);
      const resolvedOutputPath = path.resolve(outputPath);
      const resolvedManifestPath = path.resolve(manifestPath);

      const manifestResult = await manifestService.parseManifest(resolvedManifestPath);
      if (!manifestResult.ok || !manifestResult.data) {
        return { ok: false, error: manifestResult.error ?? new Error("Unable to parse experiment manifest.") };
      }

      const manifestEntries = manifestResult.data;
      const manifestXmlResult = manifestService.createManifestXml(manifestEntries, metadata);
      if (!manifestXmlResult.ok || !manifestXmlResult.data) {
        return { ok: false, error: manifestXmlResult.error ?? new Error("Unable to create experiment manifest XML.") };
      }

      const zip = new JSZip();
      zip.file("manifest.xml", manifestXmlResult.data);

      for (const entry of manifestEntries) {
        const normalizedLocation = entry.location.replace(/\\/g, "/").replace(/^\.\//, "");
        if (!normalizedLocation || normalizedLocation === "." || normalizedLocation === "manifest.xml") {
          continue;
        }

        const absolutePath = path.join(resolvedWorkingDir, normalizedLocation);
        const stats = await fs.stat(absolutePath);
        if (stats.isDirectory()) {
          continue;
        }

        const content = await fs.readFile(absolutePath);
        zip.file(normalizedLocation, content);
      }

      await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true });

      const content = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });

      await fs.writeFile(resolvedOutputPath, content);

      const checksum = createHash("sha256").update(content).digest("hex");
      const stats = await fs.stat(resolvedOutputPath);

      return {
        ok: true,
        data: {
          path: resolvedOutputPath,
          size: stats.size,
          checksum,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Extract zip archive to a directory
   */
  async extractZip(
    zipPath: string,
    outputDir: string
  ): Promise<OperationResult<string[]>> {
    try {
      // TODO: Implementation
      // 1. Extract zip
      // 2. Return list of extracted file paths
      throw new Error("Not implemented");
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Generate base64-encoded version of zip archive
   */
  async generateBase64(
    zipPath: string,
    outputPath: string
  ): Promise<OperationResult<Base64Artifact>> {
    try {
      const resolvedOutputPath = path.resolve(outputPath);
      const base64Content = await getZipBase64(zipPath);

      await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true });
      await fs.writeFile(resolvedOutputPath, base64Content, "utf8");

      return {
        ok: true,
        data: {
          path: resolvedOutputPath,
          content: base64Content,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Get base64 string from zip file (in-memory)
   */
  async getBase64String(zipPath: string): Promise<OperationResult<string>> {
    try {
      const base64Content = await getZipBase64(zipPath);
      return { ok: true, data: base64Content };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Verify zip integrity
   */
  async verifyZip(zipPath: string): Promise<OperationResult<boolean>> {
    try {
      // TODO: Implementation
      // 1. Try to read zip file and list entries
      // 2. Return true if valid, false otherwise
      throw new Error("Not implemented");
    } catch (error) {
      return { ok: false, error };
    }
  }
}

export const zipService = new ZipService();
