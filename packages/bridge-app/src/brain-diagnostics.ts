import type { IBrainDef } from "@wendoo-lang/core/app";
import type { IBrainActionTileDef, IBrainRuleDef, IBrainTileSet } from "@wendoo-lang/core/brain";
import { TypeDiagCode } from "@wendoo-lang/core/brain/compiler";
import { BrainRuleDef } from "@wendoo-lang/core/brain/model";
import type { ActionKey } from "@wendoo-lang/core/runtime";
import type { TileCompileDiagnostics } from "./user-tile-registration.js";

/**
 * One brain diagnostic as the compiler emitted it: the stable code, the rule
 * location within the brain, and the compiler's message text verbatim.
 * Rendered on console-style surfaces only, where machine forms are the
 * expected content.
 */
export interface BrainDiagnosticEntry {
  /** Stable diagnostic code of the underlying parse or type diagnostic. */
  readonly code: number;
  /** Rule location within the brain: the page name followed by the rule chain. */
  readonly location: string;
  /** The compiler's diagnostic message, verbatim. */
  readonly message: string;
}

function collectRuleDiagnostics(rule: IBrainRuleDef, out: BrainDiagnosticEntry[]): void {
  if (rule instanceof BrainRuleDef) {
    const result = rule.when().typecheckResult();
    if (result) {
      const location = rule.getLocationPath();
      result.whenParseResult.diags.forEach((diag) => {
        out.push({ code: diag.code, location, message: diag.message });
      });
      result.doParseResult.diags.forEach((diag) => {
        out.push({ code: diag.code, location, message: diag.message });
      });
      result.typeInfo.diags.forEach((diag) => {
        if (diag.code === TypeDiagCode.DataTypeConverted) {
          return;
        }
        out.push({ code: diag.code, location, message: diag.message });
      });
    }
  }
  rule.children().forEach((child) => {
    collectRuleDiagnostics(child, out);
  });
}

/**
 * Collect a brain's error diagnostics from the typecheck results stored on its
 * rules, verbatim. Reads stored state only; the brain is not re-typechecked.
 * A rule that has never been typechecked contributes nothing, and
 * informational type-conversion diagnostics are excluded.
 *
 * @param brain - The brain to read.
 */
export function collectBrainErrorDiagnostics(brain: IBrainDef): readonly BrainDiagnosticEntry[] {
  const out: BrainDiagnosticEntry[] = [];
  brain.pages().forEach((page) => {
    page.children().forEach((rule) => {
      collectRuleDiagnostics(rule, out);
    });
  });
  return out;
}

/**
 * Look up a user tile's compile diagnostics and defining source path by the
 * tile's {@link ActionKey}. Returns `undefined` when the tile compiled cleanly
 * or is absent from the latest compile. Supplied by the host, which holds the
 * latest workspace compile.
 */
export type TileCompileDiagnosticsLookup = (key: ActionKey) => TileCompileDiagnostics | undefined;

function composeTileLocation(path: string, diagnostic: TileCompileDiagnostics["diagnostics"][number]): string {
  if (diagnostic.line === undefined) {
    return path;
  }
  if (diagnostic.column === undefined) {
    return `${path}:${diagnostic.line}`;
  }
  return `${path}:${diagnostic.line}:${diagnostic.column}`;
}

function collectRuleTileKeys(rule: IBrainRuleDef, keys: Set<ActionKey>): void {
  const collectSide = (side: IBrainTileSet): void => {
    side.tiles().forEach((tile) => {
      if ("action" in tile) {
        keys.add((tile as IBrainActionTileDef).action.key);
      }
    });
  };
  collectSide(rule.when());
  collectSide(rule.do());
  rule.children().forEach((child) => {
    collectRuleTileKeys(child, keys);
  });
}

/**
 * Collect compile diagnostics for the broken user tiles a brain uses, verbatim.
 * Traverses every rule's WHEN and DO tiles (recursing into child rules), and for
 * each DISTINCT action tile key resolves the tile's compile diagnostics through
 * `lookup`. A tile used in several rules contributes its diagnostics once. Each
 * emitted entry carries the compiler's `code` and `message` unchanged and a
 * `location` composed from the tile's source path and the diagnostic's
 * `line`/`column`. A brain whose tiles all compiled cleanly yields an empty list.
 *
 * @param brain - The brain to traverse.
 * @param lookup - Resolves a tile key to its compile diagnostics and source path.
 */
export function collectBrainTileCompileDiagnostics(
  brain: IBrainDef,
  lookup: TileCompileDiagnosticsLookup
): readonly BrainDiagnosticEntry[] {
  const keys = new Set<ActionKey>();
  brain.pages().forEach((page) => {
    page.children().forEach((rule) => {
      collectRuleTileKeys(rule, keys);
    });
  });

  const out: BrainDiagnosticEntry[] = [];
  keys.forEach((key) => {
    const tileDiagnostics = lookup(key);
    if (!tileDiagnostics) {
      return;
    }
    tileDiagnostics.diagnostics.forEach((diagnostic) => {
      out.push({
        code: diagnostic.code,
        location: composeTileLocation(tileDiagnostics.path, diagnostic),
        message: diagnostic.message,
      });
    });
  });
  return out;
}
