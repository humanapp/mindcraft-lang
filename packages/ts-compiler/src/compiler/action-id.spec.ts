import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { UserTileProject } from "./project.js";

let services: BrainServices;

function sensorSource(opts: { id?: string; name: string }): string {
  const idLine = opts.id ? `  id: ${JSON.stringify(opts.id)},\n` : "";
  return `import { Sensor, type Context } from "mindcraft";

export default Sensor({
${idLine}  name: ${JSON.stringify(opts.name)},
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
}

function compile(files: ReadonlyMap<string, string>, generateActionId?: () => string) {
  const project = new UserTileProject({ services, generateActionId });
  project.setFiles(files);
  return project.compileAll();
}

describe("user-action stable id", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("mints a stable id and rewrites the source when the declaration omits one", () => {
    const path = "scan.ts";
    const result = compile(new Map([[path, sensorSource({ name: "scan" })]]));

    const program = result.results.get(path)?.program;
    assert.ok(program);
    assert.match(program.id, /^[A-Za-z0-9]{16}$/);
    assert.equal(program.key, `user.sensor.${program.id}`);

    const rewritten = result.sourceRewrites.get(path);
    assert.ok(rewritten, "a source rewrite should be emitted for a declaration missing an id");
    assert.match(rewritten, new RegExp(`id: "${program.id}"`));
  });

  test("keys the action off an explicitly supplied id and emits no rewrite", () => {
    const path = "scan.ts";
    const result = compile(new Map([[path, sensorSource({ id: "myStableId", name: "scan" })]]));

    assert.equal(result.results.get(path)?.program?.key, "user.sensor.myStableId");
    assert.equal(result.sourceRewrites.size, 0);
  });

  test("recompiling the rewritten source reuses the id (stable across compiles)", () => {
    const path = "scan.ts";
    const first = compile(new Map([[path, sensorSource({ name: "scan" })]]));
    const mintedKey = first.results.get(path)!.program!.key;
    const rewritten = first.sourceRewrites.get(path)!;

    const second = compile(new Map([[path, rewritten]]));
    assert.equal(second.results.get(path)?.program?.key, mintedKey);
    assert.equal(second.sourceRewrites.size, 0);
  });

  test("renaming the action name leaves the key unchanged", () => {
    const path = "scan.ts";
    const minted = compile(new Map([[path, sensorSource({ id: "keepme", name: "scan" })]]));
    const original = minted.results.get(path)!.program!;
    assert.equal(original.key, "user.sensor.keepme");

    const renamed = compile(new Map([[path, sensorSource({ id: "keepme", name: "radar" })]]));
    const after = renamed.results.get(path)!.program!;
    assert.equal(after.key, original.key);
    assert.equal(after.name, "radar");
  });

  test("each action without an id receives a distinct minted id", () => {
    const result = compile(
      new Map([
        ["one.ts", sensorSource({ name: "one" })],
        ["two.ts", sensorSource({ name: "two" })],
      ])
    );
    const a = result.results.get("one.ts")!.program!.id;
    const b = result.results.get("two.ts")!.program!.id;
    assert.notEqual(a, b);
  });

  test("the id generator is injectable for deterministic output", () => {
    const path = "scan.ts";
    const result = compile(new Map([[path, sensorSource({ name: "scan" })]]), () => "fixedActionId01");
    assert.equal(result.results.get(path)?.program?.key, "user.sensor.fixedActionId01");
    assert.match(result.sourceRewrites.get(path)!, /id: "fixedActionId01"/);
  });

  test("substitutes the tile-id placeholder in docs with the compiled tile's id-based tile id", () => {
    const source = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "docid",
  name: "scan",
  docs: "./scan.md",
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal docs placeholder under test
    const docsTemplate = "before ${tileId} after";
    const project = new UserTileProject({ services });
    project.setFiles(
      new Map([
        ["scan.ts", source],
        ["scan.md", docsTemplate],
      ])
    );
    const result = project.compileAll();
    assert.equal(result.results.get("scan.ts")?.program?.docsMarkdown, "before tile.sensor->user.sensor.docid after");
  });
});
