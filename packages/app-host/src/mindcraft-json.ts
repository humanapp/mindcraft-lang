export const MINDCRAFT_JSON_PATH = "mindcraft.json";

export interface MindcraftJson {
  name: string;
  host: {
    name: string;
    version: string;
  };
  version: string;
  description: string;
}

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
    return parsed as MindcraftJson;
  } catch {
    return undefined;
  }
}

export function serializeMindcraftJson(json: MindcraftJson): string {
  return JSON.stringify(json, null, 2);
}
