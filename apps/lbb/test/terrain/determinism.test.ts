import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { computeBrushPatches } from "../../src/world/terrain/edit";
import { syncChunkPadding } from "../../src/world/terrain/halo";
import { extractSurfaceNets } from "../../src/world/terrain/mesher";
import { CHUNK_SIZE } from "../../src/world/terrain/types";
import { flatPlane, sphere } from "./fixtures";
import { assertApproxEqual, makeChunkGrid } from "./helpers";

describe("deterministic mesh output", () => {
  test("same flat plane field produces identical mesh on repeated runs", () => {
    for (let run = 0; run < 3; run++) {
      const chunksA = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], flatPlane(16));
      const chunksB = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], flatPlane(16));

      const meshA = extractSurfaceNets(chunksA.get("0,0,0")!.field, { cx: 0, cy: 0, cz: 0 });
      const meshB = extractSurfaceNets(chunksB.get("0,0,0")!.field, { cx: 0, cy: 0, cz: 0 });

      assert.equal(meshA.vertexCount, meshB.vertexCount, `run ${run}: vertex count mismatch`);
      assert.equal(meshA.indexCount, meshB.indexCount, `run ${run}: index count mismatch`);

      for (let i = 0; i < meshA.vertexCount * 3; i++) {
        assert.equal(meshA.positions[i], meshB.positions[i], `run ${run}: position[${i}] mismatch`);
      }
      for (let i = 0; i < meshA.indexCount; i++) {
        assert.equal(meshA.indices[i], meshB.indices[i], `run ${run}: index[${i}] mismatch`);
      }
    }
  });

  test("same sphere field produces identical mesh on repeated runs", () => {
    const center: [number, number, number] = [16, 16, 16];
    const radius = 10;

    const chunksA = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], sphere(center, radius));
    const chunksB = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], sphere(center, radius));

    const meshA = extractSurfaceNets(chunksA.get("0,0,0")!.field, { cx: 0, cy: 0, cz: 0 });
    const meshB = extractSurfaceNets(chunksB.get("0,0,0")!.field, { cx: 0, cy: 0, cz: 0 });

    assert.equal(meshA.vertexCount, meshB.vertexCount, "vertex count mismatch");
    assert.equal(meshA.indexCount, meshB.indexCount, "index count mismatch");

    for (let i = 0; i < meshA.vertexCount * 3; i++) {
      assert.equal(meshA.positions[i], meshB.positions[i], `position[${i}] mismatch`);
    }
  });

  test("same edit sequence produces stable mesh output", () => {
    const buildAndEdit = () => {
      const chunks = makeChunkGrid(
        [
          { cx: 0, cy: 0, cz: 0 },
          { cx: 1, cy: 0, cz: 0 },
        ],
        flatPlane(16)
      );

      // Apply a brush edit
      const brush = { radius: 4, strength: 2 };
      const patches = computeBrushPatches([CHUNK_SIZE - 2, 16, 16], brush, true, chunks, 0.5);
      for (const p of patches) {
        const chunk = chunks.get(p.chunkId);
        if (chunk) chunk.field[p.index] = p.after;
      }

      // Re-sync halos after editing
      for (const chunk of chunks.values()) {
        syncChunkPadding(chunk, chunks);
      }

      // Mesh both chunks
      const leftChunk = chunks.get("0,0,0")!;
      const rightChunk = chunks.get("1,0,0")!;
      return {
        left: extractSurfaceNets(leftChunk.field, leftChunk.coord),
        right: extractSurfaceNets(rightChunk.field, rightChunk.coord),
      };
    };

    const resultA = buildAndEdit();
    const resultB = buildAndEdit();

    assert.equal(resultA.left.vertexCount, resultB.left.vertexCount, "left vertex count");
    assert.equal(resultA.left.indexCount, resultB.left.indexCount, "left index count");
    assert.equal(resultA.right.vertexCount, resultB.right.vertexCount, "right vertex count");
    assert.equal(resultA.right.indexCount, resultB.right.indexCount, "right index count");

    const epsilon = 1e-10;
    for (let i = 0; i < resultA.left.vertexCount * 3; i++) {
      assertApproxEqual(resultA.left.positions[i], resultB.left.positions[i], epsilon, `left position[${i}]`);
    }
    for (let i = 0; i < resultA.right.vertexCount * 3; i++) {
      assertApproxEqual(resultA.right.positions[i], resultB.right.positions[i], epsilon, `right position[${i}]`);
    }
  });
});
