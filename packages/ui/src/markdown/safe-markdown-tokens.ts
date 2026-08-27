/** The kinds of thing a reference in the text points at, by the word it opens with. */
export const MarkdownReferenceForm = {
  Tile: "tile",
  Rule: "rule",
  Page: "page",
} as const;

/** The kinds of thing a reference in the text points at. */
export type MarkdownReferenceForm = (typeof MarkdownReferenceForm)[keyof typeof MarkdownReferenceForm];

/** The forms a reference opens with, as the alternation the pattern reads them by. */
const referenceForms = Object.values(MarkdownReferenceForm).join("|");

/**
 * One run of inline content inside a block. `text` carries the characters the
 * run stands for, with the markers that named it already removed. A `reference`
 * run carries the durable id it names, which the surface draws the thing itself
 * for.
 */
export type MarkdownSpan =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly text: string }
  | { readonly kind: "emphasis"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "reference"; readonly form: MarkdownReferenceForm; readonly id: string };

/**
 * One block of the safe subset: a paragraph, a header the subset reads as an
 * emphasized paragraph, or a single-level list and the spans of each item.
 */
export type MarkdownBlock =
  | { readonly kind: "paragraph"; readonly spans: readonly MarkdownSpan[] }
  | { readonly kind: "heading"; readonly spans: readonly MarkdownSpan[] }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: readonly (readonly MarkdownSpan[])[] };

/** One inline form the subset reads, and the span a match of it stands for. */
interface InlinePattern {
  readonly pattern: RegExp;
  readonly span: (match: RegExpExecArray) => MarkdownSpan;
}

/**
 * The inline forms the subset reads. A position is claimed by the leftmost
 * match, and by the earliest form listed here where two match at the same
 * position; anything no form matches stays literal text.
 *
 * This table and `renderSpan` in `SafeMarkdown.tsx` are the two places a new
 * inline form is added: a pattern here, and the element its span kind draws as
 * there. A reference takes the backticked `tile:` / `rule:` / `page:` form, and
 * stands ahead of the plain code form so a backticked reference is never read as
 * code.
 */
const inlinePatterns: readonly InlinePattern[] = [
  {
    pattern: new RegExp(`\`(${referenceForms}):([^\`\\n]+)\``),
    span: (match) => ({ kind: "reference", form: match[1] as MarkdownReferenceForm, id: match[2]! }),
  },
  { pattern: /`([^`\n]+)`/, span: (match) => ({ kind: "code", text: match[1] }) },
  { pattern: /\*\*([^\n]+?)\*\*/, span: (match) => ({ kind: "strong", text: match[1] }) },
  { pattern: /\*([^\s*][^\n*]*?)\*/, span: (match) => ({ kind: "emphasis", text: match[1] }) },
  {
    pattern: /(?<![0-9A-Za-z_])_([^\s_][^\n_]*?)_(?![0-9A-Za-z_])/,
    span: (match) => ({ kind: "emphasis", text: match[1] }),
  },
  { pattern: /\[([^\]\n]*)\]\([^)\n]*\)/, span: (match) => ({ kind: "text", text: match[1] }) },
];

/** A header line, of the four levels the subset reads. */
const headingLine = /^ {0,3}#{1,4}[ \t]+(.*)$/;

/** A bulleted item at any indentation, which the subset flattens to one level. */
const bulletLine = /^[ \t]*[-*][ \t]+(.*)$/;

/** A numbered item at any indentation, which the subset flattens to one level. */
const numberedLine = /^[ \t]*\d{1,9}\.[ \t]+(.*)$/;

/** Append `text` to `spans`, joining it onto the run it follows when that run is literal too. */
function appendText(spans: MarkdownSpan[], text: string): void {
  if (text.length === 0) return;
  const last = spans[spans.length - 1];
  if (last?.kind === "text") spans[spans.length - 1] = { kind: "text", text: last.text + text };
  else spans.push({ kind: "text", text });
}

/** The spans `text` reads as, with every stretch no inline form claims kept literal. */
function inlineSpans(text: string): MarkdownSpan[] {
  const scanners = inlinePatterns.map((entry) => ({ regex: new RegExp(entry.pattern, "g"), span: entry.span }));
  const spans: MarkdownSpan[] = [];
  let at = 0;
  for (;;) {
    let claim: { readonly match: RegExpExecArray; readonly span: InlinePattern["span"] } | undefined;
    for (const scanner of scanners) {
      scanner.regex.lastIndex = at;
      const match = scanner.regex.exec(text);
      if (match && (claim === undefined || match.index < claim.match.index)) claim = { match, span: scanner.span };
    }
    if (claim === undefined) break;
    appendText(spans, text.slice(at, claim.match.index));
    const span = claim.span(claim.match);
    if (span.kind === "text") appendText(spans, span.text);
    else if (span.kind === "reference" || span.text.length > 0) spans.push(span);
    at = claim.match.index + claim.match[0].length;
  }
  appendText(spans, text.slice(at));
  return spans;
}

/**
 * The blocks `text` reads as under the safe subset: blank-line separated
 * paragraphs, headers as their own emphasized block, and runs of items as one
 * list per run of a kind. Lines that name no block are paragraph content, and
 * every form outside the subset -- raw HTML included -- survives as literal
 * text.
 */
export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: MarkdownSpan[][] } | undefined;

  const closeParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", spans: inlineSpans(paragraph.join("\n")) });
    paragraph = [];
  };
  const closeList = (): void => {
    if (list === undefined) return;
    blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
    list = undefined;
  };

  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.trim().length === 0) {
      closeParagraph();
      closeList();
      continue;
    }

    const heading = headingLine.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      blocks.push({ kind: "heading", spans: inlineSpans(heading[1].trim()) });
      continue;
    }

    const bullet = bulletLine.exec(line);
    const numbered = numberedLine.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = bullet === null;
      closeParagraph();
      if (list && list.ordered !== ordered) closeList();
      if (list === undefined) list = { ordered, items: [] };
      list.items.push(inlineSpans(item[1]));
      continue;
    }

    closeList();
    paragraph.push(line);
  }

  closeParagraph();
  closeList();
  return blocks;
}
