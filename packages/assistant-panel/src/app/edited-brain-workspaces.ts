import type {
  AuthoringWorkspace,
  BrainEditHistory,
  CatalogFeaturing,
  LibraryShelfEntry,
  TargetAdapter,
} from "@wendoo/assistant-bridge";
import { scopedCatalogs, sessionTileDocs } from "@wendoo/assistant-bridge";
import type { WendooEnvironment } from "@wendoo/core/app";
import type { BrainCommandHistory } from "@wendoo/core/brain/model";
import { BrainEditOrigin } from "@wendoo/core/brain/model";
import type { EditedBrain } from "@wendoo/ui/brain-editor/EditedBrainContext";
import type { LibraryOffers } from "../conversation/library-offers";
import type { PersonActivity } from "./person-activity";
import { watchPersonInteraction } from "./person-activity";

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
  readonly environment: WendooEnvironment;
  /** The target the workspaces rehearse through. */
  readonly adapter: TargetAdapter;
  /**
   * Which libraries the app features. Called each time a workspace is handed
   * out, and the value it returns is the featuring that workspace carries.
   * Absent features none, which leaves every bundle tile's long-form
   * documentation withheld.
   */
  readonly featuring?: () => CatalogFeaturing;
  /**
   * The libraries the app approves for the project being edited. Carried onto
   * every workspace handed out and called by the tool that reads the shelf, so
   * a project switched to since the last call is the one it answers from.
   * Absent leaves the shelf empty.
   */
  readonly libraryShelf?: () => readonly LibraryShelfEntry[];
  /**
   * Add the library at `coordinate` to the project through the app's own
   * install, called once per tap on a library the assistant offered. The app
   * reports the outcome itself and answers whether this attempt put the library
   * in the project, which a refusal, a failure, and a library the project
   * already held all answer `false`. Absent leaves every offer inert.
   */
  readonly installLibrary?: (coordinate: string) => Promise<boolean>;
  /**
   * Where the person's own acting on the edited brain is recorded, and read
   * from to leave the view alone while they are working. Absent leaves every
   * landed edit bringing its rule into view and records nothing.
   */
  readonly activity?: PersonActivity;
  /**
   * The document the person's acting on the rules is watched in; read from the
   * global `document` when absent, and watched by nobody where there is none.
   */
  readonly doc?: Document;
}

/** The workspace accessor, and the seam the standing working copy reaches it through. */
export interface EditedBrainWorkspaces {
  /**
   * The workspace `brainId`'s tool calls run against: the working copy standing
   * right now, the history the editor's own undo runs through, so an edit
   * served through it is an entry the child can take back, and the editor's own
   * reveal, which each landed edit brings its rule into view through. Throws
   * {@link NoEditedBrain} while no editor stands `brainId`'s working copy.
   *
   * One function for the life of the app: it dereferences the working copy on
   * every call, so a holder that read it once still reaches the current one.
   */
  readonly workspaceFor: (brainId: string) => AuthoringWorkspace;
  /**
   * Stand `edited` as the brain being edited, and `undefined` once no editor
   * stands one. The brain standing is the one whose rules the person's acting
   * is watched on and whose document changes are recorded.
   */
  readonly setEditedBrain: (edited: EditedBrain | undefined) => void;
  /**
   * Record the person acting on `brainId`'s rules from somewhere the rules
   * region does not watch, which leaves the view alone for as long as their own
   * acting on it does. Changes no document, so a turn keeps running.
   */
  readonly notePersonInteraction: (brainId: string) => void;
  /**
   * The shelf the libraries the assistant offers are drawn against, and the
   * app's own install a tap on one runs. `undefined` where the app carried no
   * shelf or no install, which leaves every offer inert.
   */
  readonly libraryOffers: LibraryOffers | undefined;
}

/**
 * The history a tool call reaches `history` through, with every change it makes
 * reported as the tool's. Each call is marked on its own, so a change the
 * person makes while a call is waiting on something is still theirs.
 */
function toolEditHistory(history: BrainCommandHistory): BrainEditHistory {
  const asTool = (work: () => void): void => history.runAs(BrainEditOrigin.Tool, work);
  return {
    executeCommand: (command) => asTool(() => history.executeCommand(command)),
    beginBatch: (description) => asTool(() => history.beginBatch(description)),
    endBatch: () => asTool(() => history.endBatch()),
    abortBatch: () => asTool(() => history.abortBatch()),
    undo: () => asTool(() => history.undo()),
    redo: () => asTool(() => history.redo()),
    clear: () => asTool(() => history.clear()),
    undoDepth: () => history.undoDepth(),
    getUndoDescription: () => history.getUndoDescription(),
    onChange: (callback) => history.onChange(callback),
  };
}

/**
 * Build the workspaces a host app serves an assistant's tool calls through. The
 * working copy they run against is whatever the editor stands at the time of
 * the call.
 */
export function createEditedBrainWorkspaces(options: EditedBrainWorkspacesOptions): EditedBrainWorkspaces {
  const { environment, adapter, activity, featuring, libraryShelf, installLibrary } = options;
  const doc = options.doc ?? (typeof document === "undefined" ? undefined : document);
  const docs = sessionTileDocs(adapter.tileDocs());
  let edited: EditedBrain | undefined;
  // What the brain standing right now is being watched through, released as
  // soon as another brain stands or none does.
  let stopWatching: (() => void) | undefined;

  const watch = (next: EditedBrain | undefined): void => {
    stopWatching?.();
    stopWatching = undefined;
    if (activity === undefined || next === undefined) return;
    const brainId = next.brainDef.id();
    const stopListening = next.history.onChange((origin) => {
      if (origin === BrainEditOrigin.Person) activity.noteMutation(brainId);
    });
    const stopInteractions = doc === undefined ? undefined : watchPersonInteraction(activity, brainId, doc);
    stopWatching = () => {
      stopListening();
      stopInteractions?.();
    };
  };

  return {
    workspaceFor: (brainId: string): AuthoringWorkspace => {
      if (edited === undefined) throw new NoEditedBrain(NoEditedBrainCode.NoEditorOpen, brainId);
      const { brainDef, history, reveal } = edited;
      if (brainDef.id() !== brainId) throw new NoEditedBrain(NoEditedBrainCode.AnotherBrainEdited, brainId);
      return {
        environment,
        brainDef,
        history: toolEditHistory(history),
        catalogs: scopedCatalogs(environment, brainDef),
        descriptions: docs.descriptions,
        assistantSections: docs.assistantSections,
        ...(featuring ? { featuring: featuring() } : {}),
        ...(libraryShelf ? { libraryShelf } : {}),
        adapter,
        onEditLanded: (landed) => {
          if (activity?.isInteracting(brainId) === true) return;
          reveal(landed);
        },
      };
    },
    setEditedBrain: (next: EditedBrain | undefined): void => {
      edited = next;
      watch(next);
    },
    notePersonInteraction: (brainId: string): void => {
      activity?.noteInteraction(brainId);
    },
    libraryOffers:
      libraryShelf === undefined || installLibrary === undefined
        ? undefined
        : {
            entryFor: (coordinate: string) => libraryShelf().find((entry) => entry.coordinate === coordinate),
            install: installLibrary,
          },
  };
}
