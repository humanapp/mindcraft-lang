import { List } from "@wendoo/core";
import {
  type BrainServices,
  type IBrainTileDef,
  type ITileCatalog,
  RuleSide,
  RuleTriggerMode,
} from "@wendoo/core/brain";
import { type CatalogTileJson, TileCatalog } from "@wendoo/core/brain/tiles";

// ---------------------------------------------------------------------------
// The `brain` fence grammar
//
// A documentation page draws brain tiles and rules from a fenced code block
// tagged `brain`, whose body is JSON in one of four shapes:
//
//   array of rules      [{ "when": [...], "do": [...] }]
//   clipboard wrapper   { "ruleJsons": [...], "catalog": [...] }
//   one tile            { "tile": "tile.op->add" } or { "tileId": "..." }
//   several tiles       { "tiles": ["tile.op->add", "tile.op->sub"] }
//
// Every shape takes an optional `catalog` of brain-local tiles -- variables,
// literals, pages -- so an example can name tiles no service catalog holds. The
// two tile shapes take an optional `side` ("when" or "do") choosing which of a
// tile's two colors its chips are drawn in.
//
// The fence's info string carries the block's own tokens: `noframe` drops the
// surrounding card, and `do` draws a tile block in its DO color. A `side` in
// the JSON overrides the `do` token.
//
// A rule object is the `RuleJson` shape the editor serializes, so a rule copied
// out of a brain pastes into a page verbatim. `trigger` names the mode arming
// the rule -- "otherwise" or "then"; an absent `trigger` reads as "when", so a
// fence written before the field renders unchanged. Key order carries no
// meaning, and a hand-written example reads best with the mode beside the
// condition it arms:
//
//     ```brain
//     {
//       "ruleJsons": [
//         { "version": 1, "when": ["tile.sensor->random"], "do": [] },
//         { "version": 1, "trigger": "otherwise", "when": [], "do": [] }
//       ]
//     }
//     ```
// ---------------------------------------------------------------------------

/** One rule of a `brain` fence, in the `RuleJson` shape a copied rule serializes to. */
export interface BrainFenceRule {
  version?: number;
  /** Brain-local tiles this rule names, merged with the fence's top-level catalog. */
  catalog?: CatalogTileJson[];
  comment?: string;
  /** Mode arming the rule. Absent reads as {@link RuleTriggerMode.When}. */
  trigger?: RuleTriggerMode;
  when?: string[];
  do?: string[];
  children?: BrainFenceRule[];
}

/** Clipboard wrapper shape: `{ ruleJsons: [...], catalog: [...] }`. */
interface BrainFenceWrapper {
  ruleJsons: BrainFenceRule[];
  catalog?: CatalogTileJson[];
}

/** Single-tile shape: `{ tile: "tileId" }` or `{ tileId: "..." }`. */
interface BrainFenceSingleTile {
  tile?: string;
  tileId?: string;
  catalog?: CatalogTileJson[];
  side?: "when" | "do";
}

/** Multi-tile shape: `{ tiles: ["tileId", ...] }`. */
interface BrainFenceMultiTile {
  tiles: string[];
  catalog?: CatalogTileJson[];
  side?: "when" | "do";
}

/** A fence holding rules, each drawn as a rule row. */
export interface ParsedFenceRules {
  kind: "rules";
  rules: BrainFenceRule[];
  catalogEntries: CatalogTileJson[];
}

/** A fence holding bare tiles, drawn as a strip of chips. */
export interface ParsedFenceTiles {
  kind: "tiles";
  tileIds: string[];
  catalogEntries: CatalogTileJson[];
  /** Side the chips are colored for, when the JSON names one. */
  side?: "when" | "do";
}

/** What a `brain` fence body parses to. */
export type ParsedBrainFence = ParsedFenceRules | ParsedFenceTiles;

