import { TypeUtils } from "../../platform/types";
import type {
  PersistedBrainJson,
  PersistedCatalogTileJson,
  PersistedPageJson,
  PersistedRuleJson,
  PersistedTileRef,
  PersistedTypeRef,
} from "./brain-json-persisted";

/**
 * Maps a project namespace to its replacement, returning the namespace
 * unchanged when it is not being rewritten. A namespace is a host project's
 * store id or an extension's `<owner>/<repo>` coordinate; a rewrite that
 * changes it renames every symbol the namespace owns.
 */
export type NamespaceRewrite = (namespace: string) => string;

/** Rewrite a single optional namespace field, returning `ns` unchanged when the rewrite is a no-op. */
function rewriteNs(ns: string | undefined, rewrite: NamespaceRewrite): string | undefined {
  if (ns === undefined) {
    return undefined;
  }
  const replaced = rewrite(ns);
  return replaced === ns ? ns : replaced;
}

/** Map a type-ref array, returning the same array reference when no element changed. */
function rewriteTypeRefArray(
  items: readonly PersistedTypeRef[],
  rewrite: NamespaceRewrite
): readonly PersistedTypeRef[] {
  let changed = false;
  const out: PersistedTypeRef[] = [];
  for (const item of items) {
    const mapped = rewriteTypeRef(item, rewrite);
    if (mapped !== item) {
      changed = true;
    }
    out.push(mapped);
  }
  return changed ? out : items;
}

/** Map a tile-ref array, returning the same array reference when no element changed. */
function rewriteTileRefArray(
  items: readonly PersistedTileRef[],
  rewrite: NamespaceRewrite
): readonly PersistedTileRef[] {
  let changed = false;
  const out: PersistedTileRef[] = [];
  for (const item of items) {
    const mapped = rewriteTileRef(item, rewrite);
    if (mapped !== item) {
      changed = true;
    }
    out.push(mapped);
  }
  return changed ? out : items;
}

/** Rewrite the namespace fields carried anywhere in a persisted type reference. */
function rewriteTypeRef(ref: PersistedTypeRef, rewrite: NamespaceRewrite): PersistedTypeRef {
  if (TypeUtils.isString(ref)) {
    return ref;
  }
  switch (ref.k) {
    case "named": {
      const ns = rewriteNs(ref.ns, rewrite);
      return ns === ref.ns ? ref : { ...ref, ns };
    }
    case "nullable": {
      const base = rewriteTypeRef(ref.base, rewrite);
      return base === ref.base ? ref : { ...ref, base };
    }
    case "list": {
      const el = rewriteTypeRef(ref.el, rewrite);
      return el === ref.el ? ref : { ...ref, el };
    }
    case "map": {
      const key = rewriteTypeRef(ref.key, rewrite);
      const val = rewriteTypeRef(ref.val, rewrite);
      return key === ref.key && val === ref.val ? ref : { ...ref, key, val };
    }
    case "union": {
      const members = rewriteTypeRefArray(ref.members, rewrite);
      return members === ref.members ? ref : { ...ref, members };
    }
    case "function": {
      const params = rewriteTypeRefArray(ref.params, rewrite);
      const ret = rewriteTypeRef(ref.ret, rewrite);
      return params === ref.params && ret === ref.ret ? ref : { ...ref, params, ret };
    }
    default: {
      const exhaustive: never = ref;
      return exhaustive;
    }
  }
}

/** Rewrite the namespace fields carried anywhere in a persisted tile reference. */
function rewriteTileRef(ref: PersistedTileRef, rewrite: NamespaceRewrite): PersistedTileRef {
  if (TypeUtils.isString(ref)) {
    return ref;
  }
  switch (ref.k) {
    case "action":
    case "arg":
    case "anon": {
      const ns = rewriteNs(ref.ns, rewrite);
      return ns === ref.ns ? ref : { ...ref, ns };
    }
    case "accessor": {
      const typeRef = rewriteTypeRef(ref.type, rewrite);
      return typeRef === ref.type ? ref : { ...ref, type: typeRef };
    }
    case "out": {
      const ns = rewriteNs(ref.ns, rewrite);
      const typeRef = rewriteTypeRef(ref.type, rewrite);
      return ns === ref.ns && typeRef === ref.type ? ref : { ...ref, ns, type: typeRef };
    }
    case "literal": {
      const typeRef = rewriteTypeRef(ref.type, rewrite);
      return typeRef === ref.type ? ref : { ...ref, type: typeRef };
    }
    default: {
      const exhaustive: never = ref;
      return exhaustive;
    }
  }
}

