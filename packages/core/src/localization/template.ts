import { StringUtils as SU } from "../platform/string";
import { TypeUtils } from "../platform/types";
import { type PluralRuleSpec, selectPluralCategory } from "./plural";

/** A value a template placeholder may be given. */
export type LocalizedValue = string | number;

/** Literal run of template text, with backslash escapes already resolved. */
export interface TemplateTextNode {
  readonly kind: "text";
  readonly text: string;
}

/** `{name}` -- substitutes the named parameter. */
export interface TemplateParamNode {
  readonly kind: "param";
  readonly name: string;
}

/** `#` inside a plural branch -- substitutes the plural count. */
export interface TemplateCountNode {
  readonly kind: "count";
}

/** One `key {body}` arm of a plural or select placeholder. */
export interface TemplateBranch {
  readonly key: string;
  readonly nodes: readonly TemplateNode[];
}

/** `{name, plural, one {...} other {...}}` -- selects a branch by the locale's plural rules. */
export interface TemplatePluralNode {
  readonly kind: "plural";
  readonly name: string;
  readonly branches: readonly TemplateBranch[];
}

/** `{name, select, a {...} other {...}}` -- selects a branch by the parameter's string value. */
export interface TemplateSelectNode {
  readonly kind: "select";
  readonly name: string;
  readonly branches: readonly TemplateBranch[];
}

/** One node of a parsed template. */
export type TemplateNode =
  | TemplateTextNode
  | TemplateParamNode
  | TemplateCountNode
  | TemplatePluralNode
  | TemplateSelectNode;

/** Stable codes for the structural faults {@link parseTemplate} reports. */
export const TemplateDiagCode = {
  /** A `{` placeholder is never closed. */
  UnclosedPlaceholder: "TEMPLATE_UNCLOSED_PLACEHOLDER",
  /** A placeholder names no parameter, as in `{}` or `{, plural, ...}`. */
  EmptyPlaceholderName: "TEMPLATE_EMPTY_PLACEHOLDER_NAME",
  /** A placeholder names a format other than `plural` or `select`. */
  UnknownFormat: "TEMPLATE_UNKNOWN_FORMAT",
  /** A `plural` or `select` placeholder has no `other` branch. */
  MissingOtherBranch: "TEMPLATE_MISSING_OTHER_BRANCH",
} as const;

/** Union of the {@link TemplateDiagCode} values. */
export type TemplateDiagCode = (typeof TemplateDiagCode)[keyof typeof TemplateDiagCode];

/** A structural fault found while parsing a template, at character offset `index`. */
export interface TemplateIssue {
  readonly code: TemplateDiagCode;
  readonly index: number;
}

/**
 * A parsed template: renderable nodes plus every structural fault found.
 * Parsing is total -- a template with issues still yields nodes, with the
 * malformed span carried through as literal text.
 */
export interface ParsedTemplate {
  readonly nodes: readonly TemplateNode[];
  readonly issues: readonly TemplateIssue[];
}

/** Characters that terminate a branch key. */
const kBranchKeyStops = " \t\n\r{}";

/** Characters that terminate a placeholder's parameter name or format word. */
const kHeaderStops = ",}{";

/** Characters a backslash escapes to their literal selves. */
const kEscapable = "{}#\\";

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

class TemplateParser {
  private readonly text: string;
  private readonly length: number;
  private readonly issues: TemplateIssue[] = [];
  private index = 0;

  constructor(text: string) {
    this.text = text;
    this.length = SU.length(text);
  }

  parse(): ParsedTemplate {
    const nodes = this.parseNodes(false);
    return { nodes, issues: this.issues };
  }

  private at(offset: number): string {
    return SU.charAt(this.text, offset);
  }

  private skipSpaces(): void {
    while (this.index < this.length && isSpace(this.at(this.index))) {
      this.index += 1;
    }
  }

  /** Read characters until one of `stops` or end of input; returns the trimmed run. */
  private readWord(stops: string): string {
    const start = this.index;
    while (this.index < this.length && SU.indexOf(stops, this.at(this.index)) < 0) {
      this.index += 1;
    }
    return SU.trim(SU.substring(this.text, start, this.index));
  }