/** The block-level tokens a `brain` fence's info string carries. */
export interface BrainFenceMeta {
  /** Whether the block drops its surrounding card. */
  noFrame: boolean;
  /** Side a tile block is drawn in when its JSON names none. */
  side: RuleSide;
}

/** Read the `noframe` and `do` tokens out of a fence's info string. */
export function parseBrainFenceMeta(meta: string): BrainFenceMeta {
  const tokens = meta.toLowerCase().split(/\s+/).filter(Boolean);
  return {
    noFrame: tokens.includes("noframe"),
    side: tokens.includes("do") ? RuleSide.Do : RuleSide.When,
  };
}

/** The side a tile block is drawn in: the one its JSON names, else the one its info string does. */
export function brainFenceTileSide(declared: "when" | "do" | undefined, fromMeta: RuleSide): RuleSide {
  if (declared === "do") return RuleSide.Do;
  if (declared === "when") return RuleSide.When;
  return fromMeta;
}

/** The mode arming `rule`; an absent `trigger` reads as {@link RuleTriggerMode.When}. */
export function brainFenceRuleTrigger(rule: BrainFenceRule): RuleTriggerMode {
  return rule.trigger ?? RuleTriggerMode.When;
}

/** Collect the catalog entries of every rule, after the fence's top-level ones. */
function collectCatalogEntries(rules: BrainFenceRule[], topLevel?: CatalogTileJson[]): CatalogTileJson[] {
  const entries: CatalogTileJson[] = topLevel ? [...topLevel] : [];
  for (const rule of rules) {
    if (rule.catalog) {
      entries.push(...rule.catalog);
    }
  }
  return entries;
}

/**
 * Parse a `brain` fence body, in any of the four shapes above. Returns
 * undefined for a body that is not JSON, or is JSON in no shape the grammar
 * names.
 */
export function parseBrainFence(jsonStr: string): ParsedBrainFence | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return undefined;
  }
  if (Array.isArray(parsed)) {
    const rules = parsed as BrainFenceRule[];
    return { kind: "rules", rules, catalogEntries: collectCatalogEntries(rules) };
  }
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const single = parsed as BrainFenceSingleTile;
  const singleId = single.tile ?? single.tileId;
  if (typeof singleId === "string") {
    return { kind: "tiles", tileIds: [singleId], catalogEntries: single.catalog ?? [], side: single.side };
  }
  const multi = parsed as BrainFenceMultiTile;
  if (Array.isArray(multi.tiles)) {
    return { kind: "tiles", tileIds: multi.tiles, catalogEntries: multi.catalog ?? [], side: multi.side };
  }
  const wrapper = parsed as BrainFenceWrapper;
  if (Array.isArray(wrapper.ruleJsons)) {
    return {
      kind: "rules",
      rules: wrapper.ruleJsons,
      catalogEntries: collectCatalogEntries(wrapper.ruleJsons, wrapper.catalog),
    };
  }
  return undefined;
}

/**
 * Build a catalog holding the fence's brain-local tiles, so an example's
 * variables, literals and pages resolve while it renders. Returns undefined
 * when the fence declares none, or when no services are available to
 * deserialize them.
 */
export function buildBrainFenceCatalog(
  entries: CatalogTileJson[],
  brainServices: BrainServices | undefined
): TileCatalog | undefined {
  if (entries.length === 0) return undefined;
  const catalog = new TileCatalog();
  if (brainServices) catalog.deserializeJson(List.from(entries), brainServices);
  return catalog;
}

/** Resolve tile ids against the fence's own catalog first, then the host's. Ids nothing holds are dropped. */
export function resolveBrainFenceTiles(
  tileIds: string[],
  tileCatalog: ITileCatalog | undefined,
  localCatalog?: TileCatalog
): IBrainTileDef[] {
  return tileIds.map((id) => localCatalog?.get(id) ?? tileCatalog?.get(id)).filter(Boolean) as IBrainTileDef[];
}
