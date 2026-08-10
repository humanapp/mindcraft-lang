import type { BrainCommandHistory, BrainDef } from "@mindcraft-lang/core/brain/model";
import { createContext, type ReactNode, useContext } from "react";

/**
 * The brain a standing editor is editing: the working copy its rules are drawn
 * from and the history its edits run through.
 *
 * The working copy carries the source brain's id, so `brainDef.id()` names the
 * brain being edited. Both objects are the editor's own: a command run through
 * `history` changes what the editor shows, and the editor's undo takes it back.
 * They are replaced when the editor opens on another brain and are gone once it
 * closes.
 */
export interface EditedBrain {
  readonly brainDef: BrainDef;
  readonly history: BrainCommandHistory;
}

const EditedBrainContext = createContext<EditedBrain | undefined>(undefined);

/** Stands `value` as the brain being edited over the tree it wraps. */
export function EditedBrainProvider({ value, children }: { value: EditedBrain | undefined; children?: ReactNode }) {
  return <EditedBrainContext.Provider value={value}>{children}</EditedBrainContext.Provider>;
}

/**
 * The brain the standing editor is editing, or `undefined` where no editor
 * stands one -- outside an editor entirely, and while the editor holds no
 * working copy.
 */
export function useEditedBrain(): EditedBrain | undefined {
  return useContext(EditedBrainContext);
}