  /** Offset just past the `}` matching the `{` at `open`, or end of input when unclosed. */
  private matchingClose(open: number): number {
    let depth = 0;
    let i = open;
    while (i < this.length) {
      const ch = this.at(i);
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          return i + 1;
        }
      }
      i += 1;
    }
    return this.length;
  }

  /** Record `code`, skip past the placeholder, and hand back its raw span as literal text. */
  private recover(open: number, code: TemplateDiagCode): TemplateTextNode {
    this.issues.push({ code, index: open });
    const close = this.matchingClose(open);
    this.index = close;
    return { kind: "text", text: SU.substring(this.text, open, close) };
  }

  private parseBranches(open: number, name: string, kind: "plural" | "select"): TemplateNode {
    const branches: TemplateBranch[] = [];
    let sawOther = false;
    for (;;) {
      this.skipSpaces();
      if (this.index >= this.length) {
        return this.recover(open, TemplateDiagCode.UnclosedPlaceholder);
      }
      if (this.at(this.index) === "}") {
        this.index += 1;
        break;
      }
      const key = this.readWord(kBranchKeyStops);
      if (key === "") {
        return this.recover(open, TemplateDiagCode.UnclosedPlaceholder);
      }
      this.skipSpaces();
      if (this.index >= this.length || this.at(this.index) !== "{") {
        return this.recover(open, TemplateDiagCode.UnclosedPlaceholder);
      }
      this.index += 1;
      const nodes = this.parseNodes(true);
      if (this.index >= this.length || this.at(this.index) !== "}") {
        return this.recover(open, TemplateDiagCode.UnclosedPlaceholder);
      }
      this.index += 1;
      if (key === "other") {
        sawOther = true;
      }
      branches.push({ key, nodes });
    }
    if (!sawOther) {
      return this.recover(open, TemplateDiagCode.MissingOtherBranch);
    }
    return kind === "plural" ? { kind: "plural", name, branches } : { kind: "select", name, branches };
  }

  /** Parse one `{...}` placeholder; the cursor sits on the opening brace. */
  private parsePlaceholder(): TemplateNode {
    const open = this.index;
    this.index += 1;
    this.skipSpaces();
    const name = this.readWord(kHeaderStops);
    if (name === "") {
      return this.recover(open, TemplateDiagCode.EmptyPlaceholderName);
    }
    if (this.index >= this.length) {
      return this.recover(open, TemplateDiagCode.UnclosedPlaceholder);
    }
    if (this.at(this.index) === "}") {
      this.index += 1;
      return { kind: "param", name };
    }
    if (this.at(this.index) !== ",") {
      return this.recover(open, TemplateDiagCode.UnclosedPlaceholder);
    }
    this.index += 1;
    this.skipSpaces();
    const format = this.readWord(kHeaderStops);
    if (format !== "plural" && format !== "select") {
      return this.recover(open, TemplateDiagCode.UnknownFormat);
    }
    if (this.index >= this.length || this.at(this.index) !== ",") {
      return this.recover(open, TemplateDiagCode.UnclosedPlaceholder);
    }
    this.index += 1;
    return this.parseBranches(open, name, format);
  }

  /**
   * Parse a run of nodes. Inside a branch body `#` becomes a count node and a
   * lone `}` ends the run; at the top level both are literal text.
   */
  private parseNodes(inBranch: boolean): TemplateNode[] {
    const nodes: TemplateNode[] = [];
    let text = "";
    while (this.index < this.length) {
      const ch = this.at(this.index);
      if (ch === "\\" && SU.indexOf(kEscapable, this.at(this.index + 1)) >= 0) {
        text += this.at(this.index + 1);
        this.index += 2;
      } else if (ch === "{") {
        if (text !== "") {
          nodes.push({ kind: "text", text });
          text = "";
        }
        nodes.push(this.parsePlaceholder());
      } else if (ch === "}" && inBranch) {
        break;
      } else if (ch === "#" && inBranch) {
        if (text !== "") {
          nodes.push({ kind: "text", text });
          text = "";
        }
        nodes.push({ kind: "count" });
        this.index += 1;
      } else {
        text += ch;
        this.index += 1;
      }
    }
    if (text !== "") {
      nodes.push({ kind: "text", text });
    }
    return nodes;
  }
}

/**
 * Parse `template` into renderable nodes. Never throws: structural faults are
 * reported in `issues` and their span is preserved as literal text, so a
 * malformed template still renders.
 *
 * A backslash escapes `{`, `}`, `#`, and itself to their literal selves.
 */
export function parseTemplate(template: string): ParsedTemplate {
  return new TemplateParser(template).parse();
}

function valueText(value: LocalizedValue | undefined, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }
  return SU.toString(value);
}

function findBranch(branches: readonly TemplateBranch[], key: string): TemplateBranch | undefined {
  let other: TemplateBranch | undefined;
  for (const branch of branches) {
    if (branch.key === key) {
      return branch;
    }
    if (branch.key === "other") {
      other = branch;
    }
  }
  return other;
}

function renderNodes(
  nodes: readonly TemplateNode[],
  params: Record<string, LocalizedValue> | undefined,
  rule: PluralRuleSpec,
  count: string
): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") {
      out += node.text;
    } else if (node.kind === "count") {
      out += count;
    } else if (node.kind === "param") {
      out += valueText(params === undefined ? undefined : params[node.name], `{${node.name}}`);
    } else if (node.kind === "plural") {
      const raw = params === undefined ? undefined : params[node.name];
      const key = TypeUtils.isNumber(raw) ? selectPluralCategory(rule, raw) : "other";
      const branch = findBranch(node.branches, key);
      out += branch === undefined ? "" : renderNodes(branch.nodes, params, rule, valueText(raw, `{${node.name}}`));
    } else {
      const raw = params === undefined ? undefined : params[node.name];
      const branch = findBranch(node.branches, valueText(raw, "other"));
      out += branch === undefined ? "" : renderNodes(branch.nodes, params, rule, count);
    }
  }
  return out;
}

/**
 * Render `template` with `params` under `rule`.
 *
 * Rendering is total. A parameter with no supplied value renders as its own
 * `{name}` placeholder, a plural placeholder whose parameter is not a number
 * takes the `other` branch, and a malformed construct renders verbatim.
 */
export function renderTemplate(
  template: string,
  params: Record<string, LocalizedValue> | undefined,
  rule: PluralRuleSpec
): string {
  const parsed = parseTemplate(template);
  return renderNodes(parsed.nodes, params, rule, "");
}

function escapeLiteral(text: string): string {
  let out = SU.split(text, "\\").join("\\\\");
  out = SU.split(out, "{").join("\\{");
  out = SU.split(out, "}").join("\\}");
  return SU.split(out, "#").join("\\#");
}

/**
 * Serialize parsed nodes back to template text. Rendering the result is
 * equivalent to rendering the template the nodes came from.
 */
export function formatTemplate(nodes: readonly TemplateNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") {
      out += escapeLiteral(node.text);
    } else if (node.kind === "count") {
      out += "#";
    } else if (node.kind === "param") {
      out += `{${node.name}}`;
    } else {
      let body = "";
      for (const branch of node.branches) {
        body += ` ${branch.key} {${formatTemplate(branch.nodes)}}`;
      }
      out += `{${node.name}, ${node.kind},${body}}`;
    }
  }
  return out;
}
