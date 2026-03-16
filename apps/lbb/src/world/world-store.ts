import type RAPIER from "@dimforge/rapier3d-compat";
import { create } from "zustand";
import type { Entity, EntityId } from "./entities";
import { TerrainWorkerBridge } from "./terrain/terrain-worker-bridge";
import { replaceTrimeshCollider } from "./voxel/collider";
import { NEIGHBOR_OFFSETS, syncChunkPadding } from "./voxel/halo";
import type { MesherOptions } from "./voxel/mesher";
import type { ChunkData, MeshData } from "./voxel/types";
import { CHUNK_SIZE, chunkId, FIELD_PAD, SAMPLES, SAMPLES_SQ, sampleIndex } from "./voxel/types";

// -- SEAM DEBUG INSTRUMENTATION (temporary) --
// Set to true (or run `seamDebug.enableLog()` in browser console) to re-enable.
let _seamLog = false;
let _seamSeq = 0;
function seamSeq(): number {
  return _seamSeq++;
}

function boundaryDensitySample(
  field: Float32Array,
  axis: "x" | "y" | "z",
  side: "lo" | "hi",
  sampleCount: number
): number[] {
  const vals: number[] = [];
  const face = side === "lo" ? FIELD_PAD : FIELD_PAD + CHUNK_SIZE;
  const mid = FIELD_PAD + Math.floor(CHUNK_SIZE / 2);
  const offsets = [-1, 0, 1];
  for (const oa of offsets) {
    for (const ob of offsets) {
      const a = mid + oa;
      const b = mid + ob;
      let idx: number;
      if (axis === "x") idx = face + a * SAMPLES + b * SAMPLES_SQ;
      else if (axis === "y") idx = a + face * SAMPLES + b * SAMPLES_SQ;
      else idx = a + b * SAMPLES + face * SAMPLES_SQ;
      vals.push(field[idx]);
      if (vals.length >= sampleCount) return vals;
    }
  }
  return vals;
}

function checkBoundaryAgreement(
  chunkA: ChunkData,
  chunkB: ChunkData,
  axis: "x" | "y" | "z"
): { maxDiff: number; samples: number; mismatches: Array<{ pos: string; a: number; b: number }> } {
  const face0 = FIELD_PAD + CHUNK_SIZE;
  const mismatches: Array<{ pos: string; a: number; b: number }> = [];
  let maxDiff = 0;
  let samples = 0;
  for (let faceOffset = 0; faceOffset <= 1; faceOffset++) {
    const faceA = face0 + faceOffset;
    const faceB = FIELD_PAD + faceOffset;
    for (let u = FIELD_PAD; u <= FIELD_PAD + CHUNK_SIZE; u++) {
      for (let v = FIELD_PAD; v <= FIELD_PAD + CHUNK_SIZE; v++) {
        let idxA: number;
        let idxB: number;
        if (axis === "x") {
          idxA = faceA + u * SAMPLES + v * SAMPLES_SQ;
          idxB = faceB + u * SAMPLES + v * SAMPLES_SQ;
        } else if (axis === "y") {
          idxA = u + faceA * SAMPLES + v * SAMPLES_SQ;
          idxB = u + faceB * SAMPLES + v * SAMPLES_SQ;
        } else {
          idxA = u + v * SAMPLES + faceA * SAMPLES_SQ;
          idxB = u + v * SAMPLES + faceB * SAMPLES_SQ;
        }
        const a = chunkA.field[idxA];
        const b = chunkB.field[idxB];
        const diff = Math.abs(a - b);
        if (diff > maxDiff) maxDiff = diff;
        if (diff > 1e-6) {
          mismatches.push({ pos: `face${faceOffset}:${u},${v}`, a, b });
        }
        samples++;
      }
    }
  }
  return { maxDiff, samples, mismatches };
}
// -- END SEAM DEBUG --

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
  chunkRenderData: Map<string, ChunkRenderData>;
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
  remeshChunk: (id: string, mesherOptions?: MesherOptions) => void;
  remeshDirtyChunks: (maxChunks?: number, mesherOptions?: MesherOptions) => void;
  markChunkDirty: (id: string) => void;
  flushStaleColliders: (max?: number) => void;
  applyFieldValues: (patches: Array<{ chunkId: string; fieldIndex: number; value: number }>, clamp?: boolean) => void;
  expandDensityRange: (values: ArrayLike<number>) => void;
  recomputeDensityRange: () => void;
}

