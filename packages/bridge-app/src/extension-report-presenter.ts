import type { ExtensionInstallReport } from "./extension-install.js";

/**
 * The kind of transaction a report is presented for: `install` and `uninstall`
 * act on one named library; `refresh` re-runs the current map (retry, update,
 * or load-time move application) and names no single library.
 */
export type ExtensionTransactionFlavor = "install" | "uninstall" | "refresh";

/**
 * The toast surface an extension transaction reports through. Payloads carry
 * concept-level data only -- a display name, a stable code -- and never
 * diagnostics.
 */
export interface ExtensionTransactionToasts {
  /** The transaction was refused; nothing changed. Carries the refusal's stable code when it has one. */
  failed(refusal: { code?: string; message: string }): void;
  /** The transaction committed; names the affected library by display name. */
  confirmed(libraryName: string): void;
}

/**
 * Present an extension transaction's report through a toast surface. A refusal
 * surfaces as `failed`. A commit of an `install` or `uninstall` transaction
 * confirms with the library's display name; a `refresh` commit presents
 * nothing. A commit toasts nothing about its outcome in either direction:
 * standing problems and their resolution live on the brain badges.
 *
 * @param options.report - The transaction's report; absent presents nothing.
 * @param options.flavor - The transaction kind.
 * @param options.libraryName - Display name of the affected library; required for install and uninstall.
 * @param options.toasts - The toast surface to present through.
 */
export function presentExtensionTransaction(options: {
  report: ExtensionInstallReport | undefined;
  flavor: ExtensionTransactionFlavor;
  libraryName?: string;
  toasts: ExtensionTransactionToasts;
}): void {
  const { report, flavor, toasts } = options;
  if (!report) {
    return;
  }
  if (!report.committed) {
    const refusal = report.refusal;
    switch (refusal.kind) {
      case "fetch":
        toasts.failed({ code: refusal.error.code, message: refusal.error.message });
        break;
      case "store":
        toasts.failed({ code: refusal.code, message: refusal.message });
        break;
      case "cycle":
        toasts.failed({ message: refusal.message });
        break;
    }
    return;
  }
  if (flavor !== "refresh") {
    toasts.confirmed(options.libraryName ?? "");
  }
}
