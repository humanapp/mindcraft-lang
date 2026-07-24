/** One row of a console-output list: a location prefix and the message text. */
export interface ConsoleOutputRow {
  /** Location prefix rendered before the message (a rule path, a `path:line:col`). */
  readonly location: string;
  /** The message text; wraps in full, never truncated. */
  readonly message: string;
}

interface ConsoleOutputListProps {
  /** The rows to list, in order. */
  rows: readonly ConsoleOutputRow[];
  /** Maximum visible single-line rows before the region scrolls. */
  maxVisibleRows: 5 | 10;
  /** Test id of the list container. */
  testId: string;
  /** Test id of each row. */
  rowTestId: string;
  /** Additional container classes for per-surface framing. */
  className?: string;
}

/**
 * Console-output list: dense monospace rows on the console surface, selectable
 * for copying. Messages line-wrap in full; the region has a fixed maximum
 * height of `maxVisibleRows` single-line rows and scrolls beyond it, so a
 * long list never pushes the page further.
 */
export function ConsoleOutputList({ rows, maxVisibleRows, testId, rowTestId, className }: ConsoleOutputListProps) {
  const heightClass = maxVisibleRows === 10 ? "max-h-80" : "max-h-40";
  return (
    <ul
      data-testid={testId}
      data-maxrows={maxVisibleRows}
      className={`${heightClass} select-text overflow-y-auto bg-background px-2 py-1 font-mono text-xs leading-5 text-muted-foreground ${className ?? ""}`}
    >
      {rows.map((row, index) => (
        <li
          // Console rows carry no identity; the stable key is their position.
          // biome-ignore lint/suspicious/noArrayIndexKey: rows re-render as one unit
          key={index}
          data-testid={rowTestId}
          className="wrap-break-word py-0.5"
        >
          <span className="text-foreground/80">{row.location}:</span> {row.message}
        </li>
      ))}
    </ul>
  );
}