const workerBridge = new TerrainWorkerBridge();

const inflightVersions = new Map<string, number>();

function applyMeshResult(id: string, mesh: MeshData): void {
  const seq = seamSeq();
  const state = useWorldStore.getState();
  const newMeshes = new Map(state.chunkRenderData);
  const existing = state.chunkRenderData.get(id);
  newMeshes.set(id, { mesh, collider: existing?.collider ?? null });
  const newInflight = new Set(state.inflightChunks);
  newInflight.delete(id);
  const newStale = new Set(state.staleColliders);
  newStale.add(id);

  const chunk = state.chunks.get(id);
  const inflightVer = inflightVersions.get(id);
  inflightVersions.delete(id);
  const isStale = chunk && inflightVer !== undefined && chunk.version !== inflightVer;

  const stillDirty = state.dirtyChunks.has(id);
  if (_seamLog) {
    console.log(
      `[seam:mesh-result] seq=${seq} chunk=${id} verts=${mesh.vertexCount} stale=${isStale}` +
        ` inflightVer=${inflightVer} curVer=${chunk?.version} stillDirty=${stillDirty}` +
        ` inflight=${state.inflightChunks.size - 1} dirty=${state.dirtyChunks.size}`
    );
  }

  if (isStale) {
    const newDirty = new Set(state.dirtyChunks);
    newDirty.add(id);
    useWorldStore.setState({
      chunkRenderData: newMeshes,
      inflightChunks: newInflight,
      staleColliders: newStale,
      dirtyChunks: newDirty,
    });
  } else {
    if (stillDirty) {
      if (_seamLog) {
        console.warn(
          `[seam:accepted-but-dirty] seq=${seq} chunk=${id} -- mesh accepted but chunk is still dirty (will re-mesh)`
        );
      }
    }
    useWorldStore.setState({ chunkRenderData: newMeshes, inflightChunks: newInflight, staleColliders: newStale });
  }
}

