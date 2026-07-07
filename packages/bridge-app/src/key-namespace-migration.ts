/**
 * One-time key-namespace migration for saved brain documents. Projects saved
 * before symbol keys carried a project namespace reference user symbols by
 * their bare keys; this module rewrites those references to the namespaced
 * form the compiler now mints, prefixing each with the owning project's
 * namespace:
 *
 * - Binding-keyed type names `<file>::<binding>` (inside `struct:<...>` /
 *   `enum:<...>` type ids) become `<namespace>:<file>::<binding>`.
 * - Id-keyed action keys `user.<kind>.<id>` and private arg tile ids
 *   `user.<actionId>.<arg>` become `<namespace>:user.<...>`.
 *
 * Platform identifiers (host tile keys, `tile.op->...`, shared `modifier.*` /
 * `parameter.*` ids, core type ids) contain neither marker and pass through
 * unchanged. The migration is idempotent: already-namespaced references are
 * detected by the key grammar (a namespace never contains `:/`; id-keyed
 * local parts always start `user.`) and never re-prefixed. Strings that carry
 * user-key markers but match no known shape are left untouched and reported.
 */

/** Result of {@link migrateBrainKeyNamespaces} over one brain document. */
export interface KeyNamespaceMigrationReport {
  /** True when at least one reference was rewritten. */
  changed: boolean;
  /** Strings carrying user-key markers that matched no known shape; left untouched. */
  unknownKeys: readonly string[];
}

interface MigrationState {
  readonly namespace: string;
  changed: boolean;
  readonly unknownKeys: Set<string>;
}

/**
 * Record a string that looks like it references a user symbol but matches no
 * known key shape. Strings already carrying a namespace are not suspicious.
 */
function reportIfSuspicious(value: string, state: MigrationState): void {
  if (value.includes(":/") || value.includes(":user.")) {
    return;
  }
  if (value.startsWith("user.") || value.includes("->user.") || value.includes("::")) {
    state.unknownKeys.add(value);
  }
}

/**
 * Rewrite a registry type name. Old-shape names are the compiler's
 * project-relative file path (always starting with `/`) plus `::` and the
 * binding name.
 */
function migrateTypeName(name: string, state: MigrationState): string {
  if (name.includes(":/")) {
    return name;
  }
  if (name.startsWith("/") && name.includes("::")) {
    state.changed = true;
    return `${state.namespace}:${name}`;
  }
  if (name.includes("::")) {
    state.unknownKeys.add(name);
  }
  return name;
}

/** Rewrite the type name embedded in a `<coreType>:<NAME>` type id. */
function migrateTypeId(typeId: string, state: MigrationState): string {
  const open = typeId.indexOf(":<");
  if (open <= 0 || !typeId.endsWith(">")) {
    reportIfSuspicious(typeId, state);
    return typeId;
  }
  const name = typeId.slice(open + 2, -1);
  const migrated = migrateTypeName(name, state);
  if (migrated === name) {
    return typeId;
  }
  return `${typeId.slice(0, open + 2)}${migrated}>`;
}

/**
 * Rewrite an id-keyed local part (an action key or a private arg tile id).
 * Only bare `user.`-prefixed ids migrate; namespaced ids and platform ids
 * pass through.
 */
function migrateLocalId(id: string, state: MigrationState): string {
  if (id.startsWith("user.")) {
    state.changed = true;
    return `${state.namespace}:${id}`;
  }
  return id;
}

