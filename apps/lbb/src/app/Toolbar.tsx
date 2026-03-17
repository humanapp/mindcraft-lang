import { Button, cn, Slider } from "@mindcraft-lang/ui";
import type { ReactNode } from "react";
import type { TerrainShadingMode, ToolType, VoxelDebugMode } from "@/editor/editor-store";
import { useEditorStore } from "@/editor/editor-store";
import { SKY_GRADIENTS, type SkyGradientId } from "@/render/sky/gradientSkyboxUtils";
import type { BrushParams, BrushShape } from "@/world/terrain/edit";
import { useWorldStore } from "@/world/world-store";

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="bg-card/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2 flex flex-col gap-1.5">
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</div>;
}

function SliderField({
  label,
  value,
  displayValue,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  displayValue: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground font-mono tabular-nums">{displayValue}</span>
      </div>
      <Slider value={[value]} onValueChange={([v]) => onChange(v)} min={min} max={max} step={step} />
    </div>
  );
}

function ToggleSwitch({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        "relative flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors",
        checked ? "bg-primary" : "bg-secondary"
      )}
    >
      <span
        className={cn(
          "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  );
}

function ToggleRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-foreground">{label}</span>
      <ToggleSwitch checked={checked} onToggle={onToggle} />
    </div>
  );
}