export const useWorldStore = create<WorldState>((set, get) => ({
  chunks: new Map(),
  chunkRenderData: new Map(),
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

  remeshChunk: (id, mesherOptions = {}) => {
    const state = get();
    const chunk = state.chunks.get(id);
    if (!chunk) return;
    if (state.inflightChunks.has(id)) return;

    syncChunkPadding(chunk, state.chunks);

    const newInflight = new Set(state.inflightChunks);
    newInflight.add(id);
    const newDirty = new Set(state.dirtyChunks);
    newDirty.delete(id);
    set({ inflightChunks: newInflight, dirtyChunks: newDirty });

    workerBridge.requestMesh(id, chunk.coord, chunk.field, mesherOptions).then((result) => {
      applyMeshResult(result.chunkId, result.mesh);
    });
  },

  remeshDirtyChunks: (maxChunks, mesherOptions = {}) => {
    const state = get();
    const dirty = state.dirtyChunks;
    if (dirty.size === 0) return;
    const newDirty = new Set(dirty);
    const newInflight = new Set(state.inflightChunks);
    let dispatched = 0;
    let skippedInflight = 0;
    for (const id of dirty) {
      if (maxChunks !== undefined && dispatched >= maxChunks) break;
      if (newInflight.has(id)) {
        skippedInflight++;
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
      inflightVersions.set(id, chunk.version);
      dispatched++;

      workerBridge.requestMesh(id, chunk.coord, chunk.field, mesherOptions).then((result) => {
        applyMeshResult(result.chunkId, result.mesh);
      });
    }
    if (dispatched > 0) {
      if (_seamLog) {
        const seq = seamSeq();
        console.log(
          `[seam:remesh] seq=${seq} dispatched=${dispatched}` +
            ` skippedInflight=${skippedInflight} remaining=${newDirty.size}`
        );
      }
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

    const newMeshes = new Map(state.chunkRenderData);
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
    set({ chunkRenderData: newMeshes, staleColliders: newStale });
  },

  applyFieldValues: (patches, clamp) => {
    const state = get();
    const touched = new Set<string>();

    for (const patch of patches) {
      const chunk = state.chunks.get(patch.chunkId);
      if (!chunk) continue;
      chunk.field[patch.fieldIndex] = clamp ? Math.max(DENSITY_MIN, Math.min(DENSITY_MAX, patch.value)) : patch.value;
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

    if (_seamLog) {
      const seq = seamSeq();
      const touchedVersions = [...touched].map((id) => {
        const c = state.chunks.get(id);
        return `${id}(v${c?.version})`;
      });
      const inflightOverlap = [...touched].filter((id) => state.inflightChunks.has(id));
      console.log(
        `[seam:edit] seq=${seq} patches=${patches.length} touched=[${touchedVersions.join(", ")}]` +
          ` totalDirty=${newDirty.size}` +
          (inflightOverlap.length > 0 ? ` TOUCHED_INFLIGHT=[${inflightOverlap.join(", ")}]` : "")
      );
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

// -- SEAM DEBUG: console helpers (temporary) --
// Usage from browser console: seamDebug.checkAll() or seamDebug.compare("0,0,0", "1,0,0", "x")

interface SeamDebugAPI {
  checkAll: () => void;
  compare: (idA: string, idB: string, axis: "x" | "y" | "z") => void;
  status: () => void;
  boundaryVerts: (idA: string, idB: string, axis: "x" | "y" | "z") => void;
  enableLog: () => void;
  disableLog: () => void;
}

const seamDebug: SeamDebugAPI = {
  status() {
    const s = useWorldStore.getState();
    console.log(
      `[seam-debug] chunks=${s.chunks.size} meshes=${s.chunkRenderData.size}` +
        ` dirty=${s.dirtyChunks.size} inflight=${s.inflightChunks.size}` +
        ` staleColliders=${s.staleColliders.size}`
    );
    if (s.dirtyChunks.size > 0) {
      console.log(`  dirty: [${[...s.dirtyChunks].join(", ")}]`);
    }
    if (s.inflightChunks.size > 0) {
      console.log(`  inflight: [${[...s.inflightChunks].join(", ")}]`);
    }
  },

  compare(idA: string, idB: string, axis: "x" | "y" | "z") {
    const s = useWorldStore.getState();
    const a = s.chunks.get(idA);
    const b = s.chunks.get(idB);
    if (!a || !b) {
      console.error(`[seam-debug] chunk not found: ${!a ? idA : idB}`);
      return;
    }
    const result = checkBoundaryAgreement(a, b, axis);
    if (result.mismatches.length === 0) {
      console.log(
        `[seam-debug] ${idA} <-> ${idB} (${axis}): MATCH (${result.samples} samples, maxDiff=${result.maxDiff.toExponential(3)})`
      );
    } else {
      console.warn(
        `[seam-debug] ${idA} <-> ${idB} (${axis}): ${result.mismatches.length} MISMATCHES (maxDiff=${result.maxDiff.toExponential(3)})`
      );
      for (const m of result.mismatches.slice(0, 10)) {
        console.warn(
          `  pos=${m.pos} A=${m.a.toFixed(6)} B=${m.b.toFixed(6)} diff=${Math.abs(m.a - m.b).toExponential(3)}`
        );
      }
    }
    console.log(`  A.version=${a.version} B.version=${b.version}`);
  },

  checkAll() {
    const s = useWorldStore.getState();
    const coords = new Map<string, { cx: number; cy: number; cz: number }>();
    for (const [id, chunk] of s.chunks) {
      coords.set(id, chunk.coord);
    }
    let issues = 0;
    for (const [id, coord] of coords) {
      const a = s.chunks.get(id);
      if (!a) continue;
      for (const [axis, dx, dy, dz] of [
        ["x", 1, 0, 0],
        ["y", 0, 1, 0],
        ["z", 0, 0, 1],
      ] as const) {
        const nid = chunkId({ cx: coord.cx + dx, cy: coord.cy + dy, cz: coord.cz + dz });
        const b = s.chunks.get(nid);
        if (!b) continue;
        const result = checkBoundaryAgreement(a, b, axis);
        if (result.mismatches.length > 0) {
          console.warn(
            `[seam-debug] MISMATCH ${id} <-> ${nid} (${axis}): ${result.mismatches.length} mismatches, maxDiff=${result.maxDiff.toExponential(3)}`
          );
          issues++;
        }
      }
    }
    if (issues === 0) {
      console.log("[seam-debug] All chunk boundaries agree.");
    } else {
      console.warn(`[seam-debug] ${issues} boundary issues found.`);
    }
  },

  boundaryVerts(idA: string, idB: string, axis: "x" | "y" | "z") {
    const s = useWorldStore.getState();
    const meshA = s.chunkRenderData.get(idA);
    const meshB = s.chunkRenderData.get(idB);
    if (!meshA || !meshB) {
      console.error(`[seam-debug] mesh not found: ${!meshA ? idA : idB}`);
      return;
    }
    const chunkA = s.chunks.get(idA);
    const chunkB = s.chunks.get(idB);
    if (!chunkA || !chunkB) return;
    const boundaryWorld =
      (axis === "x" ? chunkA.coord.cx + 1 : axis === "y" ? chunkA.coord.cy + 1 : chunkA.coord.cz + 1) * CHUNK_SIZE;
    const axisIdx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    const tolerance = 0.5;

    const vertsA: Array<{ i: number; pos: [number, number, number] }> = [];
    for (let i = 0; i < meshA.mesh.vertexCount; i++) {
      const p = meshA.mesh.positions[i * 3 + axisIdx];
      if (Math.abs(p - boundaryWorld) < tolerance) {
        vertsA.push({
          i,
          pos: [meshA.mesh.positions[i * 3], meshA.mesh.positions[i * 3 + 1], meshA.mesh.positions[i * 3 + 2]],
        });
      }
    }

    const vertsB: Array<{ i: number; pos: [number, number, number] }> = [];
    for (let i = 0; i < meshB.mesh.vertexCount; i++) {
      const p = meshB.mesh.positions[i * 3 + axisIdx];
      if (Math.abs(p - boundaryWorld) < tolerance) {
        vertsB.push({
          i,
          pos: [meshB.mesh.positions[i * 3], meshB.mesh.positions[i * 3 + 1], meshB.mesh.positions[i * 3 + 2]],
        });
      }
    }

    console.log(
      `[seam-debug] boundary verts at ${axis}=${boundaryWorld}: A has ${vertsA.length}, B has ${vertsB.length}`
    );

    let matched = 0;
    let unmatched = 0;
    const unmatchedList: Array<{ source: string; pos: [number, number, number] }> = [];
    for (const va of vertsA) {
      const match = vertsB.find(
        (vb) =>
          Math.abs(va.pos[0] - vb.pos[0]) < 0.001 &&
          Math.abs(va.pos[1] - vb.pos[1]) < 0.001 &&
          Math.abs(va.pos[2] - vb.pos[2]) < 0.001
      );
      if (match) {
        matched++;
      } else {
        unmatched++;
        if (unmatchedList.length < 10) unmatchedList.push({ source: "A", pos: va.pos });
      }
    }
    for (const vb of vertsB) {
      const match = vertsA.find(
        (va) =>
          Math.abs(va.pos[0] - vb.pos[0]) < 0.001 &&
          Math.abs(va.pos[1] - vb.pos[1]) < 0.001 &&
          Math.abs(va.pos[2] - vb.pos[2]) < 0.001
      );
      if (!match) {
        unmatched++;
        if (unmatchedList.length < 10) unmatchedList.push({ source: "B", pos: vb.pos });
      }
    }
    console.log(`  matched=${matched} unmatched=${unmatched}`);
    for (const u of unmatchedList) {
      console.warn(
        `  unmatched from ${u.source}: (${u.pos[0].toFixed(3)}, ${u.pos[1].toFixed(3)}, ${u.pos[2].toFixed(3)})`
      );
    }
  },

  enableLog() {
    _seamLog = true;
    console.log("[seam-debug] logging enabled");
  },

  disableLog() {
    _seamLog = false;
    console.log("[seam-debug] logging disabled");
  },
};

(globalThis as Record<string, unknown>).seamDebug = seamDebug;
// -- END SEAM DEBUG console helpers --
