import type RAPIER from "@dimforge/rapier3d-compat";
import { create } from "zustand";
import type { Entity, EntityId } from "./entities";
import { replaceTrimeshCollider } from "./terrain/collider";
import { createChunkData } from "./terrain/generator";
import { extractSurfaceNets } from "./terrain/mesher";
import type { ChunkData, MeshData } from "./terrain/types";
import { chunkId } from "./terrain/types";

export interface ChunkRenderData {
  mesh: MeshData;
  collider: RAPIER.Collider | null;
}

export interface WorldState {
  // Terrain
  chunks: Map<string, ChunkData>;
  chunkMeshes: Map<string, ChunkRenderData>;
  dirtyChunks: Set<string>;

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
  applyFieldValues: (patches: Array<{ chunkId: string; index: number; value: number }>) => void;
}

export const useWorldStore = create<WorldState>((set, get) => ({
  chunks: new Map(),
  chunkMeshes: new Map(),
  dirtyChunks: new Set(),
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
  },

  remeshChunk: (id) => {
    const state = get();
    const chunk = state.chunks.get(id);
    if (!chunk) return;

    const mesh = extractSurfaceNets(chunk.field, chunk.coord);
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

  applyFieldValues: (patches) => {
    const state = get();
    const touched = new Set<string>();

    for (const patch of patches) {
      const chunk = state.chunks.get(patch.chunkId);
      if (!chunk) continue;
      chunk.field[patch.index] = patch.value;
      chunk.version++;
      touched.add(patch.chunkId);
    }

    // Trigger remesh for affected chunks
    for (const id of touched) {
      state.remeshChunk(id);
    }
  },
}));
