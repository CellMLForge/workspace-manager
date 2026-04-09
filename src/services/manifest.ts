/**
 * OMEX manifest parsing and generation
 */
import { promises as fs } from "fs";
import { create } from "xmlbuilder2";
import {
  ManifestBuildMetadata,
  ManifestEntry,
  OperationResult,
} from "../domain/models";

const MANIFEST_NS = "http://identifiers.org/combine.specifications/omex-manifest";
const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const CELLMLFORGE_NS = "https://cellmlforge.org/ns/workspace#";

const normalizeManifestLocation = (location: string) => {
  const trimmed = location.trim();
  if (!trimmed || trimmed === ".") {
    return ".";
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
  return `./${normalized}`;
};

export class ManifestService {
  /**
   * Parse manifest.xml from archive working tree
   */
  async parseManifest(
    manifestPath: string
  ): Promise<OperationResult<ManifestEntry[]>> {
    try {
      const xml = await fs.readFile(manifestPath, "utf8");
      const matches = Array.from(
        xml.matchAll(/<content\b[^>]*\blocation="([^"]+)"[^>]*\bformat="([^"]+)"[^>]*\/?>(?:<\/content>)?/gi)
      );

      const entries: ManifestEntry[] = matches.map((match) => ({
        location: match[1],
        format: match[2],
      }));

      return { ok: true, data: entries };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Generate or update manifest.xml with entries
   */
  async generateManifest(
    manifestPath: string,
    entries: ManifestEntry[],
    metadata?: ManifestBuildMetadata
  ): Promise<OperationResult<void>> {
    try {
      const seenLocations = new Set<string>();
      const normalizedEntries: ManifestEntry[] = [];

      for (const entry of entries) {
        const location = normalizeManifestLocation(entry.location);
        const format = entry.format?.trim();

        if (!format) {
          return { ok: false, error: new Error(`Manifest entry for '${location}' is missing format.`) };
        }

        if (seenLocations.has(location)) {
          return { ok: false, error: new Error(`Duplicate manifest location '${location}'.`) };
        }

        seenLocations.add(location);
        normalizedEntries.push({
          ...entry,
          location,
          format,
        });
      }

      if (!seenLocations.has(".")) {
        normalizedEntries.unshift({
          location: ".",
          format: "http://identifiers.org/combine.specifications/omex",
        });
        seenLocations.add(".");
      }

      if (!seenLocations.has("./manifest.xml")) {
        normalizedEntries.push({
          location: "./manifest.xml",
          format: "http://identifiers.org/combine.specifications/omex-manifest",
        });
      }

      const document = create({ version: "1.0", encoding: "UTF-8" })
        .ele("omexManifest", { xmlns: MANIFEST_NS });

      for (const entry of normalizedEntries) {
        const attributes: Record<string, string> = {
          location: entry.location,
          format: entry.format,
        };

        if (entry.master) {
          attributes.master = "true";
        }

        if (entry.description) {
          attributes.description = entry.description;
        }

        document.ele("content", attributes).up();
      }

      if (metadata) {
        const metadataNode = document.ele("metadata");
        const rdfNode = metadataNode.ele("rdf:RDF", {
          "xmlns:rdf": RDF_NS,
          "xmlns:cellmlforge": CELLMLFORGE_NS,
        });

        const descriptionNode = rdfNode.ele("rdf:Description", {
          "rdf:about": ".",
        });

        descriptionNode
          .ele("cellmlforge:hasUncommittedChanges")
          .txt(String(metadata.hasUncommittedChanges))
          .up();

        if (metadata.gitBranch) {
          descriptionNode.ele("cellmlforge:gitBranch").txt(metadata.gitBranch).up();
        }

        if (metadata.gitRevision) {
          descriptionNode.ele("cellmlforge:gitRevision").txt(metadata.gitRevision).up();
        }

        if (metadata.gitRepoUrl) {
          descriptionNode.ele("cellmlforge:gitRepository").txt(metadata.gitRepoUrl).up();
        }

        descriptionNode.up();
        rdfNode.up();
        metadataNode.up();
      }

      const xml = document.end({ prettyPrint: true });
      await fs.writeFile(manifestPath, `${xml}\n`, "utf8");

      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Add or update a single manifest entry
   */
  async upsertEntry(
    manifestPath: string,
    entry: ManifestEntry
  ): Promise<OperationResult<void>> {
    try {
      // TODO: Implementation
      throw new Error("Not implemented");
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Remove an entry from manifest
   */
  async deleteEntry(
    manifestPath: string,
    location: string
  ): Promise<OperationResult<void>> {
    try {
      // TODO: Implementation
      throw new Error("Not implemented");
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Validate manifest structure and entries
   */
  async validate(
    manifestPath: string
  ): Promise<OperationResult<{ warnings: string[]; errors: string[] }>> {
    try {
      // TODO: Implementation
      // Pragmatic validation: required fields, path existence, no duplicates
      throw new Error("Not implemented");
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Calculate checksum (SHA256) for a file
   */
  async calculateChecksum(filePath: string): Promise<OperationResult<string>> {
    try {
      // TODO: Implementation
      throw new Error("Not implemented");
    } catch (error) {
      return { ok: false, error };
    }
  }
}

export const manifestService = new ManifestService();