/** Rewrite the namespace fields carried by a persisted catalog entry's type references. */
function rewriteCatalogEntry(entry: PersistedCatalogTileJson, rewrite: NamespaceRewrite): PersistedCatalogTileJson {
  switch (entry.kind) {
    case "literal": {
      const valueType = rewriteTypeRef(entry.valueType, rewrite);
      return valueType === entry.valueType ? entry : { ...entry, valueType };
    }
    case "variable": {
      const varType = rewriteTypeRef(entry.varType, rewrite);
      return varType === entry.varType ? entry : { ...entry, varType };
    }
    case "page":
      return entry;
    case "missing": {
      const tileId = rewriteTileRef(entry.tileId, rewrite);
      return tileId === entry.tileId ? entry : { ...entry, tileId };
    }
    default: {
      const exhaustive: never = entry;
      return exhaustive;
    }
  }
}

/** Map a rule array, returning the same array reference when no element changed. */
function rewriteRuleArray(
  items: readonly PersistedRuleJson[],
  rewrite: NamespaceRewrite
): readonly PersistedRuleJson[] {
  let changed = false;
  const out: PersistedRuleJson[] = [];
  for (const item of items) {
    const mapped = rewriteRule(item, rewrite);
    if (mapped !== item) {
      changed = true;
    }
    out.push(mapped);
  }
  return changed ? out : items;
}

/** Rewrite the namespace fields carried by a persisted rule's tile references, recursing into children. */
function rewriteRule(rule: PersistedRuleJson, rewrite: NamespaceRewrite): PersistedRuleJson {
  const when = rewriteTileRefArray(rule.when, rewrite);
  const doSide = rewriteTileRefArray(rule.do, rewrite);
  const children = rewriteRuleArray(rule.children, rewrite);
  if (when === rule.when && doSide === rule.do && children === rule.children) {
    return rule;
  }
  return { ...rule, when, do: doSide, children };
}

/** Rewrite the namespace fields carried by a persisted page's rules. */
function rewritePage(page: PersistedPageJson, rewrite: NamespaceRewrite): PersistedPageJson {
  const rules = rewriteRuleArray(page.rules, rewrite);
  return rules === page.rules ? page : { ...page, rules };
}

/** Result of {@link renameBrainNamespaces}. */
export interface RenamedBrainJson {
  /** The rewritten brain; the input reference when nothing changed. */
  readonly brain: PersistedBrainJson;
  /** True when at least one namespace field was rewritten. */
  readonly changed: boolean;
}

/**
 * Rewrite every project-namespace prefix carried by a persisted brain's
 * catalog and rule references through `rewrite`. Each library-contributed
 * symbol a brain references (tiles, arg tiles, types, Systems, and their
 * entry-published aliases) carries its owning namespace as a field; a rename
 * changes only that prefix, leaving the stable id, file, and binding of every
 * reference intact. Returns the same brain object unchanged when `rewrite`
 * touches nothing the brain references.
 *
 * @param plain - The raw `JSON.parse` output of a persisted brain.
 * @param rewrite - Maps a namespace to its replacement.
 */
export function renameBrainNamespaces(plain: unknown, rewrite: NamespaceRewrite): RenamedBrainJson {
  const brain = plain as PersistedBrainJson;
  const catalog = brain.catalog ? rewriteCatalogArray(brain.catalog, rewrite) : brain.catalog;
  const pages = brain.pages ? rewritePageArray(brain.pages, rewrite) : brain.pages;
  const changed = catalog !== brain.catalog || pages !== brain.pages;
  return { brain: changed ? { ...brain, catalog, pages } : brain, changed };
}

/** Map a catalog-entry array, returning the same array reference when no element changed. */
function rewriteCatalogArray(
  items: readonly PersistedCatalogTileJson[],
  rewrite: NamespaceRewrite
): readonly PersistedCatalogTileJson[] {
  let changed = false;
  const out: PersistedCatalogTileJson[] = [];
  for (const item of items) {
    const mapped = rewriteCatalogEntry(item, rewrite);
    if (mapped !== item) {
      changed = true;
    }
    out.push(mapped);
  }
  return changed ? out : items;
}

/** Map a page array, returning the same array reference when no element changed. */
function rewritePageArray(
  items: readonly PersistedPageJson[],
  rewrite: NamespaceRewrite
): readonly PersistedPageJson[] {
  let changed = false;
  const out: PersistedPageJson[] = [];
  for (const item of items) {
    const mapped = rewritePage(item, rewrite);
    if (mapped !== item) {
      changed = true;
    }
    out.push(mapped);
  }
  return changed ? out : items;
}
