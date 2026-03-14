import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { computeBrushPatches } from "../../src/world/terrain/edit";
import { syncChunkPadding } from "../../src/world/terrain/halo";
import { extractSurfaceNets } from "../../src/world/terrain/mesher";
import { CHUNK_SIZE, chunkId } from "../../src/world/terrain/types";
import { flatPlane } from "./fixtures";
import { findClosestVertex, makeChunkGrid, meshVerticesInRange } from "./helpers";

/**
 * Confirms that meshing one chunk from a fresh field and its neighbor from a
 * stale (pre-edit) snapshot produces a visible seam. This is the failure mode
 * that the version-tracking fix in world-store.ts prevents at runtime.
 *
 * Each test:
 *   1. Builds two adjacent chunks with a flat plane.
 *   2. Snapshots the field of one chunk (simulating the worker's inflight copy).
 *   3. Applies a brush edit that touches both chunks.
 *   4. Meshes the edited chunk from the current field.
 *   5. Meshes the neighbor from the stale snapshot.
 *   6. Asserts that the overlap vertices diverge (unmatched > 0).
 */

function overlapSeamCheck(
  axis: "x" | "y" | "z",
  boundary: number,
  meshFresh: ReturnType<typeof extractSurfaceNets>,
  meshStale: ReturnType<typeof extractSurfaceNets>,
  epsilon: number
) {
  const freshVerts = meshVerticesInRange(meshFresh, axis, boundary - 0.5, boundary + 1.0);
  const staleVerts = meshVerticesInRange(meshStale, axis, boundary - 0.5, boundary + 1.0);

  let unmatched = 0;
  let maxDist = 0;

  for (const v of freshVerts) {
    const { distance } = findClosestVertex(v.pos, meshStale);
    if (distance > epsilon) {
      unmatched++;
      if (distance > maxDist) maxDist = distance;
    }
  }
  for (const v of staleVerts) {
    const { distance } = findClosestVertex(v.pos, meshFresh);
    if (distance > epsilon) {
      unmatched++;
      if (distance > maxDist) maxDist = distance;
    }
  }

  return { unmatched, maxDist, freshOverlap: freshVerts.length, staleOverlap: staleVerts.length };
}

