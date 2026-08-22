import type { BrainJsonMigration } from "@wendoo-lang/core/app";

const kTypeIdRenames: Record<string, string> = {
  "struct:<actorRef>": "struct:<ActorRef>",
  "struct:<vector2>": "struct:<Vector2>",
};

const kTilePrefix = "tile.";

function migrateTypeId(typeId: string): string {
  return kTypeIdRenames[typeId] ?? typeId;
}

/** 1-based index of the first `->` in `text`, or undefined when absent. */
function findArrow(text: string): number | undefined {
  const [start] = text.find("->", 1, true);
  return start;
}

/**
 * Rewrites the struct type id embedded in a `tile.<area>-><typeId>...` tile id.
 * The `payload` is everything after the area's arrow; the returned value is the
 * migrated type id followed by the untouched remainder.
 */
function migratePayloadTypeId(payload: string): string | undefined {
  const typeEnd = findArrow(payload);
  if (typeEnd === undefined) return undefined;
  const oldTypeId = payload.sub(1, typeEnd - 1);
  const rest = payload.sub(typeEnd);
  const newTypeId = migrateTypeId(oldTypeId);
  if (newTypeId === oldTypeId) return undefined;
  return `${newTypeId}${rest}`;
}

function migrateTileId(tileId: string): string {
  if (tileId.sub(1, kTilePrefix.size()) !== kTilePrefix) return tileId;

  const sep = findArrow(tileId);
  if (sep === undefined) return tileId;
  const area = tileId.sub(kTilePrefix.size() + 1, sep - 1);
  const payload = tileId.sub(sep + 2);

  switch (area) {
    case "literal": {
      const migrated = migratePayloadTypeId(payload);
      return migrated === undefined ? tileId : `tile.literal->${migrated}`;
    }

    case "accessor": {
      const migrated = migratePayloadTypeId(payload);
      return migrated === undefined ? tileId : `tile.accessor->${migrated}`;
    }

    case "var": {
      const migrated = migratePayloadTypeId(payload);
      return migrated === undefined ? tileId : `tile.var->${migrated}`;
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
  for (let i = 0; i < ids.size(); i++) {
    const id = ids[i];
    if (typeIs(id, "string")) {
      ids[i] = migrateTileId(id);
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
  const tileId = entry.tileId;
  if (typeIs(tileId, "string")) {
    entry.tileId = migrateTileId(tileId);
  }
  const valueType = entry.valueType;
  if (entry.kind === "literal" && typeIs(valueType, "string")) {
    entry.valueType = migrateTypeId(valueType);
  }
  const varType = entry.varType;
  if (entry.kind === "variable" && typeIs(varType, "string")) {
    entry.varType = migrateTypeId(varType);
  }
}

interface PlainRule {
  when?: unknown[];
  do?: unknown[];
  children?: PlainRule[];
}

function migrateRule(rule: PlainRule): void {
  const when = rule.when;
  if (when !== undefined) migrateTileIds(when);
  const actions = rule.do;
  if (actions !== undefined) migrateTileIds(actions);
  const children = rule.children;
  if (children !== undefined) {
    for (const child of children) {
      migrateRule(child);
    }
  }
}

interface PlainBrainJson {
  catalog?: PlainCatalogEntry[];
  pages?: Array<{ rules?: PlainRule[] }>;
}

/**
 * Upgrades persisted ecosim brain JSON in place, renaming the legacy
 * `actorRef` / `vector2` struct type ids to their current `ActorRef` /
 * `Vector2` spellings across catalog entries and rule tile ids.
 *
 * @param json - Plain brain JSON, mutated in place.
 */
export const migrateEcosimBrainJson: BrainJsonMigration = (json: unknown): void => {
  const brain = json as PlainBrainJson;

  const catalog = brain.catalog;
  if (catalog !== undefined) {
    for (const entry of catalog) {
      migrateCatalogEntry(entry);
    }
  }

  const pages = brain.pages;
  if (pages !== undefined) {
    for (const page of pages) {
      const rules = page.rules;
      if (rules !== undefined) {
        for (const rule of rules) {
          migrateRule(rule);
        }
      }
    }
  }
};
