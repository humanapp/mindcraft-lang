import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { coreModule, createMindcraftEnvironment } from "@mindcraft-lang/core";
import {
  findEmbeddedExtensionsMissingStableIds,
  formatEmbeddedExtensionIdViolations,
} from "./embedded-extension-id-gate.js";
import type { EmbeddedExtension } from "./embedded-extensions.js";

const OWNER = "test-owner";

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

function extension(repo: string, files: { path: string; content: string }[]): EmbeddedExtension {
  return { canonicalOrigin: `${OWNER}/${repo}`, files };
}

describe("embedded-extension stable-id build gate", () => {
  test("reports an embedded extension whose declaration ships without an explicit id", () => {
    const services = createMindcraftEnvironment({ modules: [coreModule()] }).brainServices;
    const embedRecord = [extension("missing-id-ext", [{ path: "scan.ts", content: sensorSource({ name: "scan" }) }])];

    const violations = findEmbeddedExtensionsMissingStableIds(embedRecord, services);

    assert.equal(violations.length, 1, `expected one violation, got ${JSON.stringify(violations)}`);
    assert.equal(violations[0].coordinate, `${OWNER}/missing-id-ext`);
    assert.equal(violations[0].path, "scan.ts");
    assert.match(violations[0].message, /sensor "scan"/);

    const rendered = formatEmbeddedExtensionIdViolations(violations);
    assert.match(rendered, new RegExp(`${OWNER}/missing-id-ext`));
    assert.match(rendered, /compile the extension as a writable project to mint one/);
  });

  test("reports nothing when every embedded declaration carries an explicit id", () => {
    const services = createMindcraftEnvironment({ modules: [coreModule()] }).brainServices;
    const embedRecord = [
      extension("scan-ext", [{ path: "scan.ts", content: sensorSource({ id: "extScan000000001", name: "scan" }) }]),
    ];

    const violations = findEmbeddedExtensionsMissingStableIds(embedRecord, services);

    assert.deepEqual(violations, [], formatEmbeddedExtensionIdViolations(violations));
  });
});
