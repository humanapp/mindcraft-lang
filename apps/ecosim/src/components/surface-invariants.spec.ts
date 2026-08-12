import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

function componentSource(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
}

/** Every index `pattern` matches in `source`. */
function indexesOf(source: string, pattern: RegExp): number[] {
  return [...source.matchAll(new RegExp(pattern, "g"))].map((match) => match.index ?? -1);
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

describe("only the person's own open of the assistant region takes the keyboard", () => {
  const appSource = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");

  test("App.tsx raises the count of the person's own opens nowhere but in the region's toggle", () => {
    const [raise, ...furtherRaises] = indexesOf(appSource, /setAssistantOpensByPerson\(\(opens\)/);
    const toggle = appSource.indexOf("const toggleAssistant = useCallback(");
    const afterToggle = appSource.indexOf("}, [brainId, isAssistantOpen]);", toggle);

    assert.ok(toggle >= 0, "the app stands a toggle for the region");
    assert.ok(raise !== undefined, "the toggle raises the count");
    assert.deepEqual(furtherRaises, [], "nothing else raises it");
    assert.ok(raise > toggle && raise < afterToggle, "the raise stands in the toggle");
  });

  test("App.tsx starts the count over for the brain the editor stands, so a restored open takes no keyboard", () => {
    const [drop, ...furtherDrops] = indexesOf(appSource, /setAssistantOpensByPerson\(undefined\)/);

    assert.ok(drop !== undefined, "the count is started over");
    assert.deepEqual(furtherDrops, [], "in one place");
    assert.match(appSource.slice(drop), /^setAssistantOpensByPerson\(undefined\);\s*\},\s*\[brainId\]\);/);
  });

  test("App.tsx hands the count to the region's tenant", () => {
    assert.match(appSource, /opensByPerson=\{assistantOpensByPerson\}/);
  });

  test("AssistantSidePanel.tsx hands the count on to the conversation surface", () => {
    assert.match(componentSource("AssistantSidePanel.tsx"), /opensByPerson=\{opensByPerson\}/);
  });
});
