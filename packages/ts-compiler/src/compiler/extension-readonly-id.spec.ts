/**
 * A declaration in a read-only extension (a dependency-mount compilation root)
 * that omits an explicit stable `id` is rejected with
 * `ExtensionDeclarationMissingId`, because the compiler cannot persist a minted
 * id back to the extension's regenerated-on-load source. A declaration carrying
 * an explicit `id` compiles cleanly. A writable host project keeps minting an
 * id and rewriting its source unchanged.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { BrainServices } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { CompileDiagCode } from "./diag-codes.js";
import { type ProjectCompileResult, UserTileProject } from "./project.js";
import { MultiRootSession, type ProjectRoot } from "./project-set.js";
import type { CompileDiagnostic } from "./types.js";

const EXT_NS = "acme/robot-ext";

function sensorSource(opts: { id?: string; name: string }): string {
  const idLine = opts.id ? `  id: ${JSON.stringify(opts.id)},\n` : "";
  return `import { Sensor, type Context } from "wendoo";

export default Sensor({
${idLine}  name: ${JSON.stringify(opts.name)},
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
}

function actuatorSource(opts: { id?: string; name: string }): string {
  const idLine = opts.id ? `  id: ${JSON.stringify(opts.id)},\n` : "";
  return `import { Actuator, type Context } from "wendoo";

export default Actuator({
${idLine}  name: ${JSON.stringify(opts.name)},
  onExecute(ctx: Context): void {},
});
`;
}

function conversionSource(opts: { id?: string }): string {
  const idLine = opts.id ? `  id: ${JSON.stringify(opts.id)},\n` : "";
  return `import { BufferType, Conversion, NumberType } from "wendoo";

export default Conversion({
${idLine}  from: NumberType,
  to: BufferType,
  cost: 2,
  convert(value: number): Buffer {
    return Buffer.from([value]);
  },
});
`;
}

function diagnosticsFor(result: ProjectCompileResult, path: string): CompileDiagnostic[] {
  return result.results.get(path)?.diagnostics ?? [];
}

function compileExtensionRoot(files: Record<string, string>): {
  services: BrainServices;
  result: ProjectCompileResult;
} {
  const services = __test__createBrainServices();
  const session = new MultiRootSession({ services });
  const roots: ProjectRoot[] = [{ namespace: EXT_NS, files: new Map(Object.entries(files)), readOnlySource: true }];
  session.setRoots(roots);
  const { roots: results } = session.compile();
  return { services, result: results.get(EXT_NS)! };
}

describe("read-only extension declarations require an explicit stable id", () => {
  test("a sensor without an id in a read-only extension root is rejected, mints nothing", () => {
    const { result } = compileExtensionRoot({ "range.ts": sensorSource({ name: "range" }) });

    const diags = diagnosticsFor(result, "range.ts");
    const missingId = diags.find((d) => d.code === CompileDiagCode.ExtensionDeclarationMissingId);
    assert.ok(missingId, `expected ExtensionDeclarationMissingId, got ${JSON.stringify(diags)}`);
    assert.equal(missingId.severity, "error");

    assert.equal(
      result.results.get("range.ts")?.program,
      undefined,
      "no program is built for the rejected declaration"
    );
    assert.equal(result.sourceRewrites.size, 0, "no source rewrite is minted for read-only source");
  });

  test("an actuator without an id in a read-only extension root is rejected", () => {
    const { result } = compileExtensionRoot({ "drive.ts": actuatorSource({ name: "drive" }) });

    const diags = diagnosticsFor(result, "drive.ts");
    assert.ok(diags.some((d) => d.code === CompileDiagCode.ExtensionDeclarationMissingId));
    assert.equal(result.sourceRewrites.size, 0);
  });

  test("a conversion without an id in a read-only extension root is rejected", () => {
    const { result } = compileExtensionRoot({ "conv.ts": conversionSource({}) });

    const diags = diagnosticsFor(result, "conv.ts");
    assert.ok(diags.some((d) => d.code === CompileDiagCode.ExtensionDeclarationMissingId));
    assert.equal(result.sourceRewrites.size, 0);
  });

  test("a declaration carrying an explicit id in a read-only extension root compiles cleanly", () => {
    const { result } = compileExtensionRoot({ "range.ts": sensorSource({ id: "extRange00000001", name: "range" }) });

    const diags = diagnosticsFor(result, "range.ts");
    assert.deepEqual(diags, [], `expected a clean compile, got ${JSON.stringify(diags)}`);
    assert.equal(result.results.get("range.ts")?.program?.key, `${EXT_NS}:user.sensor.extRange00000001`);
    assert.equal(result.sourceRewrites.size, 0);
  });

  test("a writable host project still mints an id and rewrites the source when one is omitted", () => {
    const services = __test__createBrainServices();
    const project = new UserTileProject({ projectNamespace: TEST_PROJECT_NAMESPACE, services });
    project.setFiles(new Map([["scan.ts", sensorSource({ name: "scan" })]]));
    const result = project.compileAll();

    const program = result.results.get("scan.ts")?.program;
    assert.ok(program, "the host project builds a program");
    assert.match(program.id, /^[A-Za-z0-9]{16}$/);
    assert.ok(
      !diagnosticsFor(result, "scan.ts").some((d) => d.code === CompileDiagCode.ExtensionDeclarationMissingId),
      "the host project is not subject to the read-only guard"
    );

    const rewritten = result.sourceRewrites.get("scan.ts");
    assert.ok(rewritten, "the host project rewrites the source with the minted id");
    assert.match(rewritten, new RegExp(`id: "${program.id}"`));
  });
});
