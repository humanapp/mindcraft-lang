import type { AuthoringWorkspace, TargetAdapter } from "@mindcraft-lang/assistant-bridge";
import { sessionTileDescriptions } from "@mindcraft-lang/assistant-bridge";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { List } from "@mindcraft-lang/core/app";
import type { ITileCatalog } from "@mindcraft-lang/core/brain";
import type { EditedBrain } from "@mindcraft-lang/ui/brain-editor/EditedBrainContext";

/** Why a brain's tool calls found no working copy of it to run against. */
export const NoEditedBrainCode = {
  /** No editor stands a working copy at all. */
  NoEditorOpen: "no_editor_open",
  /** The working copy standing belongs to another brain. */
  AnotherBrainEdited: "another_brain_edited",
} as const;

/** Why a brain's tool calls found no working copy of it to run against. */
export type NoEditedBrainCode = (typeof NoEditedBrainCode)[keyof typeof NoEditedBrainCode];

/**
 * Raised when a workspace is asked for a brain no editor is editing. Carries
 * the code naming which case it was and the brain that was asked for.
 */
export class NoEditedBrain extends Error {
  constructor(
    readonly code: NoEditedBrainCode,
    /** The brain whose tool calls asked for a workspace. */
    readonly brainId: string
  ) {
    super(`${code}: ${brainId}`);
    this.name = "NoEditedBrain";
  }
}

/** What the workspaces are built over. */
export interface EditedBrainWorkspacesOptions {
  /** The environment the edited brains belong to, whose catalogs the workspaces resolve tiles against. */
  readonly environment: MindcraftEnvironment;
  /** The target the workspaces rehearse through. */
  readonly adapter: TargetAdapter;
}

/** The workspace accessor, and the seam the standing working copy reaches it through. */
export interface EditedBrainWorkspaces {
  /**
   * The workspace `brainId`'s tool calls run against: the working copy standing
   * right now and the history the editor's own undo runs through, so an edit
   * served through it is an entry the child can take back. Throws
   * {@link NoEditedBrain} while no editor stands `brainId`'s working copy.
   *
   * One function for the life of the app: it dereferences the working copy on
   * every call, so a holder that read it once still reaches the current one.
   */
  readonly workspaceFor: (brainId: string) => AuthoringWorkspace;
  /** Stand `edited` as the brain being edited, and `undefined` once no editor stands one. */
  readonly setEditedBrain: (edited: EditedBrain | undefined) => void;
}

/**
 * Build the workspaces a host app serves an assistant's tool calls through. The
 * working copy they run against is whatever the editor stands at the time of
 * the call.
 */
export function createEditedBrainWorkspaces(options: EditedBrainWorkspacesOptions): EditedBrainWorkspaces {
  const { environment, adapter } = options;
  const descriptions = sessionTileDescriptions(adapter.tileDocs());
  let edited: EditedBrain | undefined;

  return {
    workspaceFor: (brainId: string): AuthoringWorkspace => {
      if (edited === undefined) throw new NoEditedBrain(NoEditedBrainCode.NoEditorOpen, brainId);
      const { brainDef, history } = edited;
      if (brainDef.id() !== brainId) throw new NoEditedBrain(NoEditedBrainCode.AnotherBrainEdited, brainId);
      return {
        environment,
        brainDef,
        history,
        catalogs: List.from<ITileCatalog>([...environment.tileCatalogs(), brainDef.catalog()]),
        descriptions,
        adapter,
      };
    },
    setEditedBrain: (next: EditedBrain | undefined): void => {
      edited = next;
    },
  };
}
