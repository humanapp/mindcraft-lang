/**
 * Runtime allow-list firewall test.
 *
 * Mechanizes the architectural invariant: every value-import reachable
 * from `packages/core/src/runtime/` resolves only to `runtime/`,
 * `platform/`, or `localization/`. Runs the `dependency-cruiser` programmatic API against
 * the rule defined in `packages/core/.dependency-cruiser.cjs` and
 * asserts the live violation count equals `BASELINE_VIOLATIONS`.
 *
 * The canonical load-bearing example of a runtime-side consumer is
 * `runtime/brain-runtime.ts`: it holds the full page-lifecycle FSM,
 * VM, scheduler, and variable storage, yet value-imports nothing from
 * `brain/`. Any change that adds a value-import from `brain/` to any
 * file under `runtime/` will increment the violation count and fail
 * this test.
 *
 * A separate self-test asserts the rule fires against a synthetic
 * fixture that imports a `brain/` value from under `runtime/`. The
 * self-test guards against silently-passing misconfiguration (wrong
 * `tsConfig` reference, wrong rule glob, missing severity, etc.).
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, test } from "node:test";
import type {
  ICruiseOptions,
  ICruiseResult,
  IFlattenedRuleSet,
  IForbiddenRuleType,
  IViolation,
} from "dependency-cruiser";

// `dependency-cruiser` is ESM-only (no `require` condition in its
// `exports` map). This spec compiles under `module=commonjs` via
// `tsconfig.node.json`, so a top-level value-import would be emitted
// as `require()` and fail to resolve. Dynamic `import()` is preserved
// as a real ESM import by `tsx` and works in either module system.
async function loadCruise(): Promise<typeof import("dependency-cruiser").cruise> {
  const mod = await import("dependency-cruiser");
  return mod.cruise;
}

const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const CONFIG_PATH = path.join(PACKAGE_ROOT, ".dependency-cruiser.cjs");
const FIXTURE_PATH = "src/runtime/__fixtures__/disallowed-import.fixture.ts";

const RULE_NAME = "runtime-allow-list";
const SELF_TEST_RULE_NAME = "runtime-allow-list-selftest";

interface ConfigShape {
  forbidden: IForbiddenRuleType[];
  options: ICruiseOptions;
}

function loadConfig(): ConfigShape {
  // .cjs file is CommonJS; tsconfig.node.json sets module=commonjs,
  // so a plain require resolves it.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(CONFIG_PATH) as ConfigShape;
}

function asResult(output: ICruiseResult | string): ICruiseResult {
  if (typeof output === "string") {
    return JSON.parse(output) as ICruiseResult;
  }
  return output;
}

function locateImportLine(importerRelPath: string, unresolvedSpecifier: string | undefined): number {
  if (!unresolvedSpecifier) {
    return 0;
  }
  const absPath = path.join(PACKAGE_ROOT, importerRelPath);
  let src: string;
  try {
    src = fs.readFileSync(absPath, "utf8");
  } catch {
    return 0;
  }
  const lines = src.split("\n");
  const needles = [`"${unresolvedSpecifier}"`, `'${unresolvedSpecifier}'`];
  for (let i = 0; i < lines.length; i++) {
    for (const needle of needles) {
      if (lines[i].includes(needle)) {
        return i + 1;
      }
    }
  }
  return 0;
}

function extractImportedSymbols(
  importerRelPath: string,
  unresolvedSpecifier: string | undefined,
  lineNumber: number
): string {
  if (!unresolvedSpecifier || lineNumber <= 0) {
    return "*";
  }
  const absPath = path.join(PACKAGE_ROOT, importerRelPath);
  let src: string;
  try {
    src = fs.readFileSync(absPath, "utf8");
  } catch {
    return "*";
  }
  const line = src.split("\n")[lineNumber - 1] ?? "";
  // Best-effort: match `import { a, b } from "x"`, `import * as ns`,
  // `import name`, `import("x")`. Falls back to "*" when uncertain.
  const namedMatch = line.match(/import\s+(?:type\s+)?\{\s*([^}]+?)\s*\}/);
  if (namedMatch) {
    return namedMatch[1].replace(/\s+/g, " ").trim();
  }
  const namespaceMatch = line.match(/import\s+(?:type\s+)?\*\s+as\s+(\w+)/);
  if (namespaceMatch) {
    return `* as ${namespaceMatch[1]}`;
  }
  const defaultMatch = line.match(/import\s+(\w+)\s+from/);
  if (defaultMatch) {
    return defaultMatch[1];
  }
  return "*";
}

function formatViolation(violation: IViolation): string {
  const line = locateImportLine(violation.from, violation.unresolvedTo);
  const symbol = extractImportedSymbols(violation.from, violation.unresolvedTo, line);
  return `firewall: ${violation.from}:${line} imports ${symbol} from ${violation.to} (rule: ${violation.rule.name})`;
}

async function runCruise(
  filesAndDirs: string[],
  ruleSet: IFlattenedRuleSet,
  baseOptions: ICruiseOptions
): Promise<IViolation[]> {
  const cruise = await loadCruise();
  const result = await cruise(filesAndDirs, {
    ...baseOptions,
    validate: true,
    ruleSet,
  });
  const cruiseResult = asResult(result.output);
  return cruiseResult.summary?.violations ?? [];
}

describe("runtime allow-list firewall", () => {
  test("violation count is zero", async () => {
    const config = loadConfig();
    const violations = (await runCruise(["src"], { forbidden: config.forbidden }, config.options)).filter(
      (v) => v.rule.name === RULE_NAME
    );

    if (violations.length > 0) {
      const lines = violations.map(formatViolation).join("\n");
      assert.fail(`firewall: ${violations.length} ${RULE_NAME} violations:\n${lines}`);
    }
    assert.strictEqual(violations.length, 0);
    console.log("firewall: clean (0 violations)");
  });

  test("self-test: rule fires on disallowed-import fixture", async () => {
    const config = loadConfig();
    const baseRule = config.forbidden.find((r) => r.name === RULE_NAME);
    assert.ok(baseRule, `firewall self-test: rule '${RULE_NAME}' not found in config`);

    // Re-derive the rule without the fixtures path-exclusion so the
    // rule can fire against the synthetic fixture file. The from-glob
    // is otherwise unchanged; the production rule itself catches the
    // violation.
    const selfTestRule: IForbiddenRuleType = {
      ...baseRule,
      name: SELF_TEST_RULE_NAME,
      from: { ...baseRule.from, pathNot: undefined },
    };

    const violations = (await runCruise([FIXTURE_PATH], { forbidden: [selfTestRule] }, config.options)).filter(
      (v) => v.rule.name === SELF_TEST_RULE_NAME
    );

    assert.ok(
      violations.length >= 1,
      `firewall self-test: expected at least 1 ${SELF_TEST_RULE_NAME} violation against ${FIXTURE_PATH}; got 0. ` +
        "This means dependency-cruiser is silently misconfigured (likely a wrong tsConfig path, " +
        "an unresolved fixture path, or a rule glob that does not match src/runtime/)."
    );
  });
});
