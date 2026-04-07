/**
 * Zip file handling: rebuild archive, generate base64
 */
import { createHash } from "crypto";
import { promises as fs } from "fs";
import * as path from "path";
import JSZip from "jszip";
import { ZipArtifact, Base64Artifact, OperationResult } from "../domain/models";

const addDirectoryToZip = async (
  zip: JSZip,
  dirPath: string,
  zipPrefix: string,
  excludeSet: Set<string>
): Promise<void> => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (excludeSet.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(dirPath, entry.name);
    const archivePath = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;

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

      const excludeSet = new Set<string>([
        ".git",
        ".omex-artifacts",
        ...(excludePaths ?? []),
      ]);

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
