import type { BrainDiagnosticEntry } from "@wendoo/bridge-app";
import { ChevronDown, ChevronRight, CircleAlert } from "lucide-react";
import { ConsoleOutputList } from "./ConsoleOutputList";

/** The expanded-set after toggling one brain's diagnostics list: removes a present key, adds an absent one. */
export function toggledBrainKey(expanded: ReadonlySet<string>, brainKey: string): ReadonlySet<string> {
  const next = new Set(expanded);
  if (next.has(brainKey)) {
    next.delete(brainKey);
  } else {
    next.add(brainKey);
  }
  return next;
}

interface BrainErrorBadgeProps {
  /** Number of error diagnostics the badge reports. */
  count: number;
  /** Whether the diagnostics list below the row is expanded. */
  expanded: boolean;
  /** Toggles the diagnostics list. */
  onToggle: () => void;
  /** Display name of the brain, for the accessible label. */
  brainName: string;
}

/** Error badge on a brain entry: an icon, the error count, and the chevron toggling the diagnostics list. */
export function BrainErrorBadge({ count, expanded, onToggle, brainName }: BrainErrorBadgeProps) {
  return (
    <button
      type="button"
      data-testid="brain-error-badge"
      aria-expanded={expanded}
      aria-label={`Problems in ${brainName}`}
      className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-destructive hover:bg-muted"
      onClick={onToggle}
    >
      <CircleAlert aria-hidden="true" className="h-3.5 w-3.5" />
      <span data-testid="brain-error-count">{count}</span>
      {expanded ? (
        <ChevronDown aria-hidden="true" className="h-3 w-3" />
      ) : (
        <ChevronRight aria-hidden="true" className="h-3 w-3" />
      )}
    </button>
  );
}

interface BrainDiagnosticsListProps {
  /** The diagnostics to list, one row each. */
  diagnostics: readonly BrainDiagnosticEntry[];
}

/**
 * The expanded diagnostics list below a brain entry: one console-style row
 * per diagnostic, on the shared console-output control capped at about five
 * single-line rows.
 */
export function BrainDiagnosticsList({ diagnostics }: BrainDiagnosticsListProps) {
  return (
    <ConsoleOutputList
      testId="brain-diagnostics"
      rowTestId="brain-diagnostic-row"
      maxVisibleRows={5}
      className="rounded"
      rows={diagnostics.map((diagnostic) => ({ location: diagnostic.location, message: diagnostic.message }))}
    />
  );
}
