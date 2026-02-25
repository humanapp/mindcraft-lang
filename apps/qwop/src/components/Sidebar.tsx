import { Button } from "@mindcraft-lang/ui";

export interface SidebarProps {
  distance: number;
  highScore: number;
  attempts: number;
  fallen: boolean;
  onEditBrain: () => void;
  onReset: () => void;
  onToggleDebug: () => void;
  isOpen?: boolean;
  onClose?: () => void;
}

function fmtDist(m: number): string {
  return `${m.toFixed(1)}m`;
}

export function Sidebar({
  distance,
  highScore,
  attempts,
  fallen,
  onEditBrain,
  onReset,
  onToggleDebug,
  isOpen,
  onClose,
}: SidebarProps) {
  return (
    <aside
      aria-label="QWOP dashboard"
      className={`fixed inset-y-0 right-0 z-50 w-64 border-l border-border bg-background flex flex-col transition-transform duration-200 ease-in-out md:static md:z-auto md:translate-x-0 md:shrink-0 ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">QWOP</h2>
        </div>

        {/* Stats */}
        <div className="space-y-2 rounded-lg bg-gray-900 p-2.5">
          <div className="text-xs text-muted-foreground grid grid-cols-2 gap-2">
            <div className="flex flex-col">
              <span>Distance</span>
              <span className="font-mono tabular-nums text-foreground/70 text-sm">{fmtDist(distance)}</span>
            </div>
            <div className="flex flex-col">
              <span>Best</span>
              <span className="font-mono tabular-nums text-foreground/70 text-sm">{fmtDist(highScore)}</span>
            </div>
            <div className="flex flex-col">
              <span>Attempts</span>
              <span className="font-mono tabular-nums text-foreground/70 text-sm">{attempts}</span>
            </div>
            <div className="flex flex-col">
              <span>Status</span>
              <span className={`font-mono tabular-nums text-sm ${fallen ? "text-red-400" : "text-green-400"}`}>
                {fallen ? "Fallen" : "Running"}
              </span>
            </div>
          </div>
        </div>

        {/* Controls legend */}
        <div className="space-y-2 rounded-lg bg-gray-900 p-2.5">
          <span className="text-xs font-medium text-muted-foreground">Controls</span>
          <div className="text-xs text-muted-foreground grid grid-cols-2 gap-1">
            <div>
              <kbd className="px-1 py-0.5 rounded bg-gray-700 text-foreground/80 font-mono text-xs">Q</kbd> Left thigh
            </div>
            <div>
              <kbd className="px-1 py-0.5 rounded bg-gray-700 text-foreground/80 font-mono text-xs">W</kbd> Right thigh
            </div>
            <div>
              <kbd className="px-1 py-0.5 rounded bg-gray-700 text-foreground/80 font-mono text-xs">O</kbd> Left calf
            </div>
            <div>
              <kbd className="px-1 py-0.5 rounded bg-gray-700 text-foreground/80 font-mono text-xs">P</kbd> Right calf
            </div>
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Action buttons */}
        <Button
          onClick={() => {
            onEditBrain();
            onClose?.();
          }}
          variant="outline"
          size="sm"
          className="w-full text-xs border-slate-600"
          aria-label="Edit brain"
        >
          Edit Brain
        </Button>

        <Button
          onClick={onReset}
          variant="outline"
          size="sm"
          className="w-full text-xs border-slate-600"
          aria-label="Reset runner"
        >
          Reset
        </Button>

        <Button
          onClick={onToggleDebug}
          variant="outline"
          size="sm"
          className="w-full text-xs border-slate-600"
          aria-label="Toggle debug overlay"
        >
          Toggle Debug
        </Button>
      </div>

      {/* GitHub link */}
      <div className="border-t border-border p-3 flex justify-end">
        <a
          href="https://github.com/humanapp/mindcraft-lang"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="GitHub repository"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" role="img" aria-label="GitHub">
            <title>GitHub</title>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
      </div>
    </aside>
  );
}
