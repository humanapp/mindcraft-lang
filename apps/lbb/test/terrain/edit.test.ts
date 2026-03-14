import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { affectedChunkIds, computeBrushPatches } from "../../src/world/terrain/edit";
import { CHUNK_SIZE, chunkId } from "../../src/world/terrain/types";
import { flatPlane } from "./fixtures";
import { makeChunkGrid } from "./helpers";

function makeEditGrid() {
  return makeChunkGrid(
    [
      { cx: 0, cy: 0, cz: 0 },
      { cx: 1, cy: 0, cz: 0 },
      { cx: 0, cy: 1, cz: 0 },
      { cx: 1, cy: 1, cz: 0 },
      { cx: 0, cy: 0, cz: 1 },
      { cx: 1, cy: 0, cz: 1 },
      { cx: 0, cy: 1, cz: 1 },
      { cx: 1, cy: 1, cz: 1 },
    ],
    flatPlane(16)
  );
}

describe("edit propagation", () => {
  test("brush edit at chunk center touches only one chunk", () => {
    const chunks = makeEditGrid();
    const center: [number, number, number] = [16, 16, 16];
    const brush = { radius: 3, strength: 1 };
    const patches = computeBrushPatches(center, brush, true, chunks, 1.0);
    const affected = affectedChunkIds(patches);

    assert.ok(patches.length > 0, "should produce patches");
    assert.equal(affected.size, 1, "center edit should touch exactly one chunk");
    assert.ok(affected.has("0,0,0"), "should touch chunk (0,0,0)");
  });

  test("brush edit near X face boundary touches two chunks", () => {
    const chunks = makeEditGrid();
    const center: [number, number, number] = [CHUNK_SIZE, 16, 16];
    const brush = { radius: 3, strength: 1 };
    const patches = computeBrushPatches(center, brush, true, chunks, 1.0);
    const affected = affectedChunkIds(patches);

    assert.ok(patches.length > 0, "should produce patches");
    assert.ok(affected.has("0,0,0"), "should touch left chunk");
    assert.ok(affected.has("1,0,0"), "should touch right chunk");
    assert.equal(affected.size, 2, "face-boundary edit should touch exactly two chunks");
  });

  test("brush edit near edge boundary touches expected chunks", () => {
    const chunks = makeEditGrid();
    // Position at the edge where X and Y boundaries meet
    const center: [number, number, number] = [CHUNK_SIZE, CHUNK_SIZE, 16];
    const brush = { radius: 3, strength: 1 };
    const patches = computeBrushPatches(center, brush, true, chunks, 1.0);
    const affected = affectedChunkIds(patches);

    assert.ok(patches.length > 0, "should produce patches");
    assert.ok(affected.size >= 2, "edge-boundary edit should touch at least 2 chunks");
    assert.ok(affected.size <= 4, "edge-boundary edit should touch at most 4 chunks");
    assert.ok(affected.has("0,0,0"), "should touch (0,0,0)");
    assert.ok(affected.has("1,0,0") || affected.has("0,1,0"), "should touch at least one diagonal neighbor");
  });

  test("brush edit near corner boundary touches expected chunks", () => {
    const chunks = makeEditGrid();
    // Position at the corner where all three boundaries meet
    const center: [number, number, number] = [CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE];
    const brush = { radius: 4, strength: 1 };
    const patches = computeBrushPatches(center, brush, true, chunks, 1.0);
    const affected = affectedChunkIds(patches);

    assert.ok(patches.length > 0, "should produce patches");
    assert.ok(affected.size >= 4, `corner-boundary edit should touch at least 4 chunks, got ${affected.size}`);
  });

  test("brush patches have valid before/after values", () => {
    const chunks = makeEditGrid();
    const center: [number, number, number] = [16, 16, 16];
    const brush = { radius: 3, strength: 1 };
    const patches = computeBrushPatches(center, brush, true, chunks, 1.0);

    for (const patch of patches) {
      assert.ok(Number.isFinite(patch.before), `before should be finite: ${patch.before}`);
      assert.ok(Number.isFinite(patch.after), `after should be finite: ${patch.after}`);
      // For a raise brush, density should increase
      assert.ok(
        patch.after >= patch.before,
        `raise brush should increase density: before=${patch.before} after=${patch.after}`
      );
    }
  });

  test("lowering brush decreases density", () => {
    const chunks = makeEditGrid();
    const center: [number, number, number] = [16, 16, 16];
    const brush = { radius: 3, strength: 1 };
    const patches = computeBrushPatches(center, brush, false, chunks, 1.0);

    for (const patch of patches) {
      assert.ok(patch.after <= patch.before, `lower brush should decrease density`);
    }
  });
});

describe("edit chunk counting", () => {
  test("small brush produces expected patch count range", () => {
    const chunks = makeEditGrid();
    const center: [number, number, number] = [16, 16, 16];
    const brush = { radius: 2, strength: 1 };
    const patches = computeBrushPatches(center, brush, true, chunks, 1.0);

    // A sphere of radius 2 contains roughly (4/3)*pi*8 ~ 33 voxels
    assert.ok(patches.length > 10, `expected >10 patches, got ${patches.length}`);
    assert.ok(patches.length < 100, `expected <100 patches, got ${patches.length}`);
  });
});
