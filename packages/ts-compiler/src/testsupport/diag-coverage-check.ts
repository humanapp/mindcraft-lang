import { readFileSync } from "node:fs";
import { LoweringDiagCode } from "../compiler/diag-codes.js";
import { KNOWN_UNTESTED } from "./diag-coverage-allowlist.js";

// Free-slot enum members (Unused0, Unused1, ...) hold a reserved numeric id for
// future reuse and are not diagnostics, so they are outside the coverage universe:
// they need no test and no allowlist entry.
const FREE_SLOT = /^Unused\d+$/;

/** Map of each real (non-free-slot) `LoweringDiagCode` member name to its numeric value. */
function loweringDiagMembers(): Map<string, number> {
  const members = new Map<string, number>();
  for (const [name, value] of Object.entries(LoweringDiagCode)) {
    if (typeof value === "number" && !FREE_SLOT.test(name)) {
      members.set(name, value);
    }
  }
  return members;
}

/** Numeric diagnostic codes recorded in the sink that are real lowering codes. */
function readCoveredCodes(sinkPath: string, valid: Set<number>): Set<number> {
  const covered = new Set<number>();
  const raw = readFileSync(sinkPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const code = Number(trimmed);
    if (valid.has(code)) {
      covered.add(code);
    }
  }
  return covered;
}

function main(): void {
  const sinkPath = process.env.DIAG_COVERAGE_SINK;
  if (!sinkPath) {
    process.stderr.write("diag-coverage-check: DIAG_COVERAGE_SINK is not set; run via `npm test`.\n");
    process.exit(1);
  }

  const members = loweringDiagMembers();
  const nameByValue = new Map<number, string>();
  for (const [name, value] of members) {
    nameByValue.set(value, name);
  }
  const validValues = new Set(members.values());

  let covered: Set<number>;
  try {
    covered = readCoveredCodes(sinkPath, validValues);
  } catch {
    process.stderr.write(`diag-coverage-check: sink ${sinkPath} is missing; no diagnostics were recorded.\n`);
    process.exit(1);
  }

  const allowlist = new Set<number>();
  const staleAllowlist: string[] = [];
  for (const name of KNOWN_UNTESTED) {
    const value = members.get(name);
    if (value === undefined) {
      staleAllowlist.push(name);
    } else {
      allowlist.add(value);
    }
  }

  const untested: string[] = [];
  for (const [name, value] of members) {
    if (!covered.has(value) && !allowlist.has(value)) {
      untested.push(name);
    }
  }

  const nowCovered: string[] = [];
  for (const value of allowlist) {
    if (covered.has(value)) {
      nowCovered.push(nameByValue.get(value) ?? String(value));
    }
  }

  const problems: string[] = [];
  if (untested.length > 0) {
    untested.sort();
    problems.push(
      `${untested.length} LoweringDiagCode(s) have no test asserting emission and are not allowlisted:\n  ${untested.join("\n  ")}`
    );
  }
  if (nowCovered.length > 0) {
    nowCovered.sort();
    problems.push(
      `${nowCovered.length} allowlisted code(s) now have a test; delete them from KNOWN_UNTESTED (ratchet):\n  ${nowCovered.join("\n  ")}`
    );
  }
  if (staleAllowlist.length > 0) {
    staleAllowlist.sort();
    problems.push(
      `${staleAllowlist.length} KNOWN_UNTESTED name(s) are not LoweringDiagCode members:\n  ${staleAllowlist.join("\n  ")}`
    );
  }

  if (problems.length > 0) {
    process.stderr.write(`Lowering diagnostic coverage gate FAILED:\n\n${problems.join("\n\n")}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `Lowering diagnostic coverage OK: ${covered.size}/${members.size} codes tested, ${allowlist.size} allowlisted.\n`
  );
}

main();
