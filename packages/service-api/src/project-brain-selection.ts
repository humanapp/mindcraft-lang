import type { MindcraftProjectDocument } from "./project-document.js";

/** Selection code constants used by shared project brain selection diagnostics. */
export const MindcraftProjectBrainSelectionCode = {
  NO_BRAINS: "MINDCRAFT_PROJECT_BRAIN_NO_BRAINS",
  MISSING_BRAIN_SELECTOR: "MINDCRAFT_PROJECT_BRAIN_MISSING_SELECTOR",
  BRAIN_NOT_FOUND: "MINDCRAFT_PROJECT_BRAIN_NOT_FOUND",
  AMBIGUOUS_BRAIN_SELECTOR: "MINDCRAFT_PROJECT_BRAIN_AMBIGUOUS_SELECTOR",
  INVALID_SELECTED_BRAIN_DOCUMENT: "MINDCRAFT_PROJECT_BRAIN_INVALID_DOCUMENT",
} as const;

/** Union of all {@link MindcraftProjectBrainSelectionCode} values. */
export type MindcraftProjectBrainSelectionCode =
  (typeof MindcraftProjectBrainSelectionCode)[keyof typeof MindcraftProjectBrainSelectionCode];

/** Selector for a brain stored in a shared Mindcraft project document. */
export type MindcraftProjectBrainSelector =
  | {
      /** Select a brain by its project document key. */
      readonly kind: "id";

      /** Brain key under `document.brains`. */
      readonly id: string;
    }
  | {
      /** Select a brain by its serialized display name. */
      readonly kind: "name";

      /** Brain display name stored on the serialized brain document. */
      readonly name: string;
    };

/** Selected serialized brain from a shared Mindcraft project document. */
export interface MindcraftProjectSelectedBrain {
  /** Brain key under `document.brains`. */
  readonly id: string;

  /** Brain display name when the serialized document carries one. */
  readonly name?: string;

  /** Serialized brain definition payload. */
  readonly document: Readonly<Record<string, unknown>>;
}

/** Selection diagnostic for a rejected shared project brain selection. */
export interface MindcraftProjectBrainSelectionError {
  /** Stable machine-readable selection code. */
  readonly code: MindcraftProjectBrainSelectionCode;

  /** JSON path of the rejected field. */
  readonly path: string;

  /** Human-readable diagnostic message. */
  readonly message: string;
}

/** Result of selecting a serialized brain from a shared project document. */
export type MindcraftProjectBrainSelectionResult =
  | {
      /** True when a brain was selected. */
      readonly ok: true;

      /** Selected serialized brain. */
      readonly brain: MindcraftProjectSelectedBrain;

      /** Empty diagnostics list for a valid selection. */
      readonly errors: readonly [];
    }
  | {
      /** False when selection failed. */
      readonly ok: false;

      /** Selection diagnostics. */
      readonly errors: readonly MindcraftProjectBrainSelectionError[];
    };

/**
 * Selects a serialized brain from a shared Mindcraft project document.
 *
 * @param document - Project document returned by shared project validation.
 * @param selector - Brain selector. Omit only when the project contains one brain.
 */
export function selectMindcraftProjectBrain(
  document: MindcraftProjectDocument,
  selector?: MindcraftProjectBrainSelector
): MindcraftProjectBrainSelectionResult {
  const entries = Object.entries(document.brains);
  if (entries.length === 0) {
    return selectionError(
      MindcraftProjectBrainSelectionCode.NO_BRAINS,
      "$.brains",
      "Project document does not contain any brains."
    );
  }

  if (selector === undefined) {
    if (entries.length > 1) {
      return selectionError(
        MindcraftProjectBrainSelectionCode.MISSING_BRAIN_SELECTOR,
        "$.brains",
        "Project document contains multiple brains and requires a selector."
      );
    }
    const [id, brainDocument] = entries[0]!;
    return selectedBrainResult(id, brainDocument);
  }

  if (selector.kind === "id") {
    const brainDocument = document.brains[selector.id];
    if (brainDocument === undefined) {
      return selectionError(
        MindcraftProjectBrainSelectionCode.BRAIN_NOT_FOUND,
        "$.brains",
        `Project document does not contain brain id "${selector.id}".`
      );
    }
    return selectedBrainResult(selector.id, brainDocument);
  }

  const matches = entries.filter(([, brainDocument]) => getBrainName(brainDocument) === selector.name);
  if (matches.length === 0) {
    return selectionError(
      MindcraftProjectBrainSelectionCode.BRAIN_NOT_FOUND,
      "$.brains",
      `Project document does not contain brain name "${selector.name}".`
    );
  }
  if (matches.length > 1) {
    return selectionError(
      MindcraftProjectBrainSelectionCode.AMBIGUOUS_BRAIN_SELECTOR,
      "$.brains",
      `Project document contains multiple brains named "${selector.name}".`
    );
  }

  const [id, brainDocument] = matches[0]!;
  return selectedBrainResult(id, brainDocument);
}

function selectedBrainResult(id: string, brainDocument: unknown): MindcraftProjectBrainSelectionResult {
  if (!isRecord(brainDocument)) {
    return selectionError(
      MindcraftProjectBrainSelectionCode.INVALID_SELECTED_BRAIN_DOCUMENT,
      brainPath(id),
      "Selected brain document must be an object."
    );
  }

  const name = getBrainName(brainDocument);
  return {
    ok: true,
    brain: {
      id,
      ...(name !== undefined ? { name } : {}),
      document: brainDocument,
    },
    errors: [],
  };
}

function selectionError(
  code: MindcraftProjectBrainSelectionCode,
  path: string,
  message: string
): MindcraftProjectBrainSelectionResult {
  return {
    ok: false,
    errors: [
      {
        code,
        path,
        message,
      },
    ],
  };
}

function getBrainName(brainDocument: unknown): string | undefined {
  if (!isRecord(brainDocument)) {
    return undefined;
  }
  return typeof brainDocument.name === "string" ? brainDocument.name : undefined;
}

function brainPath(id: string): string {
  return `$.brains[${JSON.stringify(id)}]`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
