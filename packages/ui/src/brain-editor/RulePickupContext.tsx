import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { RuleMoveDirection } from "./page-grid-model";

/** The rule the page holds picked up, and the steps it can take from where it stands now. */
export interface RulePickup {
  /** The rule being moved, as its `id()` names it. */
  readonly ruleId: number;
  /** The directions the rule can move in right now, read again after every step. */
  readonly directions: readonly RuleMoveDirection[];
}

/** The picked-up rule, shared through {@link RulePickupProvider}. */
export interface RulePickupController {
  /** The rule held right now, or null while none is. */
  pickup: RulePickup | null;
  /** Holds `pickup`, replacing whatever was held, or gives the held rule back with null. */
  setPickup(pickup: RulePickup | null): void;
}

const noopController: RulePickupController = {
  pickup: null,
  setPickup: () => {},
};

const RulePickupContext = createContext<RulePickupController>(noopController);

/** Provider for a {@link RulePickupController}. Defaults to a no-op controller when omitted. */
export const RulePickupProvider = RulePickupContext.Provider;

/** Read the current {@link RulePickupController} from context. */
export function useRulePickup(): RulePickupController {
  return useContext(RulePickupContext);
}

/** Build the picked-up-rule state owned by the editor dialog and shared via {@link RulePickupProvider}. */
export function useRulePickupState(): RulePickupController {
  const [pickup, setPickupState] = useState<RulePickup | null>(null);
  const setPickup = useCallback((next: RulePickup | null) => setPickupState(next), []);
  return useMemo(() => ({ pickup, setPickup }), [pickup, setPickup]);
}
