import { create } from "zustand";
import type { BrushParams, TerrainPatch } from "../world/terrain/edit";
import { TerrainPatchCommand } from "./commands";
import { UndoStack } from "./undo-stack";

export type ToolType = "raise" | "lower";

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

  // Actions
  setActiveTool: (tool: ToolType) => void;
  setBrushRadius: (radius: number) => void;
  setBrushStrength: (strength: number) => void;
  addPendingPatches: (patches: TerrainPatch[]) => void;
  commitStroke: () => void;
  cancelStroke: () => void;
  undo: () => void;
  redo: () => void;
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
    brush: { radius: 4, strength: 2 },

    canUndo: false,
    canRedo: false,
    undoCount: 0,
    redoCount: 0,

    pendingPatches: [],

    setActiveTool: (tool) => set({ activeTool: tool }),

    setBrushRadius: (radius) => set((s) => ({ brush: { ...s.brush, radius: Math.max(1, Math.min(16, radius)) } })),

    setBrushStrength: (strength) =>
      set((s) => ({ brush: { ...s.brush, strength: Math.max(0.1, Math.min(10, strength)) } })),

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

      set({ pendingPatches: [] });
    },

    cancelStroke: () => {
      set({ pendingPatches: [] });
    },

    undo: () => undoStack.undo(),
    redo: () => undoStack.redo(),
  };
});
