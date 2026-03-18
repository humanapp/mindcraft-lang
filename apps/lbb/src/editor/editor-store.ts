import { create } from "zustand";
import type { SkyGradientId } from "@/render/sky/gradientSkyboxUtils";
import { useSessionStore } from "@/session/session-store";
import type { BrushMode, BrushParams, BrushShape, TerrainPatch } from "@/world/terrain/edit";
import { TerrainPatchCommand } from "./commands";
import { UndoStack } from "./undo-stack";
import { WorkingPlane } from "./working-plane";

export type ToolType = BrushMode;

export type VoxelDebugMode = "off" | "active-cells" | "edge-intersections" | "surface-vertices" | "density-sign";

export type TerrainShadingMode = "default" | "plain" | "normals" | "gradient-mag";

export interface EditorState {
  // Tool
  activeTool: ToolType;
  brush: BrushParams;

  // Undo
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;

  // In-progress stroke
  pendingPatches: TerrainPatch[];
  flattenTarget: number | null;

  // Environment
  seaLevel: number;
  waterEnabled: boolean;
  waterSunAngle: number;

  // Render options
  wireframe: boolean;
  terrainShading: TerrainShadingMode;
  skyGradient: SkyGradientId;
  normalSmoothing: number;
  voxelDebugMode: VoxelDebugMode;
  clampDensity: boolean;
  debugBrush: boolean;

  // Working plane
  workingPlaneEnabled: boolean;
  workingPlane: WorkingPlane;
  spaceHeld: boolean;
  workingPlaneVersion: number;

  // Actions
  setActiveTool: (tool: ToolType) => void;
  setBrushRadius: (radius: number) => void;
  setBrushStrength: (strength: number) => void;
  setBrushShape: (shape: BrushShape) => void;
  setBrushFalloff: (falloff: number) => void;
  addPendingPatches: (patches: TerrainPatch[]) => void;
  setFlattenTarget: (target: number | null) => void;
  commitStroke: () => void;
  cancelStroke: () => void;
  undo: () => void;
  redo: () => void;
  setSeaLevel: (level: number) => void;
  toggleWater: () => void;
  setWaterSunAngle: (angle: number) => void;
  toggleWireframe: () => void;
  setTerrainShading: (mode: TerrainShadingMode) => void;
  setSkyGradient: (gradient: SkyGradientId) => void;
  setNormalSmoothing: (iterations: number) => void;
  setVoxelDebugMode: (mode: VoxelDebugMode) => void;
  toggleClampDensity: () => void;
  toggleDebugBrush: () => void;
  toggleWorkingPlane: () => void;
  setSpaceHeld: (held: boolean) => void;
  bumpWorkingPlaneVersion: () => void;
}

function syncUndoState(stack: UndoStack): Partial<EditorState> {
  return {
    canUndo: stack.canUndo,
    canRedo: stack.canRedo,
    undoCount: stack.undoCount,
    redoCount: stack.redoCount,
  };
}

export const useEditorStore = create<EditorState>((set, get) => {
  const undoStack = new UndoStack(100, () => {
    set(syncUndoState(undoStack));
  });

  return {
    activeTool: "raise",
    brush: { radius: 4, strength: 15, shape: "sphere", falloff: 1 },

    canUndo: false,
    canRedo: false,
    undoCount: 0,
    redoCount: 0,

    pendingPatches: [],
    flattenTarget: null,

    seaLevel: 22,
    waterEnabled: true,
    waterSunAngle: -130,

    wireframe: false,
    terrainShading: "default",
    skyGradient: "Purple Evening Sky",
    normalSmoothing: 2,
    voxelDebugMode: "off",
    clampDensity: false,
    debugBrush: false,

    workingPlaneEnabled: false,
    workingPlane: new WorkingPlane(),
    spaceHeld: false,
    workingPlaneVersion: 0,

    setActiveTool: (tool) => set({ activeTool: tool }),

    setBrushRadius: (radius) => set((s) => ({ brush: { ...s.brush, radius: Math.max(1, Math.min(16, radius)) } })),

    setBrushStrength: (strength) =>
      set((s) => ({ brush: { ...s.brush, strength: Math.max(0.5, Math.min(50, strength)) } })),

    setBrushShape: (shape) => set((s) => ({ brush: { ...s.brush, shape } })),

    setBrushFalloff: (falloff) => set((s) => ({ brush: { ...s.brush, falloff: Math.max(0.1, Math.min(5, falloff)) } })),

    addPendingPatches: (patches) => {
      set((s) => ({ pendingPatches: [...s.pendingPatches, ...patches] }));
    },

    setFlattenTarget: (target) => set({ flattenTarget: target }),

    commitStroke: () => {
      const { pendingPatches, clampDensity } = get();
      if (pendingPatches.length === 0) return;

      // Merge patches: keep only the last patch per (chunkId, fieldIndex)
      const merged = new Map<string, TerrainPatch>();
      for (const p of pendingPatches) {
        const key = `${p.chunkId}:${p.fieldIndex}`;
        const existing = merged.get(key);
        if (existing) {
          merged.set(key, { ...p, before: existing.before });
        } else {
          merged.set(key, p);
        }
      }

      const command = new TerrainPatchCommand(Array.from(merged.values()), clampDensity);
      undoStack.record(command);

      set({ pendingPatches: [], flattenTarget: null });
    },

    cancelStroke: () => {
      set({ pendingPatches: [], flattenTarget: null });
    },

    undo: () => undoStack.undo(),
    redo: () => undoStack.redo(),
    setSeaLevel: (level) => set({ seaLevel: Math.max(-10, Math.min(80, level)) }),
    toggleWater: () => set((s) => ({ waterEnabled: !s.waterEnabled })),
    setWaterSunAngle: (angle) => set({ waterSunAngle: angle }),
    toggleWireframe: () => set((s) => ({ wireframe: !s.wireframe })),
    setTerrainShading: (mode) => set({ terrainShading: mode }),
    setSkyGradient: (gradient) => set({ skyGradient: gradient }),
    setNormalSmoothing: (iterations) => set({ normalSmoothing: Math.max(0, Math.min(4, iterations)) }),
    setVoxelDebugMode: (mode) => set({ voxelDebugMode: mode }),
    toggleClampDensity: () => set((s) => ({ clampDensity: !s.clampDensity })),
    toggleDebugBrush: () => set((s) => ({ debugBrush: !s.debugBrush })),
    toggleWorkingPlane: () =>
      set((s) => {
        if (!s.workingPlaneEnabled) {
          const hoverPos = useSessionStore.getState().hoverWorldPos;
          if (hoverPos) {
            s.workingPlane.position.set(hoverPos[0], hoverPos[1], hoverPos[2]);
          }
        }
        return { workingPlaneEnabled: !s.workingPlaneEnabled };
      }),
    setSpaceHeld: (held) => set({ spaceHeld: held }),
    bumpWorkingPlaneVersion: () => set((s) => ({ workingPlaneVersion: s.workingPlaneVersion + 1 })),
  };
});
