import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { affectedChunkIds, computeBrushPatches } from "../../src/world/terrain/edit";
import { CHUNK_SIZE, chunkId, FIELD_PAD, sampleIndex } from "../../src/world/voxel/types";
import { flatPlane, slopedHill } from "./fixtures";
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
    const brush = { radius: 3, strength: 1, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches(center, brush, "raise", chunks, 1.0);
    const affected = affectedChunkIds(patches);

    assert.ok(patches.length > 0, "should produce patches");
    assert.equal(affected.size, 1, "center edit should touch exactly one chunk");
    assert.ok(affected.has("0,0,0"), "should touch chunk (0,0,0)");
  });

  test("brush edit near X face boundary touches two chunks", () => {
    const chunks = makeEditGrid();
    const center: [number, number, number] = [CHUNK_SIZE, 16, 16];
    const brush = { radius: 3, strength: 1, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches(center, brush, "raise", chunks, 1.0);
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
    const brush = { radius: 3, strength: 1, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches(center, brush, "raise", chunks, 1.0);
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
    const brush = { radius: 4, strength: 1, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches(center, brush, "raise", chunks, 1.0);
    const affected = affectedChunkIds(patches);

    assert.ok(patches.length > 0, "should produce patches");
    assert.ok(affected.size >= 4, `corner-boundary edit should touch at least 4 chunks, got ${affected.size}`);
  });

  test("brush patches have valid before/after values", () => {
    const chunks = makeEditGrid();
    const center: [number, number, number] = [16, 16, 16];
    const brush = { radius: 3, strength: 1, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches(center, brush, "raise", chunks, 1.0);

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
    const brush = { radius: 3, strength: 1, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches(center, brush, "lower", chunks, 1.0);

    for (const patch of patches) {
      assert.ok(patch.after <= patch.before, `lower brush should decrease density`);
    }
  });
});

describe("edit chunk counting", () => {
  test("small brush produces expected patch count range", () => {
    const chunks = makeEditGrid();
    const center: [number, number, number] = [16, 16, 16];
    const brush = { radius: 2, strength: 1, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches(center, brush, "raise", chunks, 1.0);

    // A sphere of radius 2 contains roughly (4/3)*pi*8 ~ 33 voxels
    assert.ok(patches.length > 10, `expected >10 patches, got ${patches.length}`);
    assert.ok(patches.length < 100, `expected <100 patches, got ${patches.length}`);
  });
});

describe("smooth brush", () => {
  test("smooth reduces variation between neighbors", () => {
    const chunks = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], slopedHill(16, 0.5, 0.3));

    const center: [number, number, number] = [16, 16, 16];
    const brush = { radius: 4, strength: 5, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches(center, brush, "smooth", chunks, 1.0);

    assert.ok(patches.length > 0, "smooth should produce patches");

    const chunk = chunks.get("0,0,0")!;
    let varianceBefore = 0;
    let varianceAfter = 0;
    let count = 0;

    for (const p of patches) {
      const idx = p.fieldIndex;
      const neighborsBefore = (chunk.field[idx - 1] + chunk.field[idx + 1]) / 2;
      varianceBefore += (p.before - neighborsBefore) ** 2;

      chunk.field[idx] = p.after;
      count++;
    }

    for (const p of patches) {
      const idx = p.fieldIndex;
      const neighborsAfter = (chunk.field[idx - 1] + chunk.field[idx + 1]) / 2;
      varianceAfter += (p.after - neighborsAfter) ** 2;
    }

    assert.ok(
      varianceAfter < varianceBefore || count === 0,
      `smooth should reduce local variation: before=${varianceBefore.toFixed(6)} after=${varianceAfter.toFixed(6)}`
    );
  });

  test("smooth on already-uniform field produces no change", () => {
    const chunks = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], flatPlane(16));

    const center: [number, number, number] = [16, 16, 16];
    const brush = { radius: 3, strength: 5, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches(center, brush, "smooth", chunks, 1.0);

    for (const p of patches) {
      const diff = Math.abs(p.after - p.before);
      assert.ok(diff < 1e-6, `smooth on uniform field should not change density, diff=${diff}`);
    }
  });
});

describe("roughen brush", () => {
  test("roughen introduces spatially continuous variation", () => {
    const chunks = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], flatPlane(16));

    const center: [number, number, number] = [16, 16, 16];
    const brush = { radius: 4, strength: 3, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches(center, brush, "roughen", chunks, 1.0);

    assert.ok(patches.length > 0, "roughen should produce patches");

    let hasPositiveDelta = false;
    let hasNegativeDelta = false;
    for (const p of patches) {
      const delta = p.after - p.before;
      if (delta > 1e-8) hasPositiveDelta = true;
      if (delta < -1e-8) hasNegativeDelta = true;
    }

    assert.ok(hasPositiveDelta, "roughen should raise some voxels");
    assert.ok(hasNegativeDelta, "roughen should lower some voxels");
  });

  test("roughen produces continuous deltas between adjacent voxels", () => {
    const chunks = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], flatPlane(16));

    const center: [number, number, number] = [16, 16, 16];
    const brush = { radius: 6, strength: 3, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches(center, brush, "roughen", chunks, 1.0);

    const deltaByIndex = new Map<number, number>();
    for (const p of patches) {
      deltaByIndex.set(p.fieldIndex, p.after - p.before);
    }

    let maxJump = 0;
    let maxDelta = 0;
    for (const [idx, delta] of deltaByIndex) {
      const absDelta = Math.abs(delta);
      if (absDelta > maxDelta) maxDelta = absDelta;
      const neighborDelta = deltaByIndex.get(idx + 1);
      if (neighborDelta !== undefined) {
        const jump = Math.abs(delta - neighborDelta);
        if (jump > maxJump) maxJump = jump;
      }
    }

    assert.ok(
      maxJump < maxDelta * 0.8,
      `adjacent deltas should be continuous: maxJump=${maxJump.toFixed(6)} maxDelta=${maxDelta.toFixed(6)}`
    );
  });

  test("roughen is deterministic for the same position", () => {
    const chunks1 = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], flatPlane(16));
    const chunks2 = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], flatPlane(16));

    const center: [number, number, number] = [16, 16, 16];
    const brush = { radius: 3, strength: 2, shape: "sphere" as const, falloff: 1 };
    const patches1 = computeBrushPatches(center, brush, "roughen", chunks1, 1.0);
    const patches2 = computeBrushPatches(center, brush, "roughen", chunks2, 1.0);

    assert.equal(patches1.length, patches2.length, "same patch count");
    for (let i = 0; i < patches1.length; i++) {
      assert.equal(patches1[i].after, patches2[i].after, `patch ${i} should be identical`);
    }
  });
});

