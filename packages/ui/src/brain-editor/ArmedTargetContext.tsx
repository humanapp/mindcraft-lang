import type { IBrainTileDef, RuleSide } from "@mindcraft-lang/core/brain";
import type { BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { CaretPosition } from "./caret-run";
import type { EditorMode } from "./editor-mode";

/** How the armed target consumes the chosen tile: append to a side, insert before a tile, or replace a tile. */
export type ArmedTargetMode = "append" | "insert" | "replace";

/**
 * Where the arming happened, which selects where the candidate strip's filter
 * input renders: in the strip's own tray, or inline at the position the rule's
 * sentence grows from.
 */
export type ArmedTargetEntry = "tray" | "sentence";

/**
 * The current target for a tile choice: which rule and side the picker is
 * armed for, how the chosen tile is applied, and the selection callback the
 * arming component supplied.
 *
 * The target carries closures from the arming component, so it must be
 * disarmed on any event that can invalidate them: a page switch, a
 * page-editor remount, or a structural change touching the armed rule.
 */
export interface ArmedTileTarget {
  ruleDef: BrainRuleDef;
  side: RuleSide;
  mode: ArmedTargetMode;
  /** Index of the targeted tile for insert/replace; undefined for append. */
  tileIndex?: number;
  /**
   * Index of the placed tile an edit point was opened on, which its position
   * pivot moves around. Undefined for a target armed anywhere but on a placed
   * tile, and the only way to recover the tile once the pivot's last position
   * has collapsed to an append.
   */
  anchorTileIndex?: number;
  /**
   * The caret this target was projected from: `side`, `mode` and `tileIndex` are
   * what `caretEditIntent` returns for it. Carried by every target armed from
   * the sentence, and undefined for one armed from the tray, which stands at no
   * caret.
   */
  caret?: CaretPosition;
  /** Where the arming happened; defaults to `tray` when omitted. */
  entry?: ArmedTargetEntry;
  /** Receives the chosen tile; returns true when the selection completed and the picker should close. */
  onTileSelected: (tileDef: IBrainTileDef) => boolean;
}

/** Arm/disarm surface shared through {@link ArmedTargetProvider}. */
export interface ArmedTargetController {
  /** The currently armed target, or null when no picker target is armed. */
  target: ArmedTileTarget | null;
  /** The context the armed tile picker holds the keyboard in, or null while nothing is armed. */
  mode: EditorMode | null;
  /** Arm the given target, replacing any previously armed one. */
  arm(target: ArmedTileTarget): void;
  /** Clear the armed target. */
  disarm(): void;
  /** Record the context the armed picker stands in. */
  reportMode(mode: EditorMode): void;
}

const noopController: ArmedTargetController = {
  target: null,
  mode: null,
  arm: () => {},
  disarm: () => {},
  reportMode: () => {},
};

const ArmedTargetContext = createContext<ArmedTargetController>(noopController);

/** Provider for an {@link ArmedTargetController}. Defaults to a no-op controller when omitted. */
export const ArmedTargetProvider = ArmedTargetContext.Provider;

/** Read the current {@link ArmedTargetController} from context. */
export function useArmedTargetController(): ArmedTargetController {
  return useContext(ArmedTargetContext);
}

/** Build the armed-target state owned by the editor dialog and shared via {@link ArmedTargetProvider}. */
export function useArmedTargetState(): ArmedTargetController {
  const [target, setTarget] = useState<ArmedTileTarget | null>(null);
  const [mode, setMode] = useState<EditorMode | null>(null);
  const arm = useCallback((next: ArmedTileTarget) => setTarget(next), []);
  const disarm = useCallback(() => {
    setTarget(null);
    setMode(null);
  }, []);
  const reportMode = useCallback((next: EditorMode) => setMode(next), []);
  return useMemo(() => ({ target, mode, arm, disarm, reportMode }), [target, mode, arm, disarm, reportMode]);
}

/** True when `target` arms the append picker for `ruleDef`. */
export function isAppendTargetForRule(target: ArmedTileTarget | null, ruleDef: BrainRuleDef): boolean {
  return target !== null && target.mode === "append" && target.ruleDef === ruleDef;
}

/**
 * True when `target` arms an edit point on the tile at `tileIndex` on `side` of
 * `ruleDef`. The tile addressed is the target's `anchorTileIndex` when it has
 * one, so an edit point matches the tile it was opened on through every
 * position of its pivot, and otherwise its `tileIndex`.
 */
export function isTileTargetForTile(
  target: ArmedTileTarget | null,
  ruleDef: BrainRuleDef,
  side: RuleSide,
  tileIndex: number
): boolean {
  if (target === null || target.ruleDef !== ruleDef || target.side !== side) return false;
  return (target.anchorTileIndex ?? target.tileIndex) === tileIndex;
}
