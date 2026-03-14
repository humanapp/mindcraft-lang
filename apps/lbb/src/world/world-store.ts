import type RAPIER from "@dimforge/rapier3d-compat";
import { create } from "zustand";
import { useEditorStore } from "../editor/editor-store";
import type { Entity, EntityId } from "./entities";
import { replaceTrimeshCollider } from "./terrain/collider";
import { NEIGHBOR_OFFSETS, syncChunkPadding } from "./terrain/halo";
import { TerrainWorkerBridge } from "./terrain/terrain-worker-bridge";
import type { ChunkData, MeshData } from "./terrain/types";
import { CHUNK_SIZE, chunkId } from "./terrain/types";

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
  inflightChunks: Set<string>;
  staleColliders: Set<string>;
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
  remeshDirtyChunks: (maxChunks?: number) => void;
  markChunkDirty: (id: string) => void;
  flushStaleColliders: (max?: number) => void;
  applyFieldValues: (patches: Array<{ chunkId: string; index: number; value: number }>, clamp?: boolean) => void;
  expandDensityRange: (values: ArrayLike<number>) => void;
  recomputeDensityRange: () => void;
}

const workerBridge = new TerrainWorkerBridge();

function applyMeshResult(id: string, mesh: MeshData): void {
  const state = useWorldStore.getState();
  const existing = state.chunkMeshes.get(id);
  const newMeshes = new Map(state.chunkMeshes);
  newMeshes.set(id, { mesh, collider: existing?.collider ?? null });
  const newInflight = new Set(state.inflightChunks);
  newInflight.delete(id);
  const newStale = new Set(state.staleColliders);
  newStale.add(id);
  useWorldStore.setState({ chunkMeshes: newMeshes, inflightChunks: newInflight, staleColliders: newStale });
}

export const useWorldStore = create<WorldState>((set, get) => ({
  chunks: new Map(),
  chunkMeshes: new Map(),
  dirtyChunks: new Set(),
  inflightChunks: new Set(),
  staleColliders: new Set(),
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
    const coords: { id: string; coord: { cx: number; cy: number; cz: number } }[] = [];
    for (let cz = 0; cz < z; cz++) {
      for (let cy = 0; cy < y; cy++) {
        for (let cx = 0; cx < x; cx++) {
          const coord = { cx, cy, cz };
          coords.push({ id: chunkId(coord), coord });
        }
      }
    }

    const chunks = new Map<string, ChunkData>();
    set({ chunks });

    let remaining = coords.length;
    for (const { id, coord } of coords) {
      workerBridge.requestGenerate(id, coord).then((result) => {
        const state = get();
        const chunkData: ChunkData = { coord: result.coord, field: result.field, version: 0 };
        state.chunks.set(result.chunkId, chunkData);
        remaining--;

        if (remaining === 0) {
          const allChunks = get().chunks;
          for (const chunk of allChunks.values()) {
            syncChunkPadding(chunk, allChunks);
          }

          const allDirty = new Set<string>();
          for (const cid of allChunks.keys()) {
            allDirty.add(cid);
          }
          set({ dirtyChunks: allDirty });
          get().recomputeDensityRange();
        }
      });
    }
  },

  remeshChunk: (id) => {
    const state = get();
    const chunk = state.chunks.get(id);
    if (!chunk) return;
    if (state.inflightChunks.has(id)) return;

    syncChunkPadding(chunk, state.chunks);

    const normalSmoothing = useEditorStore.getState().normalSmoothing;
    const newInflight = new Set(state.inflightChunks);
    newInflight.add(id);
    const newDirty = new Set(state.dirtyChunks);
    newDirty.delete(id);
    set({ inflightChunks: newInflight, dirtyChunks: newDirty });

    workerBridge
      .requestMesh(id, chunk.coord, chunk.field, {
        normalSmoothingIterations: normalSmoothing,
      })
      .then((result) => {
        applyMeshResult(result.chunkId, result.mesh);
      });
  },

  remeshDirtyChunks: (maxChunks) => {
    const state = get();
    const dirty = state.dirtyChunks;
    if (dirty.size === 0) return;
    const normalSmoothing = useEditorStore.getState().normalSmoothing;
    const newDirty = new Set(dirty);
    const newInflight = new Set(state.inflightChunks);
    let dispatched = 0;
    for (const id of dirty) {
      if (maxChunks !== undefined && dispatched >= maxChunks) break;
      if (newInflight.has(id)) {
        newDirty.delete(id);
        continue;
      }
      const chunk = state.chunks.get(id);
      if (!chunk) {
        newDirty.delete(id);
        continue;
      }
      syncChunkPadding(chunk, state.chunks);
      newDirty.delete(id);
      newInflight.add(id);
      dispatched++;

      workerBridge
        .requestMesh(id, chunk.coord, chunk.field, {
          normalSmoothingIterations: normalSmoothing,
        })
        .then((result) => {
          applyMeshResult(result.chunkId, result.mesh);
        });
    }
    if (dispatched > 0) {
      set({ dirtyChunks: newDirty, inflightChunks: newInflight });
    }
  },

  markChunkDirty: (id) => {
    set((s) => {
      const newDirty = new Set(s.dirtyChunks);
      newDirty.add(id);
      return { dirtyChunks: newDirty };
    });
  },

  flushStaleColliders: (max) => {
    const state = get();
    const stale = state.staleColliders;
    if (stale.size === 0) return;
    if (!state.rapierWorld || !state.rapierModule) return;

    const newMeshes = new Map(state.chunkMeshes);
    const newStale = new Set(stale);
    let processed = 0;
    for (const id of stale) {
      if (max !== undefined && processed >= max) break;
      const renderData = newMeshes.get(id);
      if (!renderData) {
        newStale.delete(id);
        continue;
      }
      const collider = replaceTrimeshCollider(
        state.rapierWorld,
        state.rapierModule,
        renderData.collider,
        renderData.mesh
      );
      newMeshes.set(id, { mesh: renderData.mesh, collider });
      newStale.delete(id);
      processed++;
    }
    set({ chunkMeshes: newMeshes, staleColliders: newStale });
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

    const newDirty = new Set(state.dirtyChunks);
    for (const id of touched) {
      newDirty.add(id);
      const chunk = state.chunks.get(id);
      if (!chunk) continue;
      const { cx, cy, cz } = chunk.coord;
      for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
        const nid = chunkId({ cx: cx + dx, cy: cy + dy, cz: cz + dz });
        if (state.chunks.has(nid)) {
          newDirty.add(nid);
        }
      }
    }

    set({ dirtyChunks: newDirty });
    state.expandDensityRange(patches.map((p) => p.value));
  },

  expandDensityRange: (values) => {
    const { densityRange } = get();
    let { min, max } = densityRange;
    let changed = false;
    for (let i = 0, len = values.length; i < len; i++) {
      const v = values[i];
      if (v < min) {
        min = v;
        changed = true;
      }
      if (v > max) {
        max = v;
        changed = true;
      }
    }
    if (changed) set({ densityRange: { min, max } });
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
