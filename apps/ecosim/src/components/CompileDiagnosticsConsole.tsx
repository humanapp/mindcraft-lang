import type { WorkspaceCompileDiagnostic } from "@wendoo-lang/bridge-app";
import { ConsoleOutputList } from "./ConsoleOutputList";

interface CompileDiagnosticsConsoleProps {
  /** The latest workspace compile's diagnostics; renders nothing when empty. */
  diagnostics: readonly WorkspaceCompileDiagnostic[];
}

/**
 * Workspace-compile diagnostics as console output for the bridge panel: one
 * row per diagnostic rendering `path:line:col` and the compiler message
 * verbatim, on the shared console-output control capped at about ten
 * single-line rows.
 */
export function CompileDiagnosticsConsole({ diagnostics }: CompileDiagnosticsConsoleProps) {
  if (diagnostics.length === 0) {
    return null;
  }
  return (
    <ConsoleOutputList
      testId="bridge-compile-diagnostics"
      rowTestId="bridge-compile-diagnostic-row"
      maxVisibleRows={10}
      className="rounded"
      rows={diagnostics.map((diagnostic) => ({
        location: `${diagnostic.path}:${diagnostic.range.startLine}:${diagnostic.range.startColumn}`,
        message: diagnostic.message,
      }))}
    />
  );
}
