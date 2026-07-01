import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import type { LoweringDiagCode } from "../compiler/diag-codes.js";
import type { CompileDiagnostic } from "../compiler/types.js";

/**
 * Environment variable naming the coverage sink file. Set only by the full
 * `npm test` run; when unset (an ad-hoc single-file run) nothing is recorded and
 * the helpers below behave as plain assertions.
 */
const SINK_ENV = "DIAG_COVERAGE_SINK";

function recordCovered(code: number): void {
  const sink = process.env[SINK_ENV];
  if (!sink) {
    return;
  }
  try {
    appendFileSync(sink, `${code}\n`);
  } catch {
    // Sink unwritable: skip recording; the assertion result is unaffected.
  }
}

/**
 * Assert that `diagnostics` contains a diagnostic whose code is `code`, and
 * return that diagnostic so the caller can further assert on its message or
 * position. Records `code` as covered for the lowering-diagnostic coverage gate.
 */
export function expectDiagnostic(
  diagnostics: readonly CompileDiagnostic[],
  code: LoweringDiagCode,
  message?: string
): CompileDiagnostic {
  const match = diagnostics.find((d) => d.code === code);
  if (!match) {
    assert.fail(message ?? `expected diagnostic ${code}, got ${JSON.stringify(diagnostics)}`);
  }
  recordCovered(code);
  return match;
}

/**
 * Assert that `diagnostics` contains no diagnostic whose code is `code`. Does
 * not record coverage: asserting a code is absent does not exercise its
 * emission.
 */
export function expectNoDiagnostic(
  diagnostics: readonly CompileDiagnostic[],
  code: LoweringDiagCode,
  message?: string
): void {
  const match = diagnostics.find((d) => d.code === code);
  assert.ok(!match, message ?? `expected no diagnostic ${code}, got ${JSON.stringify(diagnostics)}`);
}
