import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import type { MesherOptions } from "../../src/world/voxel/mesher";
import { extractSurfaceNets } from "../../src/world/voxel/mesher";
import { CHUNK_SIZE } from "../../src/world/voxel/types";
import { flatPlane, sphere } from "./fixtures";
import { assertApproxEqual, findClosestVertex, makeChunkGrid, meshVerticesInRange } from "./helpers";

function smoothOpts(iterations: number): MesherOptions {
  return { normalSmoothingIterations: iterations };
}

describe("normal smoothing boundary agreement", () => {
  test("smoothed normals match at X boundary for flat plane (1 iteration)", () => {
    const height = 16;
    const opts = smoothOpts(1);
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
      ],
      flatPlane(height)
    );

    const leftChunk = chunks.get("0,0,0")!;
    const rightChunk = chunks.get("1,0,0")!;

    const leftMesh = extractSurfaceNets(leftChunk.field, leftChunk.coord, opts);
    const rightMesh = extractSurfaceNets(rightChunk.field, rightChunk.coord, opts);

    const leftOverlap = meshVerticesInRange(leftMesh, "x", CHUNK_SIZE, CHUNK_SIZE + 1);
    const normalEpsilon = 0.05;

    for (const lv of leftOverlap) {
      const closest = findClosestVertex(lv.pos, rightMesh);
      if (closest.distance > 1e-4) continue;

      const lnx = leftMesh.normals[lv.index * 3];
      const lny = leftMesh.normals[lv.index * 3 + 1];
      const lnz = leftMesh.normals[lv.index * 3 + 2];
      const rnx = rightMesh.normals[closest.index * 3];
      const rny = rightMesh.normals[closest.index * 3 + 1];
      const rnz = rightMesh.normals[closest.index * 3 + 2];

      assertApproxEqual(lnx, rnx, normalEpsilon, `smoothed(1) nx at (${lv.pos.join(",")})`);
      assertApproxEqual(lny, rny, normalEpsilon, `smoothed(1) ny at (${lv.pos.join(",")})`);
      assertApproxEqual(lnz, rnz, normalEpsilon, `smoothed(1) nz at (${lv.pos.join(",")})`);
    }
  });

  test("smoothed normals match at X boundary for flat plane (3 iterations)", () => {
    const height = 16;
    const opts = smoothOpts(3);
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
      ],
      flatPlane(height)
    );

    const leftChunk = chunks.get("0,0,0")!;
    const rightChunk = chunks.get("1,0,0")!;

    const leftMesh = extractSurfaceNets(leftChunk.field, leftChunk.coord, opts);
    const rightMesh = extractSurfaceNets(rightChunk.field, rightChunk.coord, opts);

    const leftOverlap = meshVerticesInRange(leftMesh, "x", CHUNK_SIZE, CHUNK_SIZE + 1);
    const normalEpsilon = 0.05;

    for (const lv of leftOverlap) {
      const closest = findClosestVertex(lv.pos, rightMesh);
      if (closest.distance > 1e-4) continue;

      const lnx = leftMesh.normals[lv.index * 3];
      const lny = leftMesh.normals[lv.index * 3 + 1];
      const lnz = leftMesh.normals[lv.index * 3 + 2];
      const rnx = rightMesh.normals[closest.index * 3];
      const rny = rightMesh.normals[closest.index * 3 + 1];
      const rnz = rightMesh.normals[closest.index * 3 + 2];

      assertApproxEqual(lnx, rnx, normalEpsilon, `smoothed(3) nx at (${lv.pos.join(",")})`);
      assertApproxEqual(lny, rny, normalEpsilon, `smoothed(3) ny at (${lv.pos.join(",")})`);
      assertApproxEqual(lnz, rnz, normalEpsilon, `smoothed(3) nz at (${lv.pos.join(",")})`);
    }
  });

  test("smoothed normals match at Z boundary for flat plane", () => {
    const height = 16;
    const opts = smoothOpts(2);
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 0, cy: 0, cz: 1 },
      ],
      flatPlane(height)
    );

    const frontChunk = chunks.get("0,0,0")!;
    const backChunk = chunks.get("0,0,1")!;

    const frontMesh = extractSurfaceNets(frontChunk.field, frontChunk.coord, opts);
    const backMesh = extractSurfaceNets(backChunk.field, backChunk.coord, opts);

    const frontOverlap = meshVerticesInRange(frontMesh, "z", CHUNK_SIZE, CHUNK_SIZE + 1);
    const normalEpsilon = 0.05;

    for (const fv of frontOverlap) {
      const closest = findClosestVertex(fv.pos, backMesh);
      if (closest.distance > 1e-4) continue;

      const fnx = frontMesh.normals[fv.index * 3];
      const fny = frontMesh.normals[fv.index * 3 + 1];
      const fnz = frontMesh.normals[fv.index * 3 + 2];
      const bnx = backMesh.normals[closest.index * 3];
      const bny = backMesh.normals[closest.index * 3 + 1];
      const bnz = backMesh.normals[closest.index * 3 + 2];

      assertApproxEqual(fnx, bnx, normalEpsilon, `Z smoothed nx at (${fv.pos.join(",")})`);
      assertApproxEqual(fny, bny, normalEpsilon, `Z smoothed ny at (${fv.pos.join(",")})`);
      assertApproxEqual(fnz, bnz, normalEpsilon, `Z smoothed nz at (${fv.pos.join(",")})`);
    }
  });

  test("smoothed normals match at X boundary for sphere (2 iterations)", () => {
    const center: [number, number, number] = [CHUNK_SIZE, 16, 16];
    const radius = 10;
    const opts = smoothOpts(2);
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
      ],
      sphere(center, radius)
    );

    const leftChunk = chunks.get("0,0,0")!;
    const rightChunk = chunks.get("1,0,0")!;

    const leftMesh = extractSurfaceNets(leftChunk.field, leftChunk.coord, opts);
    const rightMesh = extractSurfaceNets(rightChunk.field, rightChunk.coord, opts);

    const leftOverlap = meshVerticesInRange(leftMesh, "x", CHUNK_SIZE, CHUNK_SIZE + 1);
    const normalEpsilon = 0.1;

    let matched = 0;
    for (const lv of leftOverlap) {
      const closest = findClosestVertex(lv.pos, rightMesh);
      if (closest.distance > 1e-4) continue;
      matched++;

      const lnx = leftMesh.normals[lv.index * 3];
      const lny = leftMesh.normals[lv.index * 3 + 1];
      const lnz = leftMesh.normals[lv.index * 3 + 2];
      const rnx = rightMesh.normals[closest.index * 3];
      const rny = rightMesh.normals[closest.index * 3 + 1];
      const rnz = rightMesh.normals[closest.index * 3 + 2];

      assertApproxEqual(lnx, rnx, normalEpsilon, `sphere smoothed nx at (${lv.pos.join(",")})`);
      assertApproxEqual(lny, rny, normalEpsilon, `sphere smoothed ny at (${lv.pos.join(",")})`);
      assertApproxEqual(lnz, rnz, normalEpsilon, `sphere smoothed nz at (${lv.pos.join(",")})`);
    }
    assert.ok(matched > 0, "should have at least one matched overlap vertex pair for normal comparison");
  });

  test("smoothed normals remain unit-length", () => {
    const height = 16;
    const opts = smoothOpts(3);
    const chunks = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], flatPlane(height));
    const chunk = chunks.get("0,0,0")!;
    const mesh = extractSurfaceNets(chunk.field, chunk.coord, opts);

    const epsilon = 1e-4;
    for (let i = 0; i < mesh.vertexCount; i++) {
      const nx = mesh.normals[i * 3];
      const ny = mesh.normals[i * 3 + 1];
      const nz = mesh.normals[i * 3 + 2];
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      assertApproxEqual(len, 1.0, epsilon, `normal at vertex ${i} is not unit-length`);
    }
  });

  test("smoothing does not change vertex count or index count", () => {
    const height = 16;
    const chunks = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], flatPlane(height));
    const chunk = chunks.get("0,0,0")!;

    const plain = extractSurfaceNets(chunk.field, chunk.coord);
    const smoothed = extractSurfaceNets(chunk.field, chunk.coord, smoothOpts(3));

    assert.equal(plain.vertexCount, smoothed.vertexCount, "smoothing should not add/remove vertices");
    assert.equal(plain.indexCount, smoothed.indexCount, "smoothing should not change indices");
  });
});
