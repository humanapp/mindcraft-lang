import { create } from "zustand";

export type BrushTargetSource = "terrain" | "working-plane";

export interface SessionState {
  // Camera
  cameraTarget: [number, number, number];
  cameraDistance: number;

  // Hover -- raw terrain hit from R3F raycaster
  terrainHitPos: [number, number, number] | null;
  terrainHitDistance: number;

  // Hover -- resolved brush target (may come from terrain or plane)
  hoverWorldPos: [number, number, number] | null;
  brushTargetSource: BrushTargetSource | null;
  isPointerDown: boolean;

  // Actions
  setCameraTarget: (target: [number, number, number]) => void;
  setCameraDistance: (distance: number) => void;
  setTerrainHit: (pos: [number, number, number] | null, distance: number) => void;
  setHoverWorldPos: (pos: [number, number, number] | null) => void;
  setHoverWithSource: (pos: [number, number, number] | null, source: BrushTargetSource | null) => void;
  setPointerDown: (down: boolean) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  cameraTarget: [96, 40, 96],
  cameraDistance: 200,
  terrainHitPos: null,
  terrainHitDistance: Number.POSITIVE_INFINITY,
  hoverWorldPos: null,
  brushTargetSource: null,
  isPointerDown: false,

  setCameraTarget: (target) => set({ cameraTarget: target }),
  setCameraDistance: (distance) => set({ cameraDistance: distance }),
  setTerrainHit: (pos, distance) => set({ terrainHitPos: pos, terrainHitDistance: distance }),
  setHoverWorldPos: (pos) => set({ hoverWorldPos: pos, brushTargetSource: pos ? "terrain" : null }),
  setHoverWithSource: (pos, source) => set({ hoverWorldPos: pos, brushTargetSource: source }),
  setPointerDown: (down) => set({ isPointerDown: down }),
}));
