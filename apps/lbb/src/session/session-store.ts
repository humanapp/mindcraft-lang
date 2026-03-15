import { create } from "zustand";

export interface SessionState {
  // Camera
  cameraTarget: [number, number, number];
  cameraDistance: number;

  // Hover
  hoverWorldPos: [number, number, number] | null;
  isPointerDown: boolean;

  // Actions
  setCameraTarget: (target: [number, number, number]) => void;
  setCameraDistance: (distance: number) => void;
  setHoverWorldPos: (pos: [number, number, number] | null) => void;
  setPointerDown: (down: boolean) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  cameraTarget: [96, 40, 96],
  cameraDistance: 200,
  hoverWorldPos: null,
  isPointerDown: false,

  setCameraTarget: (target) => set({ cameraTarget: target }),
  setCameraDistance: (distance) => set({ cameraDistance: distance }),
  setHoverWorldPos: (pos) => set({ hoverWorldPos: pos }),
  setPointerDown: (down) => set({ isPointerDown: down }),
}));