/** Rewrite one tile id according to its area's payload grammar. */
function migrateTileId(tileId: string, state: MigrationState): string {
  if (!tileId.startsWith("tile.")) {
    reportIfSuspicious(tileId, state);
    return tileId;
  }
  const sep = tileId.indexOf("->");
  if (sep === -1) {
    reportIfSuspicious(tileId, state);
    return tileId;
  }
  const area = tileId.substring(5, sep);
  const payload = tileId.substring(sep + 2);

  switch (area) {
    case "sensor":
    case "actuator":
    case "parameter":
    case "modifier": {
      const migrated = migrateLocalId(payload, state);
      if (migrated === payload) {
        reportIfSuspicious(tileId, state);
        return tileId;
      }
      return `tile.${area}->${migrated}`;
    }

    // accessor and literal payloads both lead with a type id: `<typeId>->...`.
    case "accessor":
    case "literal": {
      const typeEnd = payload.indexOf("->");
      if (typeEnd === -1) {
        reportIfSuspicious(tileId, state);
        return tileId;
      }
      const typeId = payload.substring(0, typeEnd);
      const migrated = migrateTypeId(typeId, state);
      if (migrated === typeId) {
        return tileId;
      }
      return `tile.${area}->${migrated}${payload.substring(typeEnd)}`;
    }

    // A struct variable factory's payload is the produced struct's type id;
    // core factory payloads (`number.list`, ...) are not type-id shaped and
    // pass through migrateTypeId unchanged.
    case "var.factory": {
      const migrated = migrateTypeId(payload, state);
      if (migrated === payload) {
        return tileId;
      }
      return `tile.var.factory->${migrated}`;
    }

    // Output payloads are `<typeId>.<name>`; the type id ends at its closing `>`.
    case "out": {
      const typeEnd = payload.lastIndexOf(">.");
      if (typeEnd === -1) {
        reportIfSuspicious(tileId, state);
        return tileId;
      }
      const typeId = payload.substring(0, typeEnd + 1);
      const migrated = migrateTypeId(typeId, state);
      if (migrated === typeId) {
        return tileId;
      }
      return `tile.out->${migrated}${payload.substring(typeEnd + 1)}`;
    }

    // Areas whose ids never reference user symbols.
    case "op":
    case "cf":
    case "var":
    case "page":
    case "lit.factory":
      return tileId;

    default:
      reportIfSuspicious(tileId, state);
      return tileId;
  }
}

function migrateTileIds(ids: unknown[], state: MigrationState): void {
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (typeof id === "string") {
      ids[i] = migrateTileId(id, state);
    }
  }
}

interface PlainCatalogEntry {
  kind?: string;
  tileId?: string;
  valueType?: string;
  varType?: string;
}

function migrateCatalogEntry(entry: PlainCatalogEntry, state: MigrationState): void {
  if (typeof entry.tileId === "string") {
    entry.tileId = migrateTileId(entry.tileId, state);
  }
  if (entry.kind === "literal" && typeof entry.valueType === "string") {
    entry.valueType = migrateTypeId(entry.valueType, state);
  }
  if (entry.kind === "variable" && typeof entry.varType === "string") {
    entry.varType = migrateTypeId(entry.varType, state);
  }
}

interface PlainRule {
  when?: unknown[];
  do?: unknown[];
  children?: PlainRule[];
}

function migrateRule(rule: PlainRule, state: MigrationState): void {
  if (Array.isArray(rule.when)) {
    migrateTileIds(rule.when, state);
  }
  if (Array.isArray(rule.do)) {
    migrateTileIds(rule.do, state);
  }
  if (Array.isArray(rule.children)) {
    for (const child of rule.children) {
      migrateRule(child, state);
    }
  }
}

interface PlainBrainJson {
  catalog?: PlainCatalogEntry[];
  pages?: Array<{ rules?: PlainRule[] }>;
}

/**
 * Rewrite every pre-namespace user-symbol reference in a plain (JSON.parse'd)
 * brain document to its `<projectNamespace>:`-prefixed form, mutating the
 * document in place. Running the migration on an already-migrated document
 * changes nothing. Returns what changed and which marker-carrying strings
 * were left untouched as unclassifiable.
 */
export function migrateBrainKeyNamespaces(json: unknown, projectNamespace: string): KeyNamespaceMigrationReport {
  const state: MigrationState = { namespace: projectNamespace, changed: false, unknownKeys: new Set() };
  const brain = json as PlainBrainJson;

  if (Array.isArray(brain.catalog)) {
    for (const entry of brain.catalog) {
      migrateCatalogEntry(entry, state);
    }
  }

  if (Array.isArray(brain.pages)) {
    for (const page of brain.pages) {
      if (Array.isArray(page.rules)) {
        for (const rule of page.rules) {
          migrateRule(rule, state);
        }
      }
    }
  }

  return { changed: state.changed, unknownKeys: [...state.unknownKeys] };
}