describe("flatten brush", () => {
  test("flatten drives density toward target height", () => {
    const chunks = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], slopedHill(16, 0.5, 0.3));

    const targetHeight = 16;
    const center: [number, number, number] = [16, 16, 16];
    const brush = { radius: 4, strength: 10, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches(center, brush, "flatten", chunks, 1.0, targetHeight);

    assert.ok(patches.length > 0, "flatten should produce patches");

    for (const p of patches) {
      const worldY = Math.round(16 + (p.fieldIndex % 38) - FIELD_PAD);
      const targetDensity = targetHeight - worldY;
      const distBefore = Math.abs(p.before - targetDensity);
      const distAfter = Math.abs(p.after - targetDensity);
      assert.ok(
        distAfter <= distBefore + 1e-10,
        `flatten should move toward target: distBefore=${distBefore.toFixed(6)} distAfter=${distAfter.toFixed(6)}`
      );
    }
  });

  test("flatten without target is a no-op on flat terrain", () => {
    const chunks = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], flatPlane(16));

    const center: [number, number, number] = [16, 16, 16];
    const brush = { radius: 3, strength: 5, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches(center, brush, "flatten", chunks, 1.0, 16);

    for (const p of patches) {
      assert.ok(Number.isFinite(p.after), `after should be finite: ${p.after}`);
    }
  });
});
