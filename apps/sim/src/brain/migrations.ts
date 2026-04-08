import type { BrainJsonMigration } from "@mindcraft-lang/core/app";

const kTypeIdRenames: Record<string, string> = {
  "struct:<actorRef>": "struct:<ActorRef>",
  "struct:<vector2>": "struct:<Vector2>",
};

function migrateTypeId(typeId: string): string {
  return kTypeIdRenames[typeId] ?? typeId;
}

function migrateTileId(tileId: string): string {
  if (!tileId.startsWith("tile.")) return tileId;

  const sep = tileId.indexOf("->");
  if (sep === -1) return tileId;
  const area = tileId.substring(5, sep);
  const payload = tileId.substring(sep + 2);

  switch (area) {
    case "literal": {
      const typeEnd = payload.indexOf("->");
      if (typeEnd === -1) return tileId;
      const oldTypeId = payload.substring(0, typeEnd);
      const rest = payload.substring(typeEnd);
      const newTypeId = migrateTypeId(oldTypeId);
      if (newTypeId === oldTypeId) return tileId;
      return `tile.literal->${newTypeId}${rest}`;
    }

    case "accessor": {
      const typeEnd = payload.indexOf("->");
      if (typeEnd === -1) return tileId;
      const oldTypeId = payload.substring(0, typeEnd);
      const rest = payload.substring(typeEnd);
      const newTypeId = migrateTypeId(oldTypeId);
      if (newTypeId === oldTypeId) return tileId;
      return `tile.accessor->${newTypeId}${rest}`;
    }

    case "var": {
      const typeEnd = payload.indexOf("->");
      if (typeEnd === -1) return tileId;
      const oldTypeId = payload.substring(0, typeEnd);
      const rest = payload.substring(typeEnd);
      const newTypeId = migrateTypeId(oldTypeId);
      if (newTypeId === oldTypeId) return tileId;
      return `tile.var->${newTypeId}${rest}`;
    }

    case "var.factory": {
      const newTypeId = migrateTypeId(payload);
      if (newTypeId === payload) return tileId;
      return `tile.var.factory->${newTypeId}`;
    }

    default:
      return tileId;
  }
}

function migrateTileIds(ids: unknown[]): void {
  for (let i = 0; i < ids.length; i++) {
    if (typeof ids[i] === "string") {
      ids[i] = migrateTileId(ids[i] as string);
    }
  }
}

interface PlainCatalogEntry {
  kind?: string;
  tileId?: string;
  valueType?: string;
  varType?: string;
}

function migrateCatalogEntry(entry: PlainCatalogEntry): void {
  if (entry.tileId && typeof entry.tileId === "string") {
    entry.tileId = migrateTileId(entry.tileId);
  }
  if (entry.kind === "literal" && entry.valueType && typeof entry.valueType === "string") {
    entry.valueType = migrateTypeId(entry.valueType);
  }
  if (entry.kind === "variable" && entry.varType && typeof entry.varType === "string") {
    entry.varType = migrateTypeId(entry.varType);
  }
}

interface PlainRule {
  when?: unknown[];
  do?: unknown[];
  children?: PlainRule[];
}

function migrateRule(rule: PlainRule): void {
  if (Array.isArray(rule.when)) migrateTileIds(rule.when);
  if (Array.isArray(rule.do)) migrateTileIds(rule.do);
  if (Array.isArray(rule.children)) {
    for (const child of rule.children) {
      migrateRule(child);
    }
  }
}

interface PlainBrainJson {
  catalog?: PlainCatalogEntry[];
  pages?: Array<{ rules?: PlainRule[] }>;
}

export const migrateSimBrainJson: BrainJsonMigration = (json: unknown): void => {
  const brain = json as PlainBrainJson;

  if (Array.isArray(brain.catalog)) {
    for (const entry of brain.catalog) {
      migrateCatalogEntry(entry);
    }
  }

  if (Array.isArray(brain.pages)) {
    for (const page of brain.pages) {
      if (Array.isArray(page.rules)) {
        for (const rule of page.rules) {
          migrateRule(rule);
        }
      }
    }
  }
};