describe("stale-remesh seam (inflight dirty-flag drop)", () => {
  test("stale neighbor mesh diverges after brush edit near X boundary", () => {
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
      ],
      flatPlane(16)
    );

    const rightId = chunkId({ cx: 1, cy: 0, cz: 0 });
    const staleRightField = new Float32Array(chunks.get(rightId)!.field);

    const patches = computeBrushPatches([CHUNK_SIZE - 2, 16, 16], { radius: 5, strength: 5 }, true, chunks, 1.0);
    for (const p of patches) {
      const chunk = chunks.get(p.chunkId);
      if (chunk) chunk.field[p.index] = p.after;
    }
    for (const chunk of chunks.values()) syncChunkPadding(chunk, chunks);

    const left = chunks.get(chunkId({ cx: 0, cy: 0, cz: 0 }))!;
    const right = chunks.get(rightId)!;

    const meshL = extractSurfaceNets(left.field, left.coord);

    const staleChunks = new Map(chunks);
    staleChunks.set(rightId, { ...right, field: staleRightField });
    for (const chunk of staleChunks.values()) syncChunkPadding(chunk, staleChunks);
    const meshR_stale = extractSurfaceNets(staleRightField, right.coord);

    const result = overlapSeamCheck("x", CHUNK_SIZE, meshL, meshR_stale, 0.01);
    assert.ok(result.unmatched > 0, "expected stale right neighbor to produce unmatched overlap vertices");
  });

  test("stale neighbor mesh diverges after brush edit straddling X boundary", () => {
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
      ],
      flatPlane(16)
    );

    const rightId = chunkId({ cx: 1, cy: 0, cz: 0 });
    const staleRightField = new Float32Array(chunks.get(rightId)!.field);

    const patches = computeBrushPatches([CHUNK_SIZE, 16, 16], { radius: 6, strength: 8 }, true, chunks, 1.0);
    for (const p of patches) {
      const chunk = chunks.get(p.chunkId);
      if (chunk) chunk.field[p.index] = p.after;
    }
    for (const chunk of chunks.values()) syncChunkPadding(chunk, chunks);

    const left = chunks.get(chunkId({ cx: 0, cy: 0, cz: 0 }))!;
    const right = chunks.get(rightId)!;

    const meshL = extractSurfaceNets(left.field, left.coord);

    const staleChunks = new Map(chunks);
    staleChunks.set(rightId, { ...right, field: staleRightField });
    for (const chunk of staleChunks.values()) syncChunkPadding(chunk, staleChunks);
    const meshR_stale = extractSurfaceNets(staleRightField, right.coord);

    const result = overlapSeamCheck("x", CHUNK_SIZE, meshL, meshR_stale, 0.01);
    assert.ok(result.unmatched > 0, "expected stale right neighbor (straddling) to produce unmatched overlap vertices");
  });

  test("stale LEFT neighbor diverges after brush centered in right chunk", () => {
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
      ],
      flatPlane(16)
    );

    const leftId = chunkId({ cx: 0, cy: 0, cz: 0 });
    const staleLeftField = new Float32Array(chunks.get(leftId)!.field);

    const patches = computeBrushPatches([CHUNK_SIZE + 2, 16, 16], { radius: 5, strength: 5 }, true, chunks, 1.0);
    for (const p of patches) {
      const chunk = chunks.get(p.chunkId);
      if (chunk) chunk.field[p.index] = p.after;
    }
    for (const chunk of chunks.values()) syncChunkPadding(chunk, chunks);

    const left = chunks.get(leftId)!;
    const right = chunks.get(chunkId({ cx: 1, cy: 0, cz: 0 }))!;

    const meshR = extractSurfaceNets(right.field, right.coord);

    const staleChunks = new Map(chunks);
    staleChunks.set(leftId, { ...left, field: staleLeftField });
    for (const chunk of staleChunks.values()) syncChunkPadding(chunk, staleChunks);
    const meshL_stale = extractSurfaceNets(staleLeftField, left.coord);

    const result = overlapSeamCheck("x", CHUNK_SIZE, meshL_stale, meshR, 0.01);
    assert.ok(result.unmatched > 0, "expected stale left neighbor to produce unmatched overlap vertices");
  });

  test("multiple rapid edits accumulate version skew", () => {
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
      ],
      flatPlane(16)
    );

    const rightId = chunkId({ cx: 1, cy: 0, cz: 0 });
    const staleRightField = new Float32Array(chunks.get(rightId)!.field);

    for (let i = 0; i < 5; i++) {
      const patches = computeBrushPatches([CHUNK_SIZE - 3 + i, 16, 16], { radius: 4, strength: 3 }, true, chunks, 1.0);
      for (const p of patches) {
        const chunk = chunks.get(p.chunkId);
        if (chunk) chunk.field[p.index] = p.after;
      }
      for (const chunk of chunks.values()) syncChunkPadding(chunk, chunks);
    }

    const left = chunks.get(chunkId({ cx: 0, cy: 0, cz: 0 }))!;
    const right = chunks.get(rightId)!;

    const meshL = extractSurfaceNets(left.field, left.coord);

    const staleChunks = new Map(chunks);
    staleChunks.set(rightId, { ...right, field: staleRightField });
    for (const chunk of staleChunks.values()) syncChunkPadding(chunk, staleChunks);
    const meshR_stale = extractSurfaceNets(staleRightField, right.coord);

    const result = overlapSeamCheck("x", CHUNK_SIZE, meshL, meshR_stale, 0.01);
    assert.ok(result.unmatched > 0, "expected 5 rapid edits to produce unmatched overlap vertices with stale neighbor");
  });
});
