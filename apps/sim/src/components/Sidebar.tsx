import { useRef, useState } from "react";
import type { Archetype } from "@/brain/actor";
import { ARCHETYPES } from "@/brain/archetypes";
import type { ScoreSnapshot } from "@/brain/score";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

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
}

export function Sidebar({
  snapshot,
  timeSpeed,
  onTimeSpeedChange,
  onEditBrain,
  onDesiredCountChange,
  onToggleDebug,
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
    <aside className="w-64 shrink-0 border-l border-border bg-background overflow-y-auto">
      <div className="p-3 space-y-3">
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
            {/* biome-ignore lint/a11y/noLabelWithoutControl: Radix Slider has no labelable id */}
            <label className="text-xs font-medium">Time Scale</label>
            <span className="text-xs text-muted-foreground font-mono tabular-nums">{timeSpeed.toFixed(1)}x</span>
          </div>
          <Slider
            value={[timeSpeed]}
            onValueChange={([value]) => onTimeSpeedChange(value)}
            min={0}
            max={2}
            step={0.1}
            className="w-full"
          />
        </div>

        <div className="border-t border-border" />

        {/* Per-archetype sections */}
        {ARCHETYPES_LIST.map((arch) => {
          const s = snapshot?.[arch];
          const avgLife = s && s.deaths > 0 ? s.totalLifespan / s.deaths : 0;
          const avgEnergy = s && s.aliveCount > 0 ? s.totalEnergy / s.aliveCount : 0;
          return (
            <div key={arch} className="space-y-2 rounded-lg bg-gray-900 p-2.5">
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
                    <span>avg</span>
                    <span className="font-mono tabular-nums text-foreground/70">{fmtNum(avgLife)}s</span>
                  </div>
                  <div className="flex flex-col">
                    <span>best</span>
                    <span className="font-mono tabular-nums text-foreground/70">{fmtNum(s.longestLife)}s</span>
                  </div>
                  <div className="flex flex-col">
                    <span>nrg</span>
                    <span className="font-mono tabular-nums text-foreground/70">{Math.round(avgEnergy)}</span>
                  </div>
                </div>
              )}

              {/* Population slider */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  {/* biome-ignore lint/a11y/noLabelWithoutControl: Radix Slider has no labelable id */}
                  <label className="text-xs text-muted-foreground">Population</label>
                  <span className="text-xs text-muted-foreground font-mono tabular-nums">{desiredCounts[arch]}</span>
                </div>
                <Slider
                  value={[desiredCounts[arch]]}
                  onValueChange={([value]) => updateDesiredCount(arch, value)}
                  min={0}
                  max={100}
                  step={1}
                  className="w-full"
                />
              </div>

              {/* Brain edit button */}
              <Button
                onClick={() => onEditBrain(arch)}
                variant="outline"
                size="sm"
                className="w-full h-7 text-xs border-slate-600"
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
        <Button onClick={onToggleDebug} variant="outline" size="sm" className="w-full text-xs border-slate-600">
          Toggle Debug
        </Button>
      </div>
    </aside>
  );
}
