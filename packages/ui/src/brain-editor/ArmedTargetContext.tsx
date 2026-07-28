import type { IBrainTileDef, RuleSide } from "@mindcraft-lang/core/brain";
import type { BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

/** How the armed target consumes the chosen tile: append to a side, insert before a tile, or replace a tile. */
export type ArmedTargetMode = "append" | "insert" | "replace";

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
  /** Receives the chosen tile; returns true when the selection completed and the picker should close. */
  onTileSelected: (tileDef: IBrainTileDef) => boolean;
}

/** Arm/disarm surface shared through {@link ArmedTargetProvider}. */
export interface ArmedTargetController {
  /** The currently armed target, or null when no picker target is armed. */
  target: ArmedTileTarget | null;
  /** Arm the given target, replacing any previously armed one. */
  arm(target: ArmedTileTarget): void;
  /** Clear the armed target. */
  disarm(): void;
}

const noopController: ArmedTargetController = {
  target: null,
  arm: () => {},
  disarm: () => {},
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
  const arm = useCallback((next: ArmedTileTarget) => setTarget(next), []);
  const disarm = useCallback(() => setTarget(null), []);
  return useMemo(() => ({ target, arm, disarm }), [target, arm, disarm]);
}

/** True when `target` arms the append picker for `ruleDef`. */
export function isAppendTargetForRule(target: ArmedTileTarget | null, ruleDef: BrainRuleDef): boolean {
  return target !== null && target.mode === "append" && target.ruleDef === ruleDef;
}

/** True when `target` arms the insert or replace picker for the tile at `tileIndex` on `side` of `ruleDef`. */
export function isTileTargetForTile(
  target: ArmedTileTarget | null,
  ruleDef: BrainRuleDef,
  side: RuleSide,
  tileIndex: number
): boolean {
  return (
    target !== null &&
    (target.mode === "insert" || target.mode === "replace") &&
    target.ruleDef === ruleDef &&
    target.side === side &&
    target.tileIndex === tileIndex
  );
}
