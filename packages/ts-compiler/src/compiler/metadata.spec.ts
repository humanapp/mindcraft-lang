import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import type { FileContent } from "@wendoo/service-api";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { buildAmbientDeclarations } from "./ambient.js";
import { CompileDiagCode, DescriptorDiagCode } from "./diag-codes.js";
import type { DependencyMount } from "./extension-mounts.js";
import { UserTileProject } from "./project.js";

let services: BrainServices;

function compileProject(files: Record<string, FileContent>, dependencyMounts?: readonly DependencyMount[]) {
  const ambientSource = buildAmbientDeclarations(services.runtime.types);
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
    services,
    ...(dependencyMounts
      ? { dependencies: dependencyMounts.map((mount) => ({ coordinate: mount.namespace })), dependencyMounts }
      : {}),
  });
  project.setFiles(new Map(Object.entries(files)));
  return project.compileAll();
}

const SENSOR_WITH_METADATA = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "test-sensor",
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
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "bare-sensor",
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
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "sub-sensor",
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

  test("an icon whose bytes are a real png resolves and is kept out of the TypeScript program", () => {
    const sensorSource = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "png-sensor",
  icon: "./icon.png",
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    // The first bytes of a real PNG: signature plus the IHDR chunk header.
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);

    const result = compileProject({
      "tiles/png-sensor.ts": sensorSource,
      "tiles/icon.png": pngBytes,
    });

    const entry = result.results.get("tiles/png-sensor.ts");
    assert.ok(entry?.program, "expected a compiled program");
    assert.equal(entry.program.iconUrl, "/vfs/tiles/icon.png");
    assert.deepEqual(
      entry.diagnostics.filter((d) => d.code === CompileDiagCode.MetadataFileNotFound),
      [],
      "a binary icon that is present on disk is found"
    );
    assert.deepEqual([...result.tsErrors.keys()], [], "the png is never handed to TypeScript as source");
  });

  test("a dependency mount's binary asset is materialized-but-uncompiled and its source still resolves", () => {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    const mount: DependencyMount = {
      namespace: "acme/widget",
      files: new Map<string, FileContent>([
        ["/index.ts", "export const widgetRate = 2;\n"],
        ["/icon.png", pngBytes],
      ]),
    };
    const sensorSource = `
import { Sensor, type Context } from "wendoo";
import { widgetRate } from "@lib/acme/widget";

export default Sensor({
  name: "mounted-asset-sensor",
  onExecute(ctx: Context): boolean {
    return widgetRate > 1;
  },
});
`;

    const result = compileProject({ "tiles/mounted.ts": sensorSource }, [mount]);

    const entry = result.results.get("tiles/mounted.ts");
    assert.ok(entry?.program, "the mount's TypeScript source still compiles");
    assert.deepEqual([...result.tsErrors.keys()], [], "the mount's png is never handed to TypeScript as source");
  });

  test("a docs reference naming a binary file reports the metadata-not-found warning", () => {
    const sensorSource = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "binary-docs-sensor",
  docs: "./docs.md",
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    const result = compileProject({
      "tiles/binary-docs-sensor.ts": sensorSource,
      "tiles/docs.md": new Uint8Array([0x00, 0xff, 0xfe]),
    });

    const entry = result.results.get("tiles/binary-docs-sensor.ts");
    assert.ok(entry?.program);
    assert.equal(entry.program.docsMarkdown, undefined);
    assert.ok(
      entry.diagnostics.some((d) => d.code === CompileDiagCode.MetadataFileNotFound),
      "docs that are not text are reported, never silently dropped"
    );
  });

  test("read-only extension root resolves leading-slash asset keys to a namespace-aware icon URL", () => {
    const sensorSource = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "widget-sensor",
  id: "widgetSensor0001",
  icon: "./widget.svg",
  docs: "./widget.md",
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    const ambientSource = buildAmbientDeclarations(services.runtime.types);
    const project = new UserTileProject({
      projectNamespace: "acme/widget",
      ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
      services,
      publishEntry: true,
      readOnlySource: true,
    });
    // An extension mount keys its files with a leading slash.
    project.setFiles(
      new Map([
        ["/widget-sensor.ts", sensorSource],
        ["/widget.svg", "<svg></svg>"],
        ["/widget.md", "# Widget\nContent."],
      ])
    );

    const result = project.compileAll();
    assert.equal(result.tsErrors.size, 0);
    const entry = result.results.get("widget-sensor.ts");
    assert.ok(entry?.program, "expected a compiled program");

    const assetDiag = entry.diagnostics.find((d) => d.code === CompileDiagCode.MetadataFileNotFound);
    assert.equal(assetDiag, undefined, "extension asset should resolve without a MetadataFileNotFound diagnostic");

    assert.equal(entry.program.iconUrl, "/vfs/.libraries/acme/widget/widget.svg");
    assert.equal(entry.program.docsMarkdown, "# Widget\nContent.");
  });

  test("label must be a string literal", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
const myLabel = "dynamic";
export default Sensor({
  name: "bad-label",
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
import { Sensor, type Context } from "wendoo";
export default Sensor({
  name: "bad-tags",
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
import { Sensor, type Context } from "wendoo";
const x = "dynamic";
export default Sensor({
  name: "bad-tag-elem",
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
