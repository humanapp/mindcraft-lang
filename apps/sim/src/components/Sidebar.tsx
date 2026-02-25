import { Button, Slider } from "@mindcraft-lang/ui";
import { useRef, useState } from "react";
import type { Archetype } from "@/brain/actor";
import { ARCHETYPES } from "@/brain/archetypes";
import type { ScoreSnapshot } from "@/brain/score";

const ARCHETYPE_COLORS: Record<string, string> = {
  carnivore: "#e63946",
  herbivore: "#f4a261",
  plant: "#52b788",
};

const ARCHETYPE_LABELS: Record<string, string> = {
  carnivore: "Carnivore",
  herbivore: "Herbivore",
  plant: "Plant",
};

const ARCHETYPES_LIST: Archetype[] = ["carnivore", "herbivore", "plant"];

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtNum(n: number): string {
  return n.toFixed(1);
}

export interface SidebarProps {
  snapshot: ScoreSnapshot | null;
  timeSpeed: number;
  onTimeSpeedChange: (speed: number) => void;
  onEditBrain: (archetype: Archetype) => void;
  onDesiredCountChange: (archetype: Archetype, count: number) => void;
  onToggleDebug: () => void;
  /** Whether the sidebar is open on mobile. Ignored on md+ screens. */
  isOpen?: boolean;
  /** Callback to close the sidebar on mobile. */
  onClose?: () => void;
}

export function Sidebar({
  snapshot,
  timeSpeed,
  onTimeSpeedChange,
  onEditBrain,
  onDesiredCountChange,
  onToggleDebug,
  isOpen,
  onClose,
}: SidebarProps) {
  const [desiredCounts, setDesiredCounts] = useState<Record<Archetype, number>>({
    carnivore: ARCHETYPES.carnivore.initialSpawnCount,
    herbivore: ARCHETYPES.herbivore.initialSpawnCount,
    plant: ARCHETYPES.plant.initialSpawnCount,
  });

  const desiredCountTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const updateDesiredCount = (archetype: Archetype, count: number) => {
    setDesiredCounts((prev) => ({ ...prev, [archetype]: count }));
    clearTimeout(desiredCountTimers.current[archetype]);
    desiredCountTimers.current[archetype] = setTimeout(() => {
      onDesiredCountChange(archetype, count);
    }, 200);
  };

  const totalDeaths = snapshot ? snapshot.carnivore.deaths + snapshot.herbivore.deaths + snapshot.plant.deaths : 0;

  return (
    <aside
      aria-label="Simulation dashboard"
      className={`fixed inset-y-0 right-0 z-50 w-64 border-l border-border bg-background flex flex-col transition-transform duration-200 ease-in-out md:static md:z-auto md:translate-x-0 md:shrink-0 ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Dashboard</h2>
          {snapshot && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Liveliness</span>
              <span className="font-mono tabular-nums text-sm font-semibold">{snapshot.ecosystemScore}</span>
            </div>
          )}
        </div>

        {/* Time Scale */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <span id="time-scale-label" className="text-xs font-medium">
              Time Scale
            </span>
            <span className="text-xs text-muted-foreground font-mono tabular-nums">{timeSpeed.toFixed(1)}x</span>
          </div>
          <Slider
            value={[timeSpeed]}
            onValueChange={([value]) => onTimeSpeedChange(value)}
            min={0}
            max={2}
            step={0.1}
            className="w-full"
            aria-label="Time scale"
          />
        </div>

        <div className="border-t border-border" />

        {/* Per-archetype sections */}
        {ARCHETYPES_LIST.map((arch) => {
          const s = snapshot?.[arch];
          const avgLife = s && s.deaths > 0 ? s.totalLifespan / s.deaths : 0;
          const avgEnergy = s && s.aliveCount > 0 ? s.totalEnergy / s.aliveCount : 0;
          return (
            // biome-ignore lint/a11y/useSemanticElements: fieldset would break layout; role="group" provides accessible grouping
            <div
              key={arch}
              className="space-y-2 rounded-lg bg-gray-900 p-2.5"
              role="group"
              aria-label={`${ARCHETYPE_LABELS[arch]} settings`}
            >
              {/* Archetype header */}
              <div className="flex items-center gap-1.5">
                <img
                  src={`/assets/brain/icons/${arch}.svg`}
                  alt={`${ARCHETYPE_LABELS[arch]} icon`}
                  className="w-5 h-5 mr-1"
                />
                <span className="text-sm font-medium" style={{ color: ARCHETYPE_COLORS[arch] }}>
                  {ARCHETYPE_LABELS[arch]}
                </span>
                {s && (
                  <span className="ml-auto font-mono tabular-nums text-xs text-muted-foreground">
                    {s.aliveCount} alive
                  </span>
                )}
              </div>

              {/* Stats */}
              {s && (
                <div className="text-xs text-muted-foreground grid grid-cols-3 gap-1">
                  <div className="flex flex-col">
                    <abbr title="average lifespan" className="no-underline">
                      avg
                    </abbr>
                    <span className="font-mono tabular-nums text-foreground/70">{fmtNum(avgLife)}s</span>
                  </div>
                  <div className="flex flex-col">
                    <span>best</span>
                    <span className="font-mono tabular-nums text-foreground/70">{fmtNum(s.longestLife)}s</span>
                  </div>
                  <div className="flex flex-col">
                    <abbr title="average energy" className="no-underline">
                      nrg
                    </abbr>
                    <span className="font-mono tabular-nums text-foreground/70">{Math.round(avgEnergy)}</span>
                  </div>
                </div>
              )}

              {/* Population slider */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Population</span>
                  <span className="text-xs text-muted-foreground font-mono tabular-nums">{desiredCounts[arch]}</span>
                </div>
                <Slider
                  value={[desiredCounts[arch]]}
                  onValueChange={([value]) => updateDesiredCount(arch, value)}
                  min={0}
                  max={100}
                  step={1}
                  className="w-full"
                  aria-label={`${ARCHETYPE_LABELS[arch]} population`}
                />
              </div>

              {/* Brain edit button */}
              <Button
                onClick={() => {
                  onEditBrain(arch);
                  onClose?.();
                }}
                variant="outline"
                size="sm"
                className="w-full h-7 text-xs border-slate-600"
                aria-label={`Edit ${ARCHETYPE_LABELS[arch]} brain`}
              >
                Edit Brain
              </Button>
            </div>
          );
        })}

        <div className="border-t border-border" />

        {/* Footer stats */}
        {snapshot && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">{fmtTime(snapshot.elapsed)}</span>
            <span>{totalDeaths} deaths</span>
          </div>
        )}

        {/* Debug toggle */}
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
