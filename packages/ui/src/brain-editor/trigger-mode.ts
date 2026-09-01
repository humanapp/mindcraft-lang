import type { ReadonlyList } from "@wendoo/core";
import { RuleTriggerMode } from "@wendoo/core/brain";
import type { Localizer } from "@wendoo/core/localization";

/** Context tag the trigger-mode switch's own display words are looked up under. */
export const kTriggerModeContext = "rule-trigger-mode";

/** The word each mode is switched by, in the case it is read out in. */
const kModeWords: Record<RuleTriggerMode, string> = {
  [RuleTriggerMode.When]: "When",
  [RuleTriggerMode.Otherwise]: "Else",
  [RuleTriggerMode.Then]: "Then",
};

const kSwitchNameTemplate = "Trigger mode: {mode}";
const kInvalidSwitchNameTemplate = "Trigger mode: {mode}, not allowed here";
const kChangeAnnouncementTemplate = "Trigger mode {mode}";

/**
 * What the trigger capsule offers on a rule:
 *
 * - `switchable` -- the rule's position admits its mode and at least one other
 * - `invalid` -- the position does not admit the mode the rule carries, which a
 *   structural move can leave behind; the switch steps out of it
 * - `fixed` -- the position admits the rule's mode and no other, so the capsule
 *   offers no choice and stands as a static marker
 */
export type TriggerSwitchState = "switchable" | "invalid" | "fixed";

/** The states a capsule offering a choice of mode stands in, which are the ones it cycles from. */
export type TriggerCyclingState = Exclude<TriggerSwitchState, "fixed">;

/**
 * The state a switch stands in for a rule carrying `current` at a position
 * admitting `available`.
 *
 * Pass the modes `availableTriggerModes` answers for the rule. A switch reads
 * `fixed` only where the rule's own mode is the single admitted one, so a rule
 * can always be switched out of a mode its position rejects.
 */
export function triggerSwitchState(
  current: RuleTriggerMode,
  available: ReadonlyList<RuleTriggerMode>
): TriggerSwitchState {
  if (!available.contains(current)) {
    return "invalid";
  }
  return available.size() > 1 ? "switchable" : "fixed";
}

/**
 * The word the capsule stands for `mode` in the locale `localizer` renders,
 * cased as it is read out and not uppercased.
 */
export function triggerModeLabel(mode: RuleTriggerMode, localizer: Localizer): string {
  return localizer.tr(kModeWords[mode], undefined, kTriggerModeContext);
}

/**
 * The accessible name the switch carries in `state`: the mode it stands at, or
 * that same mode named as one this position rejects.
 */
export function triggerSwitchName(mode: RuleTriggerMode, state: TriggerCyclingState, localizer: Localizer): string {
  const source = state === "invalid" ? kInvalidSwitchNameTemplate : kSwitchNameTemplate;
  return localizer.tr(source, { mode: triggerModeLabel(mode, localizer) }, kTriggerModeContext);
}

/** The line a polite live region reads out when the switch settles on `mode`. */
export function triggerModeAnnouncement(mode: RuleTriggerMode, localizer: Localizer): string {
  return localizer.tr(kChangeAnnouncementTemplate, { mode: triggerModeLabel(mode, localizer) }, kTriggerModeContext);
}

/**
 * The mode one step forward around `available` reaches from `current`, wrapping
 * at the end. A `current` that `available` does not offer -- a rule whose
 * position has just stopped admitting its mode -- steps to the first mode
 * `available` offers.
 *
 * Pass the modes `availableTriggerModes` answers for the rule, which is never
 * empty.
 */
export function nextTriggerMode(current: RuleTriggerMode, available: ReadonlyList<RuleTriggerMode>): RuleTriggerMode {
  const count = available.size();
  let index = -1;
  for (let i = 0; i < count; i++) {
    if (available.get(i) === current) {
      index = i;
      break;
    }
  }
  if (index < 0) {
    return available.get(0);
  }
  return available.get((index + 1) % count);
}