function ToolPanel({ activeTool, setActiveTool }: { activeTool: ToolType; setActiveTool: (tool: ToolType) => void }) {
  const tools: { id: ToolType; label: string }[] = [
    { id: "raise", label: "Raise" },
    { id: "lower", label: "Lower" },
    { id: "smooth", label: "Smooth" },
    { id: "roughen", label: "Roughen" },
    { id: "flatten", label: "Flatten" },
  ];

  return (
    <Panel>
      <SectionLabel>Tool</SectionLabel>
      <div className="flex gap-1">
        {tools.map((t) => (
          <Button
            key={t.id}
            variant={activeTool === t.id ? "default" : "secondary"}
            size="sm"
            onClick={() => setActiveTool(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>
    </Panel>
  );
}

function BrushPanel({
  brush,
  setBrushRadius,
  setBrushStrength,
  setBrushFalloff,
  setBrushShape,
}: {
  brush: BrushParams;
  setBrushRadius: (r: number) => void;
  setBrushStrength: (s: number) => void;
  setBrushFalloff: (f: number) => void;
  setBrushShape: (s: BrushShape) => void;
}) {
  return (
    <Panel>
      <SectionLabel>Brush</SectionLabel>
      <SliderField
        label="Radius"
        value={brush.radius}
        displayValue={String(brush.radius)}
        min={1}
        max={16}
        step={1}
        onChange={setBrushRadius}
      />
      <SliderField
        label="Strength (voxels/s)"
        value={brush.strength}
        displayValue={brush.strength.toFixed(1)}
        min={0.5}
        max={50}
        step={0.5}
        onChange={setBrushStrength}
      />
      <SliderField
        label="Falloff"
        value={brush.falloff ?? 1}
        displayValue={(brush.falloff ?? 1).toFixed(1)}
        min={0.1}
        max={5}
        step={0.1}
        onChange={setBrushFalloff}
      />
      <SectionLabel>Shape</SectionLabel>
      <div className="flex gap-1">
        {(["sphere", "cube", "cylinder"] as const).map((s) => (
          <Button
            key={s}
            variant={(brush.shape ?? "sphere") === s ? "default" : "secondary"}
            size="sm"
            onClick={() => setBrushShape(s)}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>
    </Panel>
  );
}

function UndoRedoPanel({
  canUndo,
  canRedo,
  undo,
  redo,
}: {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}) {
  return (
    <Panel>
      <div className="flex gap-1">
        <Button variant="secondary" size="sm" onClick={undo} disabled={!canUndo}>
          Undo
        </Button>
        <Button variant="secondary" size="sm" onClick={redo} disabled={!canRedo}>
          Redo
        </Button>
      </div>
    </Panel>
  );
}

function RenderPanel({
  wireframe,
  toggleWireframe,
  terrainShading,
  setTerrainShading,
  skyGradient,
  setSkyGradient,
  normalSmoothing,
  setNormalSmoothing,
  seaLevel,
  setSeaLevel,
  waterEnabled,
  toggleWater,
  waterSunAngle,
  setWaterSunAngle,
}: {
  wireframe: boolean;
  toggleWireframe: () => void;
  terrainShading: TerrainShadingMode;
  setTerrainShading: (mode: TerrainShadingMode) => void;
  skyGradient: SkyGradientId;
  setSkyGradient: (gradient: SkyGradientId) => void;
  normalSmoothing: number;
  setNormalSmoothing: (v: number) => void;
  seaLevel: number;
  setSeaLevel: (v: number) => void;
  waterEnabled: boolean;
  toggleWater: () => void;
  waterSunAngle: number;
  setWaterSunAngle: (v: number) => void;
}) {
  return (
    <Panel>
      <SectionLabel>Render</SectionLabel>
      <ToggleRow label="Wireframe" checked={wireframe} onToggle={toggleWireframe} />
      <select
        value={terrainShading}
        onChange={(e) => setTerrainShading(e.target.value as TerrainShadingMode)}
        className="w-full rounded-md bg-secondary border border-border px-2 py-1 text-xs text-foreground cursor-pointer"
      >
        <option value="default">Default Material</option>
        <option value="plain">Plain Shaded</option>
        <option value="normals">Normal Debug</option>
        <option value="gradient-mag">Gradient Magnitude</option>
      </select>
      <span className="text-xs text-muted-foreground">Sky</span>
      <select
        value={skyGradient}
        onChange={(e) => setSkyGradient(e.target.value as SkyGradientId)}
        className="w-full rounded-md bg-secondary border border-border px-2 py-1 text-xs text-foreground cursor-pointer"
      >
        {(Object.keys(SKY_GRADIENTS) as SkyGradientId[]).map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
      <SliderField
        label="Normal Smooth"
        value={normalSmoothing}
        displayValue={String(normalSmoothing)}
        min={0}
        max={4}
        step={1}
        onChange={setNormalSmoothing}
      />
      <SectionLabel>Water</SectionLabel>
      <ToggleRow label="Visible" checked={waterEnabled} onToggle={toggleWater} />
      <SliderField
        label="Sea Level"
        value={seaLevel}
        displayValue={seaLevel.toFixed(0)}
        min={-10}
        max={80}
        step={1}
        onChange={setSeaLevel}
      />
      <SliderField
        label="Sun Angle"
        value={waterSunAngle}
        displayValue={`${waterSunAngle.toFixed(0)}\u00B0`}
        min={-180}
        max={180}
        step={5}
        onChange={setWaterSunAngle}
      />
    </Panel>
  );
}

function DebugPanel({
  voxelDebugMode,
  setVoxelDebugMode,
  debugBrush,
  toggleDebugBrush,
}: {
  voxelDebugMode: VoxelDebugMode;
  setVoxelDebugMode: (mode: VoxelDebugMode) => void;
  debugBrush: boolean;
  toggleDebugBrush: () => void;
}) {
  return (
    <Panel>
      <SectionLabel>Debug</SectionLabel>
      <select
        value={voxelDebugMode}
        onChange={(e) => setVoxelDebugMode(e.target.value as VoxelDebugMode)}
        className="w-full rounded-md bg-secondary border border-border px-2 py-1 text-xs text-foreground cursor-pointer"
      >
        <option value="off">Off</option>
        <option value="active-cells">Active Cells</option>
        <option value="edge-intersections">Edge Intersections</option>
        <option value="surface-vertices">Surface Vertices</option>
        <option value="density-sign">Density Sign</option>
      </select>
      <ToggleRow label="Log Brush" checked={debugBrush} onToggle={toggleDebugBrush} />
    </Panel>
  );
}

function DensityFieldPanel({
  densityRange,
  clampDensity,
  toggleClampDensity,
}: {
  densityRange: { min: number; max: number };
  clampDensity: boolean;
  toggleClampDensity: () => void;
}) {
  return (
    <Panel>
      <SectionLabel>Density Field</SectionLabel>
      <div className="flex justify-between text-xs text-muted-foreground font-mono tabular-nums">
        <span>min:</span>
        <span className="text-foreground">{densityRange.min.toFixed(2)}</span>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground font-mono tabular-nums">
        <span>max:</span>
        <span className="text-foreground">{densityRange.max.toFixed(2)}</span>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground font-mono tabular-nums">
        <span>iso:</span>
        <span className="text-foreground">0.0</span>
      </div>
      <ToggleRow label="Clamp Density" checked={clampDensity} onToggle={toggleClampDensity} />
    </Panel>
  );
}

export function Toolbar() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const brush = useEditorStore((s) => s.brush);
  const setBrushRadius = useEditorStore((s) => s.setBrushRadius);
  const setBrushStrength = useEditorStore((s) => s.setBrushStrength);
  const setBrushShape = useEditorStore((s) => s.setBrushShape);
  const setBrushFalloff = useEditorStore((s) => s.setBrushFalloff);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const wireframe = useEditorStore((s) => s.wireframe);
  const toggleWireframe = useEditorStore((s) => s.toggleWireframe);
  const terrainShading = useEditorStore((s) => s.terrainShading);
  const setTerrainShading = useEditorStore((s) => s.setTerrainShading);
  const skyGradient = useEditorStore((s) => s.skyGradient);
  const setSkyGradient = useEditorStore((s) => s.setSkyGradient);
  const normalSmoothing = useEditorStore((s) => s.normalSmoothing);
  const setNormalSmoothing = useEditorStore((s) => s.setNormalSmoothing);
  const seaLevel = useEditorStore((s) => s.seaLevel);
  const setSeaLevel = useEditorStore((s) => s.setSeaLevel);
  const waterEnabled = useEditorStore((s) => s.waterEnabled);
  const toggleWater = useEditorStore((s) => s.toggleWater);
  const waterSunAngle = useEditorStore((s) => s.waterSunAngle);
  const setWaterSunAngle = useEditorStore((s) => s.setWaterSunAngle);
  const voxelDebugMode = useEditorStore((s) => s.voxelDebugMode);
  const setVoxelDebugMode = useEditorStore((s) => s.setVoxelDebugMode);
  const clampDensity = useEditorStore((s) => s.clampDensity);
  const toggleClampDensity = useEditorStore((s) => s.toggleClampDensity);
  const debugBrush = useEditorStore((s) => s.debugBrush);
  const toggleDebugBrush = useEditorStore((s) => s.toggleDebugBrush);
  const densityRange = useWorldStore((s) => s.densityRange);
  const workingPlaneEnabled = useEditorStore((s) => s.workingPlaneEnabled);
  const toggleWorkingPlane = useEditorStore((s) => s.toggleWorkingPlane);

  return (
    <div className="absolute top-3 left-3 flex flex-col gap-2 z-10 pointer-events-auto">
      <ToolPanel activeTool={activeTool} setActiveTool={setActiveTool} />
      <BrushPanel
        brush={brush}
        setBrushRadius={setBrushRadius}
        setBrushStrength={setBrushStrength}
        setBrushFalloff={setBrushFalloff}
        setBrushShape={setBrushShape}
      />
      <UndoRedoPanel canUndo={canUndo} canRedo={canRedo} undo={undo} redo={redo} />
      <Panel>
        <SectionLabel>Working Plane</SectionLabel>
        <ToggleRow label="Enabled" checked={workingPlaneEnabled} onToggle={toggleWorkingPlane} />
        {workingPlaneEnabled && <span className="text-[10px] text-muted-foreground">Hold Space to move/rotate</span>}
      </Panel>
      <RenderPanel
        wireframe={wireframe}
        toggleWireframe={toggleWireframe}
        terrainShading={terrainShading}
        setTerrainShading={setTerrainShading}
        skyGradient={skyGradient}
        setSkyGradient={setSkyGradient}
        normalSmoothing={normalSmoothing}
        setNormalSmoothing={setNormalSmoothing}
        seaLevel={seaLevel}
        setSeaLevel={setSeaLevel}
        waterEnabled={waterEnabled}
        toggleWater={toggleWater}
        waterSunAngle={waterSunAngle}
        setWaterSunAngle={setWaterSunAngle}
      />
      <DebugPanel
        voxelDebugMode={voxelDebugMode}
        setVoxelDebugMode={setVoxelDebugMode}
        debugBrush={debugBrush}
        toggleDebugBrush={toggleDebugBrush}
      />
      {false && (
        <DensityFieldPanel
          densityRange={densityRange}
          clampDensity={clampDensity}
          toggleClampDensity={toggleClampDensity}
        />
      )}
    </div>
  );
}
