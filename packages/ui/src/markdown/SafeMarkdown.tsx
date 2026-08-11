import type { ReactNode } from "react";
import type { MarkdownBlock, MarkdownSpan } from "./safe-markdown-tokens";
import { parseMarkdownBlocks } from "./safe-markdown-tokens";

/** The text a {@link SafeMarkdown} draws. */
export interface SafeMarkdownProps {
  /** The markdown source, read under the safe subset and rendered in the type scale it stands in. */
  text: string;
}

/** The element `span` draws as, or its characters where the subset keeps them literal. */
function renderSpan(span: MarkdownSpan, key: string): ReactNode {
  switch (span.kind) {
    case "text":
      return span.text;
    case "strong":
      return (
        <strong key={key} className="font-semibold">
          {span.text}
        </strong>
      );
    case "emphasis":
      return (
        <em key={key} className="italic">
          {span.text}
        </em>
      );
    case "code":
      return (
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          {span.text}
        </code>
      );
  }
}

/** `spans` in order, as the children of the block holding them. */
function renderSpans(spans: readonly MarkdownSpan[]): ReactNode[] {
  return spans.map((span, at) => renderSpan(span, `span-${at}`));
}

/** The element `block` draws as, laid under the block before it. */
function renderBlock(block: MarkdownBlock, key: string): ReactNode {
  switch (block.kind) {
    case "paragraph":
      return (
        <p key={key} className="mt-2 whitespace-pre-wrap first:mt-0">
          {renderSpans(block.spans)}
        </p>
      );
    case "heading":
      return (
        <p key={key} className="mt-3 font-semibold first:mt-0">
          {renderSpans(block.spans)}
        </p>
      );
    case "list": {
      const items = block.items.map((item, at) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: every block is read from the text afresh, so an item keeps its position
        <li key={`item-${at}`}>{renderSpans(item)}</li>
      ));
      return block.ordered ? (
        <ol key={key} className="mt-2 list-decimal space-y-0.5 pl-5 first:mt-0">
          {items}
        </ol>
      ) : (
        <ul key={key} className="mt-2 list-disc space-y-0.5 pl-5 first:mt-0">
          {items}
        </ul>
      );
    }
  }
}

/**
 * Draws `text` as a conservative markdown subset: blank-line separated
 * paragraphs, bold, italic, inline code, single-level bulleted and numbered
 * lists, and headers read as emphasized paragraphs. A link keeps its label as
 * plain text and loses its address, and every form outside the subset -- raw
 * HTML included -- reads as literal text. The output is React elements and
 * text nodes only, so nothing in `text` can become live markup.
 *
 * Type size and colour are inherited, so the caller's surface sets the scale
 * the blocks read in.
 *
 * `packages/docs` DocMarkdown renders trusted authored documentation at full
 * markdown fidelity. This renderer is the one for text that has to stay
 * conservative whoever wrote it; keep the two separate.
 */
export function SafeMarkdown({ text }: SafeMarkdownProps) {
  return <>{parseMarkdownBlocks(text).map((block, at) => renderBlock(block, `block-${at}`))}</>;
}
