import { create } from "zustand";
import type { BrushParams, TerrainPatch } from "../world/terrain/edit";
import { useWorldStore } from "../world/world-store";
import { TerrainPatchCommand } from "./commands";
import { UndoStack } from "./undo-stack";

export type ToolType = "raise" | "lower";

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

  // Render options
  wireframe: boolean;
  terrainShading: TerrainShadingMode;
  normalSmoothing: number;
  voxelDebugMode: VoxelDebugMode;
  clampDensity: boolean;
  debugBrush: boolean;

  // Actions
  setActiveTool: (tool: ToolType) => void;
  setBrushRadius: (radius: number) => void;
  setBrushStrength: (strength: number) => void;
  addPendingPatches: (patches: TerrainPatch[]) => void;
  commitStroke: () => void;
  cancelStroke: () => void;
  undo: () => void;
  redo: () => void;
  toggleWireframe: () => void;
  setTerrainShading: (mode: TerrainShadingMode) => void;
  setNormalSmoothing: (iterations: number) => void;
  setVoxelDebugMode: (mode: VoxelDebugMode) => void;
  toggleClampDensity: () => void;
  toggleDebugBrush: () => void;
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
    brush: { radius: 4, strength: 3 },

    canUndo: false,
    canRedo: false,
    undoCount: 0,
    redoCount: 0,

    pendingPatches: [],

    wireframe: false,
    terrainShading: "default",
    normalSmoothing: 0,
    voxelDebugMode: "off",
    clampDensity: true,
    debugBrush: false,

    setActiveTool: (tool) => set({ activeTool: tool }),

    setBrushRadius: (radius) => set((s) => ({ brush: { ...s.brush, radius: Math.max(1, Math.min(16, radius)) } })),

    setBrushStrength: (strength) =>
      set((s) => ({ brush: { ...s.brush, strength: Math.max(0.5, Math.min(20, strength)) } })),

    addPendingPatches: (patches) => {
      set((s) => ({ pendingPatches: [...s.pendingPatches, ...patches] }));
    },

    commitStroke: () => {
      const { pendingPatches } = get();
      if (pendingPatches.length === 0) return;

      // Merge patches: keep only the last patch per (chunkId, index)
      const merged = new Map<string, TerrainPatch>();
      for (const p of pendingPatches) {
        const key = `${p.chunkId}:${p.index}`;
        const existing = merged.get(key);
        if (existing) {
          merged.set(key, { ...p, before: existing.before });
        } else {
          merged.set(key, p);
        }
      }

      const command = new TerrainPatchCommand(Array.from(merged.values()));
      undoStack.record(command);

      const { densityRange } = useWorldStore.getState();
      console.log(`[brush] density range: [${densityRange.min.toFixed(4)}, ${densityRange.max.toFixed(4)}]`);

      set({ pendingPatches: [] });
    },

    cancelStroke: () => {
      set({ pendingPatches: [] });
    },

    undo: () => undoStack.undo(),
    redo: () => undoStack.redo(),
    toggleWireframe: () => set((s) => ({ wireframe: !s.wireframe })),
    setTerrainShading: (mode) => set({ terrainShading: mode }),
    setNormalSmoothing: (iterations) => set({ normalSmoothing: Math.max(0, Math.min(4, iterations)) }),
    setVoxelDebugMode: (mode) => set({ voxelDebugMode: mode }),
    toggleClampDensity: () => set((s) => ({ clampDensity: !s.clampDensity })),
    toggleDebugBrush: () => set((s) => ({ debugBrush: !s.debugBrush })),
  };
});
