import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { computeBrushPatches } from "../../src/world/terrain/edit";
import { syncChunkPadding } from "../../src/world/terrain/halo";
import { extractSurfaceNets } from "../../src/world/terrain/mesher";
import { CHUNK_SIZE, FIELD_PAD, sampleIndex } from "../../src/world/terrain/types";
import { slopedHill } from "./fixtures";
import { makeChunkGrid, meshVerticesInRange } from "./helpers";

function makeOverlapGrid() {
  return makeChunkGrid(
    [
      { cx: 1, cy: 1, cz: 1 },
      { cx: 2, cy: 1, cz: 1 },
    ],
    slopedHill(16, 0.3, 0.2)
  );
}

describe("overlap field divergence after brush on chunk boundary", () => {
  test("brush just inside chunk B misses chunk A overlap core samples", () => {
    const chunks = makeOverlapGrid();
    const chunkA = chunks.get("1,1,1")!;
    const chunkB = chunks.get("2,1,1")!;

    const boundary = 2 * CHUNK_SIZE;
    const brushX = boundary + 1;
    const brushY = 1 * CHUNK_SIZE + 16;
    const brushZ = 1 * CHUNK_SIZE + 16;
    const brush = { radius: 0.8, strength: 5, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches([brushX, brushY, brushZ], brush, "raise", chunks, 1.0);

    assert.ok(patches.length > 0, "brush should produce patches");

    for (const p of patches) {
      const chunk = chunks.get(p.chunkId);
      if (chunk) chunk.field[p.index] = p.after;
    }

    const worldX65 = boundary + 1;
    const cy = 1;
    const cz = 1;

    const fieldIdxA = sampleIndex(
      worldX65 - 1 * CHUNK_SIZE + FIELD_PAD,
      brushY - cy * CHUNK_SIZE + FIELD_PAD,
      brushZ - cz * CHUNK_SIZE + FIELD_PAD
    );
    const fieldIdxB = sampleIndex(
      worldX65 - 2 * CHUNK_SIZE + FIELD_PAD,
      brushY - cy * CHUNK_SIZE + FIELD_PAD,
      brushZ - cz * CHUNK_SIZE + FIELD_PAD
    );

    const valA = chunkA.field[fieldIdxA];
    const valB = chunkB.field[fieldIdxB];

    assert.ok(
      Math.abs(valA - valB) < 1e-6,
      `Overlap core samples at world x=${worldX65} should agree: ` +
        `A.field=${valA} B.field=${valB} diff=${Math.abs(valA - valB)}`
    );
  });

  test("overlap cell vertices diverge after brush edit near boundary", () => {
    const chunks = makeOverlapGrid();

    const boundary = 2 * CHUNK_SIZE;
    const worldZ = 1 * CHUNK_SIZE + 16;
    const surfaceY = 16 + (boundary + 1) * 0.3 + worldZ * 0.2;
    const brush = { radius: 0.8, strength: 8, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches([boundary + 1, surfaceY, worldZ], brush, "lower", chunks, 1.0);

    for (const p of patches) {
      const chunk = chunks.get(p.chunkId);
      if (chunk) chunk.field[p.index] = p.after;
    }

    for (const c of chunks.values()) syncChunkPadding(c, chunks);

    const chunkA = chunks.get("1,1,1")!;
    const chunkB = chunks.get("2,1,1")!;
    const meshA = extractSurfaceNets(chunkA.field, chunkA.coord);
    const meshB = extractSurfaceNets(chunkB.field, chunkB.coord);

    const overlapLo = boundary;
    const overlapHi = boundary + 1;
    const vertsA = meshVerticesInRange(meshA, "x", overlapLo, overlapHi);
    const vertsB = meshVerticesInRange(meshB, "x", overlapLo, overlapHi);

    let unmatched = 0;
    for (const va of vertsA) {
      const match = vertsB.find(
        (vb) =>
          Math.abs(va.pos[0] - vb.pos[0]) < 0.001 &&
          Math.abs(va.pos[1] - vb.pos[1]) < 0.001 &&
          Math.abs(va.pos[2] - vb.pos[2]) < 0.001
      );
      if (!match) unmatched++;
    }
    for (const vb of vertsB) {
      const match = vertsA.find(
        (va) =>
          Math.abs(va.pos[0] - vb.pos[0]) < 0.001 &&
          Math.abs(va.pos[1] - vb.pos[1]) < 0.001 &&
          Math.abs(va.pos[2] - vb.pos[2]) < 0.001
      );
      if (!match) unmatched++;
    }

    assert.strictEqual(
      unmatched,
      0,
      `${unmatched} overlap-cell vertices disagree between chunks A and B ` +
        `(A has ${vertsA.length} verts in [${overlapLo},${overlapHi}], B has ${vertsB.length})`
    );
  });
});
