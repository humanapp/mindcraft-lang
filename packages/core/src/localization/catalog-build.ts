import { Dict } from "../platform/dict";
import { List } from "../platform/list";
import { StringUtils as SU } from "../platform/string";
import type { PluralClause, PluralRuleSpec, PluralTest } from "./plural";
import { parseTemplate, type TemplateDiagCode } from "./template";

/** One translation destined for a generated catalog module. */
export interface CatalogEntryInput {
  /** Context tag the entry is filed under; omitted for a plain key. */
  readonly context?: string;
  /** The English source string that keys the entry. */
  readonly source: string;
  /** The locale's template for that source. */
  readonly translation: string;
}

/** Inputs for one generated catalog module. */
export interface CatalogModuleInput {
  readonly locale: string;
  readonly pluralRule: PluralRuleSpec;
  /** Entries in the order they are emitted. */
  readonly entries: readonly CatalogEntryInput[];
}

/** A malformed translation template, located by the entry it belongs to. */
export interface CatalogBuildIssue {
  readonly code: TemplateDiagCode;
  readonly context?: string;
  readonly source: string;
  /** Character offset of the fault within the translation template. */
  readonly index: number;
}

/**
 * The generated module text plus every malformed template found. `source` is
 * always complete; callers treat a non-empty `issues` list as a build failure.
 */
export interface CatalogModuleResult {
  readonly source: string;
  readonly issues: readonly CatalogBuildIssue[];
}

function quote(text: string): string {
  let out = SU.split(text, "\\").join("\\\\");
  out = SU.split(out, '"').join('\\"');
  out = SU.split(out, "\n").join("\\n");
  out = SU.split(out, "\r").join("\\r");
  out = SU.split(out, "\t").join("\\t");
  return `"${out}"`;
}

function emitTest(test: PluralTest): string {
  let out = `{ operand: ${quote(test.operand)}`;
  if (test.mod !== undefined) {
    out += `, mod: ${SU.toString(test.mod)}`;
  }
  if (test.not === true) {
    out += ", not: true";
  }
  const ranges = new List<string>();
  for (const range of test.ranges) {
    ranges.push(`{ lo: ${SU.toString(range.lo)}, hi: ${SU.toString(range.hi)} }`);
  }
  return `${out}, ranges: [${ranges.toArray().join(", ")}] }`;
}

function emitClause(clause: PluralClause): string {
  const groups = new List<string>();
  for (const group of clause.any) {
    const tests = new List<string>();
    for (const test of group) {
      tests.push(emitTest(test));
    }
    groups.push(`      [${tests.toArray().join(", ")}],`);
  }
  const body = groups.toArray().join("\n");
  return `  {\n    category: ${quote(clause.category)},\n    any: [\n${body}\n    ],\n  },`;
}

function emitPluralRule(rule: PluralRuleSpec): string {
  const clauses = new List<string>();
  for (const clause of rule) {
    clauses.push(emitClause(clause));
  }
  if (clauses.size() === 0) {
    return "export const pluralRule = [] as const;";
  }
  return `export const pluralRule = [\n${clauses.toArray().join("\n")}\n] as const;`;
}

function emitRecord(name: string, valueType: string, lines: List<string>): string {
  if (lines.size() === 0) {
    return `export const ${name}: ${valueType} = {};`;
  }
  return `export const ${name}: ${valueType} = {\n${lines.toArray().join("\n")}\n};`;
}

/**
 * Generate the TypeScript module for one locale's catalog.
 *
 * The emitted module exports `locale`, `pluralRule`, `entries`, and
 * `contexts` and imports nothing, so a host loads it with
 * `import * as fr from "@wendoo/core/localization/fr"` and passes the
 * namespace straight to `createLocalizer`.
 *
 * Every translation template is parsed, and each structural fault is reported
 * in {@link CatalogModuleResult.issues}.
 */
export function buildLocaleCatalogModule(input: CatalogModuleInput): CatalogModuleResult {
  const issues = new List<CatalogBuildIssue>();
  const plain = new List<string>();
  const contextOrder = new List<string>();
  const byContext = new Dict<string, List<string>>();

  for (const entry of input.entries) {
    const parsed = parseTemplate(entry.translation);
    for (const issue of parsed.issues) {
      issues.push({ code: issue.code, context: entry.context, source: entry.source, index: issue.index });
    }
    const line = `  ${quote(entry.source)}: ${quote(entry.translation)},`;
    if (entry.context === undefined) {
      plain.push(line);
      continue;
    }
    let bucket = byContext.get(entry.context);
    if (bucket === undefined) {
      bucket = new List<string>();
      byContext.set(entry.context, bucket);
      contextOrder.push(entry.context);
    }
    bucket.push(`  ${line}`);
  }

  const contextLines = new List<string>();
  for (let i = 0; i < contextOrder.size(); i++) {
    const context = contextOrder.get(i);
    const bucket = byContext.get(context);
    const body = bucket === undefined ? "" : bucket.toArray().join("\n");
    contextLines.push(`  ${quote(context)}: {\n${body}\n  },`);
  }

  const parts = new List<string>();
  parts.push("// Auto-generated by scripts/generate-localization.ts -- DO NOT EDIT");
  parts.push("");
  parts.push(`export const locale = ${quote(input.locale)};`);
  parts.push("");
  parts.push(emitPluralRule(input.pluralRule));
  parts.push("");
  parts.push(emitRecord("entries", "Record<string, string>", plain));
  parts.push("");
  parts.push(emitRecord("contexts", "Record<string, Record<string, string>>", contextLines));
  parts.push("");

  return { source: parts.toArray().join("\n"), issues: issues.toArray() };
}
