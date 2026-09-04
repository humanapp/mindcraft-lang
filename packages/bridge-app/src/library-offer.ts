import type { ExtensionActionResult } from "./extension-catalog.js";
import { ExtensionActionResultCode } from "./extension-catalog.js";
import type { ExtensionInstallReport } from "./extension-install.js";
import type { ExtensionTransactionToasts } from "./extension-report-presenter.js";
import { presentExtensionTransaction } from "./extension-report-presenter.js";

/**
 * What one attempt to install a reference answers: the app's own install
 * outcome, narrowed to what an offer needs of it. `ok: false` is an input the
 * app could not turn into an installable reference; `ok: true` carries the
 * extensions-map result and, when the map changed, the transaction's report.
 */
export type LibraryInstallAttempt =
  | {
      /** False: the reference did not resolve to something installable; nothing changed. */
      readonly ok: false;
      /** Stable code of the rejection. */
      readonly code: string;
      /** Human-readable failure message. */
      readonly message: string;
    }
  | {
      /** True: the reference resolved and the install action ran. */
      readonly ok: true;
      /** The extensions-map mutation result. */
      readonly action: ExtensionActionResult;
      /** The install transaction's report; absent when the action changed nothing. */
      readonly report?: ExtensionInstallReport;
    };

/**
 * The toast surface a library offer reports through: the two an extension
 * transaction always has, plus the note a commit that brought new problems with
 * it carries.
 */
export interface LibraryOfferToasts extends ExtensionTransactionToasts {
  /** The library was added, and new problems appeared with it. Names the library by display name. */
  worsened(libraryName: string): void;
}

/** The app-side pieces one library offer's install runs through. */
export interface LibraryOfferInstallSurface {
  /** The reference the app's approved catalog installs `coordinate` by; absent when it approves none. */
  readonly approvedReference: (coordinate: string) => string | undefined;
  /** Run the app's install transaction for `reference`. */
  readonly install: (reference: string) => Promise<LibraryInstallAttempt>;
  /** The display name the app reads `coordinate` by. */
  readonly displayName: (coordinate: string) => string;
  /** Where the attempt's outcome is presented. */
  readonly toasts: LibraryOfferToasts;
}

/**
 * Add the library at `coordinate` through the app's own install transaction and
 * present what happened through `surface.toasts`: a refusal as `failed`, a
 * commit as `confirmed`, and a commit that brought new problems with it as
 * `worsened` after the confirmation. A coordinate the app's catalog approves no
 * reference for is refused without running anything.
 *
 * Answers whether this attempt put the library in the project: `false` for a
 * refusal, for a failure, and for a library the project already held, which runs
 * no transaction and presents nothing.
 *
 * @param surface - The app's approved catalog, install transaction, display names, and toasts.
 * @param coordinate - The `<owner>/<repo>` coordinate to add.
 */
export async function addOfferedLibrary(surface: LibraryOfferInstallSurface, coordinate: string): Promise<boolean> {
  const reference = surface.approvedReference(coordinate);
  if (reference === undefined) {
    surface.toasts.failed({
      code: ExtensionActionResultCode.UNKNOWN_COORDINATE,
      message: `No approved library is shelved at "${coordinate}".`,
    });
    return false;
  }
  const attempt = await surface.install(reference);
  if (!attempt.ok) {
    surface.toasts.failed({ code: attempt.code, message: attempt.message });
    return false;
  }
  if (!attempt.action.ok) {
    if (attempt.action.code === ExtensionActionResultCode.ALREADY_INSTALLED) {
      return false;
    }
    surface.toasts.failed({ code: attempt.action.code, message: `Adding "${coordinate}" changed nothing.` });
    return false;
  }
  const libraryName = surface.displayName(coordinate);
  presentExtensionTransaction({ report: attempt.report, flavor: "install", libraryName, toasts: surface.toasts });
  if (attempt.report?.committed !== true) {
    return false;
  }
  if (attempt.report.outcome.kind === "worsened") {
    surface.toasts.worsened(libraryName);
  }
  return true;
}
