import { locateRules } from "@wendoo/assistant-bridge";
import type { BrainDef } from "@wendoo/core/brain/model";
import type { EditedBrain, EditedBrainPlace } from "@wendoo/ui/brain-editor/EditedBrainContext";
import { createContext, type ReactNode, useContext } from "react";
import type { EditedBrainWorkspaces } from "../app/edited-brain-workspaces";

/** Where one rule of the document stands. */
export interface RulePlace {
  /** Durable id of the page the rule stands on. */
  readonly pageId: string;
  /** The rule's position on that page, counting the rules nested under others in the same sequence. */
  readonly line: number;
}

/**
 * What the host tells the panel about where the things the assistant names stand,
 * so the panel can read a rule by its number and show one the person taps. Build
 * one with {@link brainPlacesOf}.
 */
export interface BrainPlaces {
  /**
   * Where `ruleId` stands in the document as it is right now; `undefined` for a
   * rule the document no longer holds, and for one standing on no page.
   */
  readonly locateRule: (ruleId: string) => RulePlace | undefined;
  /** Show `place` in the editor, recording the person's reaching for it as their own. */
  readonly reveal: (place: EditedBrainPlace) => void;
}

/**
 * Where `ruleId` stands in `brainDef`: its page, and its position there counted
 * over the page's rules in document order, the rules nested under others counted
 * in the same sequence.
 */
function rulePlaceIn(brainDef: BrainDef, ruleId: string): RulePlace | undefined {
  let onPageId: string | undefined;
  let line = 0;
  for (const located of locateRules(brainDef)) {
    const pageId = located.rule.page()?.pageId();
    if (pageId === undefined) continue;
    if (pageId !== onPageId) {
      onPageId = pageId;
      line = 0;
    }
    line++;
    if (located.ruleId === ruleId) return { pageId, line };
  }
  return undefined;
}

/**
 * The places the brain `edited` stands holds, read from its working copy each
 * time they are asked for, so a document edited since still answers correctly.
 * Answers `undefined` where no editor stands a working copy, which leaves every
 * rule unplaced and nothing to show.
 */
export function brainPlacesOf(
  edited: EditedBrain | undefined,
  workspaces: EditedBrainWorkspaces
): BrainPlaces | undefined {
  if (edited === undefined) return undefined;
  const { brainDef, reveal } = edited;
  return {
    locateRule: (ruleId: string): RulePlace | undefined => rulePlaceIn(brainDef, ruleId),
    reveal: (place: EditedBrainPlace): void => {
      workspaces.notePersonInteraction(brainDef.id());
      reveal(place);
    },
  };
}

const BrainPlacesContext = createContext<BrainPlaces | undefined>(undefined);

/** Stands `value` as where the transcript reads the document's places from, over the tree it wraps. */
export function BrainPlacesProvider({ value, children }: { value: BrainPlaces | undefined; children?: ReactNode }) {
  return <BrainPlacesContext.Provider value={value}>{children}</BrainPlacesContext.Provider>;
}

/**
 * Where the document's places stand, against the brain the host stands. Answers
 * `undefined` where the host stands none, which places no rule and shows
 * nothing.
 */
export function useBrainPlaces(): BrainPlaces | undefined {
  return useContext(BrainPlacesContext);
}
