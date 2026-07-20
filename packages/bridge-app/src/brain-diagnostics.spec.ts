import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coreModule, createMindcraftEnvironment } from "@mindcraft-lang/core";
import type { IBrainDef } from "@mindcraft-lang/core/app";
import { BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { collectBrainErrorDiagnostics } from "./brain-diagnostics.js";
import { typecheckBrainProblems } from "./extension-install.js";

const PROJECT_ID = "p1";
const CUTEBOT = "acme/lib-cutebot";

/** A persisted brain whose only rule references an actuator owned by `ns`, which is not installed. */
function brainJsonUsingMissingLibrary(ns: string): Record<string, unknown> {
  return {
    version: 1,
    id: "brain00000000001",
    name: "Driver",
    catalog: [],
    pages: [
      {
        version: 2,
        pageId: "page000000000001",
        name: "Page 1",
        rules: [
          {
            version: 1,
            when: [],
            do: [{ k: "action", area: "actuator", id: "abcd000000000001", ns }],
            children: [],
          },
        ],
      },
    ],
  };
}

/** A persisted brain with one empty rule. */
function emptyBrainJson(): Record<string, unknown> {
  return {
    version: 1,
    id: "brain00000000002",
    name: "Quiet",
    catalog: [],
    pages: [
      {
        version: 2,
        pageId: "page000000000002",
        name: "Page 1",
        rules: [{ version: 1, when: [], do: [], children: [] }],
      },
    ],
  };
}

/** Deserialize a persisted brain and establish its stored typecheck state, as the host's load path does. */
function loadTypecheckedBrain(json: Record<string, unknown>): IBrainDef {
  const environment = createMindcraftEnvironment({ modules: [coreModule()] });
  const brain = environment.deserializeBrainJsonFromPlain(json, PROJECT_ID);
  typecheckBrainProblems(brain);
  return brain;
}

/** The stored per-rule diagnostics of a brain, read independently of the collector: {code, location, message} rows. */
function storedDiagnosticRows(brain: IBrainDef): { code: number; location: string; message: string }[] {
  const rows: { code: number; location: string; message: string }[] = [];
  brain.pages().forEach((page) => {
    page.children().forEach((rule) => {
      if (!(rule instanceof BrainRuleDef)) {
        return;
      }
      const result = rule.when().typecheckResult();
      if (!result) {
        return;
      }
      const location = rule.getLocationPath();
      result.whenParseResult.diags.forEach((diag) => {
        rows.push({ code: diag.code, location, message: diag.message });
      });
      result.doParseResult.diags.forEach((diag) => {
        rows.push({ code: diag.code, location, message: diag.message });
      });
      result.typeInfo.diags.forEach((diag) => {
        rows.push({ code: diag.code, location, message: diag.message });
      });
    });
  });
  return rows;
}

describe("collectBrainErrorDiagnostics", () => {
  it("reports nothing for a brain whose stored typecheck state is clean", () => {
    const brain = loadTypecheckedBrain(emptyBrainJson());
    assert.deepEqual(collectBrainErrorDiagnostics(brain), []);
  });

  it("returns the stored diagnostics verbatim: code, rule location, and compiler message", () => {
    const brain = loadTypecheckedBrain(brainJsonUsingMissingLibrary(CUTEBOT));
    const collected = collectBrainErrorDiagnostics(brain);
    assert.ok(collected.length > 0, "a rule holding a missing library tile carries stored diagnostics");
    assert.deepEqual(collected, storedDiagnosticRows(brain), "each row is the stored diagnostic as emitted");
    for (const entry of collected) {
      assert.equal(entry.location, "Page 1/Rule 1");
      assert.equal(typeof entry.code, "number");
    }
  });
});
