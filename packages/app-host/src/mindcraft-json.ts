/** Workspace path of the project's `mindcraft.json` manifest. */
export const MINDCRAFT_JSON_PATH = "mindcraft.json";

/** Shape of the `mindcraft.json` file. */
export interface MindcraftJson {
  /** Project display name. */
  name: string;
  /** Identifies the host application that created or last wrote this project. */
  host: {
    /** Host application identifier (e.g. `"sim"`). */
    name: string;
    /** Semver string of the host application. */
    version: string;
  };
  /** Semver string of the `mindcraft.json` schema itself. */
  version: string;
  /** Free-form project description. */
  description: string;
  /** Optional URL or data URI of a project thumbnail image. */
  thumbnailUrl?: string;
}

/**
 * Parse a `mindcraft.json` document. Returns `undefined` if the input is not
 * valid JSON or does not match {@link MindcraftJson}.
 */
export function parseMindcraftJson(content: string): MindcraftJson | undefined {
  try {
    const parsed = JSON.parse(content) as Partial<MindcraftJson>;
    if (
      typeof parsed.name !== "string" ||
      typeof parsed.version !== "string" ||
      typeof parsed.description !== "string" ||
      typeof parsed.host !== "object" ||
      parsed.host === null ||
      typeof parsed.host.name !== "string" ||
      typeof parsed.host.version !== "string"
    ) {
      return undefined;
    }
    if (parsed.thumbnailUrl !== undefined && typeof parsed.thumbnailUrl !== "string") {
      return undefined;
    }
    return parsed as MindcraftJson;
  } catch {
    return undefined;
  }
}

/** Serialize a {@link MindcraftJson} to a pretty-printed JSON string. */
export function serializeMindcraftJson(json: MindcraftJson): string {
  return JSON.stringify(json, null, 2);
}
