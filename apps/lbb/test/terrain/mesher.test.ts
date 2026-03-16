import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { extractSurfaceNets } from "../../src/world/voxel/mesher";
import { CHUNK_SIZE } from "../../src/world/voxel/types";
import { flatPlane, sphere } from "./fixtures";
import { assertApproxEqual, findClosestVertex, makeChunkGrid, meshVerticesInRange } from "./helpers";

describe("mesh seam correctness", () => {
  test("flat plane across two X-adjacent chunks has no seam", () => {
    const height = 16;
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
      ],
      flatPlane(height)
    );

    const leftChunk = chunks.get("0,0,0")!;
    const rightChunk = chunks.get("1,0,0")!;

    const leftMesh = extractSurfaceNets(leftChunk.field, leftChunk.coord);
    const rightMesh = extractSurfaceNets(rightChunk.field, rightChunk.coord);

    assert.ok(leftMesh.vertexCount > 0, "left mesh should have vertices");
    assert.ok(rightMesh.vertexCount > 0, "right mesh should have vertices");

    // The overlap region is world x in [CHUNK_SIZE, CHUNK_SIZE + 1].
    // Both chunks produce vertices in this strip from their shared boundary cell.
    const leftOverlap = meshVerticesInRange(leftMesh, "x", CHUNK_SIZE, CHUNK_SIZE + 1);
    const rightOverlap = meshVerticesInRange(rightMesh, "x", CHUNK_SIZE, CHUNK_SIZE + 1);

    assert.ok(leftOverlap.length > 0, "left chunk should have vertices in overlap region");
    assert.ok(rightOverlap.length > 0, "right chunk should have vertices in overlap region");

    const posEpsilon = 1e-4;
    for (const lv of leftOverlap) {
      const closest = findClosestVertex(lv.pos, rightMesh);
      assertApproxEqual(
        closest.distance,
        0,
        posEpsilon,
        `left overlap vertex (${lv.pos.join(",")}) has no nearby right vertex`
      );
    }
  });

  test("flat plane across two Y-adjacent chunks has no seam", () => {
    const height = CHUNK_SIZE;
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 0, cy: 1, cz: 0 },
      ],
      flatPlane(height)
    );

    const lowerChunk = chunks.get("0,0,0")!;
    const upperChunk = chunks.get("0,1,0")!;

    const lowerMesh = extractSurfaceNets(lowerChunk.field, lowerChunk.coord);
    const upperMesh = extractSurfaceNets(upperChunk.field, upperChunk.coord);

    const totalVerts = lowerMesh.vertexCount + upperMesh.vertexCount;
    assert.ok(totalVerts > 0, "combined meshes should have vertices for a plane at chunk boundary");

    if (lowerMesh.vertexCount > 0 && upperMesh.vertexCount > 0) {
      const lowerOverlap = meshVerticesInRange(lowerMesh, "y", CHUNK_SIZE, CHUNK_SIZE + 1);
      const upperOverlap = meshVerticesInRange(upperMesh, "y", CHUNK_SIZE, CHUNK_SIZE + 1);

      if (lowerOverlap.length > 0 && upperOverlap.length > 0) {
        const posEpsilon = 1e-4;
        for (const lv of lowerOverlap) {
          const closest = findClosestVertex(lv.pos, upperMesh);
          assertApproxEqual(
            closest.distance,
            0,
            posEpsilon,
            `lower overlap vertex (${lv.pos.join(",")}) has no nearby upper vertex`
          );
        }
      }
    }
  });

  test("sphere crossing chunk boundary has matching boundary vertices", () => {
    const center: [number, number, number] = [CHUNK_SIZE, 16, 16];
    const radius = 10;
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
      ],
      sphere(center, radius)
    );

    const leftChunk = chunks.get("0,0,0")!;
    const rightChunk = chunks.get("1,0,0")!;

    const leftMesh = extractSurfaceNets(leftChunk.field, leftChunk.coord);
    const rightMesh = extractSurfaceNets(rightChunk.field, rightChunk.coord);

    assert.ok(leftMesh.vertexCount > 0, "left mesh should have vertices");
    assert.ok(rightMesh.vertexCount > 0, "right mesh should have vertices");

    const leftOverlap = meshVerticesInRange(leftMesh, "x", CHUNK_SIZE, CHUNK_SIZE + 1);
    const rightOverlap = meshVerticesInRange(rightMesh, "x", CHUNK_SIZE, CHUNK_SIZE + 1);

    assert.ok(leftOverlap.length > 0, "left chunk should have vertices in overlap region");
    assert.ok(rightOverlap.length > 0, "right chunk should have vertices in overlap region");

    const posEpsilon = 1e-4;
    for (const lv of leftOverlap) {
      const closest = findClosestVertex(lv.pos, rightMesh);
      assertApproxEqual(
        closest.distance,
        0,
        posEpsilon,
        `sphere overlap vertex (${lv.pos.join(",")}) has no nearby match`
      );
    }
  });

  test("boundary normals match within epsilon for flat plane", () => {
    const height = 16;
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
      ],
      flatPlane(height)
    );

    const leftChunk = chunks.get("0,0,0")!;
    const rightChunk = chunks.get("1,0,0")!;

    const leftMesh = extractSurfaceNets(leftChunk.field, leftChunk.coord);
    const rightMesh = extractSurfaceNets(rightChunk.field, rightChunk.coord);

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

      assertApproxEqual(lnx, rnx, normalEpsilon, `nx mismatch at (${lv.pos.join(",")})`);
      assertApproxEqual(lny, rny, normalEpsilon, `ny mismatch at (${lv.pos.join(",")})`);
      assertApproxEqual(lnz, rnz, normalEpsilon, `nz mismatch at (${lv.pos.join(",")})`);
    }
  });
});

describe("mesh structural counters", () => {
  test("flat plane produces expected vertex and index counts", () => {
    const height = 16;
    const chunks = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], flatPlane(height));
    const chunk = chunks.get("0,0,0")!;
    const mesh = extractSurfaceNets(chunk.field, chunk.coord);

    assert.ok(mesh.vertexCount > 0, "should produce vertices");
    assert.ok(mesh.indexCount > 0, "should produce indices");
    assert.equal(mesh.indexCount % 3, 0, "index count should be a multiple of 3");
    assert.equal(mesh.positions.length, mesh.vertexCount * 3, "positions length");
    assert.equal(mesh.normals.length, mesh.vertexCount * 3, "normals length");
    assert.equal(mesh.indices.length, mesh.indexCount, "indices length");
  });

  test("empty chunk produces no mesh", () => {
    const chunks = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], () => 10.0);
    const chunk = chunks.get("0,0,0")!;
    const mesh = extractSurfaceNets(chunk.field, chunk.coord);
    assert.equal(mesh.vertexCount, 0);
    assert.equal(mesh.indexCount, 0);
  });

  test("fully air chunk produces no mesh", () => {
    const chunks = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], () => -10.0);
    const chunk = chunks.get("0,0,0")!;
    const mesh = extractSurfaceNets(chunk.field, chunk.coord);
    assert.equal(mesh.vertexCount, 0);
    assert.equal(mesh.indexCount, 0);
  });
});
