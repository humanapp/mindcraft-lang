import type RAPIER from "@dimforge/rapier3d-compat";
import { create } from "zustand";
import { useEditorStore } from "../editor/editor-store";
import type { Entity, EntityId } from "./entities";
import { replaceTrimeshCollider } from "./terrain/collider";
import { createChunkData } from "./terrain/generator";
import { extractSurfaceNets } from "./terrain/mesher";
import type { ChunkData, MeshData } from "./terrain/types";
import { CHUNK_SIZE, chunkId, FIELD_PAD, SAMPLES, SAMPLES_SQ } from "./terrain/types";

export const DENSITY_MIN = -1;
export const DENSITY_MAX = 1;

export interface DensityRange {
  min: number;
  max: number;
}

export interface ChunkRenderData {
  mesh: MeshData;
  collider: RAPIER.Collider | null;
}

export interface WorldState {
  // Terrain
  chunks: Map<string, ChunkData>;
  chunkMeshes: Map<string, ChunkRenderData>;
  dirtyChunks: Set<string>;
  densityRange: DensityRange;

  // Entities
  entities: Record<EntityId, Entity>;

  // Physics
  rapierWorld: RAPIER.World | null;
  rapierModule: typeof RAPIER | null;

  // Actions
  initPhysics: (rapier: typeof RAPIER) => void;
  initTerrain: (chunkGrid: { x: number; y: number; z: number }) => void;
  remeshChunk: (id: string) => void;
  remeshDirtyChunks: () => void;
  markChunkDirty: (id: string) => void;
  applyFieldValues: (patches: Array<{ chunkId: string; index: number; value: number }>, clamp?: boolean) => void;
  recomputeDensityRange: () => void;
}

const NEIGHBOR_OFFSETS: [number, number, number][] = [
  [-1, 0, 0],
  [1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
];

function syncChunkPadding(chunk: ChunkData, chunks: Map<string, ChunkData>): void {
  const { cx, cy, cz } = chunk.coord;

  for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
    const neighbor = chunks.get(chunkId({ cx: cx + dx, cy: cy + dy, cz: cz + dz }));
    if (!neighbor) continue;

    let xMin = 0;
    let xMax = SAMPLES - 1;
    let yMin = 0;
    let yMax = SAMPLES - 1;
    let zMin = 0;
    let zMax = SAMPLES - 1;
    if (dx < 0) xMax = FIELD_PAD - 1;
    if (dx > 0) xMin = FIELD_PAD + CHUNK_SIZE + 2;
    if (dy < 0) yMax = FIELD_PAD - 1;
    if (dy > 0) yMin = FIELD_PAD + CHUNK_SIZE + 2;
    if (dz < 0) zMax = FIELD_PAD - 1;
    if (dz > 0) zMin = FIELD_PAD + CHUNK_SIZE + 2;

    for (let lz = zMin; lz <= zMax; lz++) {
      const srcZ = lz - dz * CHUNK_SIZE;
      if (srcZ < 0 || srcZ >= SAMPLES) continue;
      for (let ly = yMin; ly <= yMax; ly++) {
        const srcY = ly - dy * CHUNK_SIZE;
        if (srcY < 0 || srcY >= SAMPLES) continue;
        for (let lx = xMin; lx <= xMax; lx++) {
          const srcX = lx - dx * CHUNK_SIZE;
          if (srcX < 0 || srcX >= SAMPLES) continue;
          chunk.field[lx + ly * SAMPLES + lz * SAMPLES_SQ] = neighbor.field[srcX + srcY * SAMPLES + srcZ * SAMPLES_SQ];
        }
      }
    }
  }
}

export const useWorldStore = create<WorldState>((set, get) => ({
  chunks: new Map(),
  chunkMeshes: new Map(),
  dirtyChunks: new Set(),
  densityRange: { min: 0, max: 0 },
  entities: {},
  rapierWorld: null,
  rapierModule: null,

  initPhysics: (rapier) => {
    const gravity = new rapier.Vector3(0, -9.81, 0);
    const world = new rapier.World(gravity);
    set({ rapierWorld: world, rapierModule: rapier });
  },

  initTerrain: ({ x, y, z }) => {
    const chunks = new Map<string, ChunkData>();
    for (let cz = 0; cz < z; cz++) {
      for (let cy = 0; cy < y; cy++) {
        for (let cx = 0; cx < x; cx++) {
          const coord = { cx, cy, cz };
          const id = chunkId(coord);
          chunks.set(id, createChunkData(coord));
        }
      }
    }

    set({ chunks });

    // Mesh all chunks
    const state = get();
    for (const id of chunks.keys()) {
      state.remeshChunk(id);
    }
    state.recomputeDensityRange();
  },

  remeshChunk: (id) => {
    const state = get();
    const chunk = state.chunks.get(id);
    if (!chunk) return;

    syncChunkPadding(chunk, state.chunks);

    const mesh = extractSurfaceNets(chunk.field, chunk.coord, useEditorStore.getState().normalSmoothing);
    const existing = state.chunkMeshes.get(id);

    let collider: RAPIER.Collider | null = null;
    if (state.rapierWorld && state.rapierModule) {
      collider = replaceTrimeshCollider(state.rapierWorld, state.rapierModule, existing?.collider ?? null, mesh);
    }

    const newMeshes = new Map(state.chunkMeshes);
    newMeshes.set(id, { mesh, collider });
    const newDirty = new Set(state.dirtyChunks);
    newDirty.delete(id);

    set({ chunkMeshes: newMeshes, dirtyChunks: newDirty });
  },

  remeshDirtyChunks: () => {
    const state = get();
    for (const id of state.dirtyChunks) {
      state.remeshChunk(id);
    }
  },

  markChunkDirty: (id) => {
    set((s) => {
      const newDirty = new Set(s.dirtyChunks);
      newDirty.add(id);
      return { dirtyChunks: newDirty };
    });
  },

  applyFieldValues: (patches, clamp) => {
    const state = get();
    const touched = new Set<string>();

    for (const patch of patches) {
      const chunk = state.chunks.get(patch.chunkId);
      if (!chunk) continue;
      chunk.field[patch.index] = clamp ? Math.max(DENSITY_MIN, Math.min(DENSITY_MAX, patch.value)) : patch.value;
      chunk.version++;
      touched.add(patch.chunkId);
    }

    // Trigger remesh for affected chunks
    for (const id of touched) {
      state.remeshChunk(id);
    }
    state.recomputeDensityRange();
  },

  recomputeDensityRange: () => {
    const { chunks } = get();
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const chunk of chunks.values()) {
      const field = chunk.field;
      for (let i = 0, len = field.length; i < len; i++) {
        const v = field[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min === Number.POSITIVE_INFINITY) {
      min = 0;
      max = 0;
    }
    set({ densityRange: { min, max } });
  },
}));
