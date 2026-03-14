import type { TerrainShadingMode, ToolType, VoxelDebugMode } from "../editor/editor-store";
import { useEditorStore } from "../editor/editor-store";
import { useWorldStore } from "../world/world-store";

export function Toolbar() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const brush = useEditorStore((s) => s.brush);
  const setBrushRadius = useEditorStore((s) => s.setBrushRadius);
  const setBrushStrength = useEditorStore((s) => s.setBrushStrength);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const wireframe = useEditorStore((s) => s.wireframe);
  const toggleWireframe = useEditorStore((s) => s.toggleWireframe);
  const terrainShading = useEditorStore((s) => s.terrainShading);
  const setTerrainShading = useEditorStore((s) => s.setTerrainShading);
  const normalSmoothing = useEditorStore((s) => s.normalSmoothing);
  const setNormalSmoothing = useEditorStore((s) => s.setNormalSmoothing);
  const voxelDebugMode = useEditorStore((s) => s.voxelDebugMode);
  const setVoxelDebugMode = useEditorStore((s) => s.setVoxelDebugMode);
  const clampDensity = useEditorStore((s) => s.clampDensity);
  const toggleClampDensity = useEditorStore((s) => s.toggleClampDensity);
  const debugBrush = useEditorStore((s) => s.debugBrush);
  const toggleDebugBrush = useEditorStore((s) => s.toggleDebugBrush);
  const densityRange = useWorldStore((s) => s.densityRange);

  const tools: { id: ToolType; label: string }[] = [
    { id: "raise", label: "Raise" },
    { id: "lower", label: "Lower" },
  ];

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 10,
        pointerEvents: "auto",
      }}
    >
      {/* Tool selection */}
      <div style={panelStyle}>
        <div style={labelStyle}>Tool</div>
        <div style={{ display: "flex", gap: 4 }}>
          {tools.map((t) => (
            <button
              type="button"
              key={t.id}
              onClick={() => setActiveTool(t.id)}
              style={{
                ...buttonStyle,
                background: activeTool === t.id ? "#3b82f6" : "#27272a",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Brush params */}
      <div style={panelStyle}>
        <div style={labelStyle}>Brush</div>
        <label style={sliderLabelStyle}>
          Radius: {brush.radius}
          <input
            type="range"
            min={1}
            max={16}
            step={1}
            value={brush.radius}
            onChange={(e) => setBrushRadius(Number(e.target.value))}
            style={sliderStyle}
          />
        </label>
        <label style={sliderLabelStyle}>
          Strength (voxels/s): {brush.strength.toFixed(1)}
          <input
            type="range"
            min={0.5}
            max={20}
            step={0.5}
            value={brush.strength}
            onChange={(e) => setBrushStrength(Number(e.target.value))}
            style={sliderStyle}
          />
        </label>
      </div>

      {/* Undo/Redo */}
      <div style={panelStyle}>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" onClick={undo} disabled={!canUndo} style={buttonStyle}>
            Undo
          </button>
          <button type="button" onClick={redo} disabled={!canRedo} style={buttonStyle}>
            Redo
          </button>
        </div>
      </div>

      {/* Render options */}
      <div style={panelStyle}>
        <div style={labelStyle}>Render</div>
        <div style={toggleRowStyle}>
          <span>Wireframe</span>
          <button
            type="button"
            role="switch"
            aria-checked={wireframe}
            onClick={toggleWireframe}
            style={{
              ...toggleTrackStyle,
              background: wireframe ? "#3b82f6" : "#3f3f46",
            }}
          >
            <span
              style={{
                ...toggleThumbStyle,
                transform: wireframe ? "translateX(16px)" : "translateX(2px)",
              }}
            />
          </button>
        </div>
        <select
          value={terrainShading}
          onChange={(e) => setTerrainShading(e.target.value as TerrainShadingMode)}
          style={selectStyle}
        >
          <option value="default">Default Material</option>
          <option value="plain">Plain Shaded</option>
          <option value="normals">Normal Debug</option>
          <option value="gradient-mag">Gradient Magnitude</option>
        </select>
        <label style={sliderLabelStyle}>
          Normal Smooth: {normalSmoothing}
          <input
            type="range"
            min={0}
            max={4}
            step={1}
            value={normalSmoothing}
            onChange={(e) => setNormalSmoothing(Number(e.target.value))}
            style={sliderStyle}
          />
        </label>
      </div>

      {/* Debug overlay */}
      <div style={panelStyle}>
        <div style={labelStyle}>Debug</div>
        <select
          value={voxelDebugMode}
          onChange={(e) => setVoxelDebugMode(e.target.value as VoxelDebugMode)}
          style={selectStyle}
        >
          <option value="off">Off</option>
          <option value="active-cells">Active Cells</option>
          <option value="edge-intersections">Edge Intersections</option>
          <option value="surface-vertices">Surface Vertices</option>
          <option value="density-sign">Density Sign</option>
        </select>
        <div style={toggleRowStyle}>
          <span>Log Brush</span>
          <button
            type="button"
            role="switch"
            aria-checked={debugBrush}
            onClick={toggleDebugBrush}
            style={{
              ...toggleTrackStyle,
              background: debugBrush ? "#3b82f6" : "#3f3f46",
            }}
          >
            <span
              style={{
                ...toggleThumbStyle,
                transform: debugBrush ? "translateX(16px)" : "translateX(2px)",
              }}
            />
          </button>
        </div>
      </div>

      {/* Density field info */}
      <div style={panelStyle}>
        <div style={labelStyle}>Density Field</div>
        <div style={statRowStyle}>
          <span>min:</span>
          <span style={statValueStyle}>{densityRange.min.toFixed(2)}</span>
        </div>
        <div style={statRowStyle}>
          <span>max:</span>
          <span style={statValueStyle}>{densityRange.max.toFixed(2)}</span>
        </div>
        <div style={statRowStyle}>
          <span>iso:</span>
          <span style={statValueStyle}>0.0</span>
        </div>
        <div style={toggleRowStyle}>
          <span>Clamp Density</span>
          <button
            type="button"
            role="switch"
            aria-checked={clampDensity}
            onClick={toggleClampDensity}
            style={{
              ...toggleTrackStyle,
              background: clampDensity ? "#3b82f6" : "#3f3f46",
            }}
          >
            <span
              style={{
                ...toggleThumbStyle,
                transform: clampDensity ? "translateX(16px)" : "translateX(2px)",
              }}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: "rgba(24, 24, 27, 0.9)",
  border: "1px solid #3f3f46",
  borderRadius: 8,
  padding: "8px 12px",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  backdropFilter: "blur(8px)",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#71717a",
};

const buttonStyle: React.CSSProperties = {
  background: "#27272a",
  color: "#e4e4e7",
  border: "1px solid #3f3f46",
  borderRadius: 6,
  padding: "4px 12px",
  fontSize: 13,
  cursor: "pointer",
  transition: "background 0.15s",
};

const sliderLabelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  fontSize: 12,
  color: "#a1a1aa",
};

const sliderStyle: React.CSSProperties = {
  width: "100%",
  accentColor: "#3b82f6",
};

const selectStyle: React.CSSProperties = {
  background: "#27272a",
  color: "#e4e4e7",
  border: "1px solid #3f3f46",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 12,
  cursor: "pointer",
  width: "100%",
};

const statRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 12,
  color: "#a1a1aa",
  fontFamily: "monospace",
};

const statValueStyle: React.CSSProperties = {
  color: "#e4e4e7",
};

const toggleRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  fontSize: 12,
  color: "#a1a1aa",
  cursor: "pointer",
};

const toggleTrackStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  width: 36,
  height: 20,
  borderRadius: 10,
  border: "none",
  padding: 0,
  cursor: "pointer",
  transition: "background 0.15s",
  flexShrink: 0,
};

const toggleThumbStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: "50%",
  background: "#e4e4e7",
  transition: "transform 0.15s",
};
