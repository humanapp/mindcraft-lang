import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

function componentSource(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
}

/**
 * Diagnostic-payload accesses of the install report. The toast path presents
 * through the shared presenter, whose payloads carry no diagnostics, so the
 * component never reads the report's problem lists.
 */
const REPORT_DIAGNOSTIC_ACCESSES = [/outcome\.newProblems/, /outcome\.resolvedProblems/, /typecheckResult/i];

describe("the extension toast path consumes no brain-diagnostic state", () => {
  test("Sidebar.tsx references no diagnostic payload of the install report", () => {
    const source = componentSource("Sidebar.tsx");
    for (const identifier of REPORT_DIAGNOSTIC_ACCESSES) {
      assert.doesNotMatch(source, identifier);
    }
  });
});
