import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { buildAmbientDeclarations } from "./ambient.js";
import { CompileDiagCode, DescriptorDiagCode } from "./diag-codes.js";
import { UserTileProject } from "./project.js";

let services: BrainServices;

function compileProject(files: Record<string, string>) {
  const ambientSource = buildAmbientDeclarations(services.types);
  const project = new UserTileProject({ ambientSource, services });
  project.setFiles(new Map(Object.entries(files)));
  return project.compileAll();
}

const SENSOR_WITH_METADATA = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-sensor",
  output: "boolean",
  label: "Test Sensor",
  icon: "./my-icon.svg",
  docs: "./my-docs.md",
  tags: ["movement", "sensing"],
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;

const SENSOR_MINIMAL = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "bare-sensor",
  output: "boolean",
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;

describe("tile metadata extraction", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("extracts label, iconUrl, docsMarkdown, and tags from sensor config", () => {
    const result = compileProject({
      "test-sensor.ts": SENSOR_WITH_METADATA,
      "my-icon.svg": "<svg></svg>",
      "my-docs.md": "# Test Sensor\nThis sensor does things.",
    });

    assert.equal(result.tsErrors.size, 0);
    const entry = result.results.get("test-sensor.ts");
    assert.ok(entry, "expected compile result for test-sensor.ts");
    assert.ok(entry.program, "expected a compiled program");

    assert.equal(entry.program.label, "Test Sensor");
    assert.equal(entry.program.iconUrl, "/vfs/my-icon.svg");
    assert.equal(entry.program.docsMarkdown, "# Test Sensor\nThis sensor does things.");
    assert.deepStrictEqual(entry.program.tags, ["movement", "sensing"]);
  });

  test("label defaults to name when not specified", () => {
    const result = compileProject({
      "bare-sensor.ts": SENSOR_MINIMAL,
    });

    const entry = result.results.get("bare-sensor.ts");
    assert.ok(entry?.program, "expected a compiled program");
    assert.equal(entry.program.label, "bare-sensor");
  });

  test("emits warning when icon file is missing from workspace", () => {
    const result = compileProject({
      "test-sensor.ts": SENSOR_WITH_METADATA,
      "my-docs.md": "# Docs",
    });

    const entry = result.results.get("test-sensor.ts");
    assert.ok(entry, "expected compile result");
    assert.ok(entry.program, "expected a compiled program despite warning");

    const iconWarning = entry.diagnostics.find(
      (d) => d.code === CompileDiagCode.MetadataFileNotFound && d.message.includes("my-icon.svg")
    );
    assert.ok(iconWarning, "expected a warning for missing icon file");
    assert.equal(iconWarning.severity, "warning");
    assert.equal(entry.program.iconUrl, undefined);
  });

  test("emits warning when docs file is missing from workspace", () => {
    const result = compileProject({
      "test-sensor.ts": SENSOR_WITH_METADATA,
      "my-icon.svg": "<svg></svg>",
    });

    const entry = result.results.get("test-sensor.ts");
    assert.ok(entry, "expected compile result");
    assert.ok(entry.program, "expected a compiled program despite warning");

    const docsWarning = entry.diagnostics.find(
      (d) => d.code === CompileDiagCode.MetadataFileNotFound && d.message.includes("my-docs.md")
    );
    assert.ok(docsWarning, "expected a warning for missing docs file");
    assert.equal(docsWarning.severity, "warning");
    assert.equal(entry.program.docsMarkdown, undefined);
  });

  test("icon path in a subdirectory resolves correctly", () => {
    const sensorSource = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "sub-sensor",
  output: "boolean",
  icon: "./assets/icon.png",
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    const result = compileProject({
      "tiles/sub-sensor.ts": sensorSource,
      "tiles/assets/icon.png": "PNG_DATA",
    });

    const entry = result.results.get("tiles/sub-sensor.ts");
    assert.ok(entry?.program, "expected a compiled program");
    assert.equal(entry.program.iconUrl, "/vfs/tiles/assets/icon.png");
  });

  test("label must be a string literal", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";
const myLabel = "dynamic";
export default Sensor({
  name: "bad-label",
  output: "boolean",
  label: myLabel,
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    const result = compileProject({ "bad.ts": source });
    const entry = result.results.get("bad.ts");
    assert.ok(entry, "expected compile result");
    const diag = entry.diagnostics.find((d) => d.code === DescriptorDiagCode.LabelMustBeStringLiteral);
    assert.ok(diag, "expected LabelMustBeStringLiteral diagnostic");
  });

  test("tags must be an array literal of strings", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";
export default Sensor({
  name: "bad-tags",
  output: "boolean",
  tags: "not-an-array" as any,
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    const result = compileProject({ "bad-tags.ts": source });
    const entry = result.results.get("bad-tags.ts");
    assert.ok(entry, "expected compile result");
    const diag = entry.diagnostics.find((d) => d.code === DescriptorDiagCode.TagsMustBeArrayLiteral);
    assert.ok(diag, "expected TagsMustBeArrayLiteral diagnostic");
  });

  test("tag elements must be string literals", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";
const x = "dynamic";
export default Sensor({
  name: "bad-tag-elem",
  output: "boolean",
  tags: ["ok", x],
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    const result = compileProject({ "bad-tag-elem.ts": source });
    const entry = result.results.get("bad-tag-elem.ts");
    assert.ok(entry, "expected compile result");
    const diag = entry.diagnostics.find((d) => d.code === DescriptorDiagCode.TagElementMustBeStringLiteral);
    assert.ok(diag, "expected TagElementMustBeStringLiteral diagnostic");
  });
});
