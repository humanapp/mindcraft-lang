import { kDefaultTileHue } from "@wendoo/ui/brain-editor/tile-visual-utils";
import type { MarkdownReferenceForm } from "@wendoo/ui/markdown/safe-markdown-tokens";
import type { CSSProperties } from "react";
import type { TileLook } from "./tile-visuals";

/** The class list every chip standing inline in the transcript is drawn with. */
const chipClasses =
  "inline-flex shrink-0 min-w-max items-center gap-0.5 align-middle px-1 py-0.5 rounded border text-xs font-mono font-normal text-nowrap";

/** Blend a hex color toward transparent by setting an alpha. */
function adjustAlpha(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** The chip's fill, edge and ink, taken from the hue the thing it names is drawn in. */
function chipStyle(hue: string): CSSProperties {
  return {
    borderColor: hue,
    backgroundColor: adjustAlpha(hue, 0.15),
    color: "var(--color-brain-inline-ink)",
  };
}

/** One tile of the document, drawn as the chip that names it. */
export function TileChip({ tileId, look }: { tileId: string; look: TileLook }) {
  return (
    <span data-assistant-tile={tileId} className={chipClasses} style={chipStyle(look.hue)} title={look.label}>
      {look.iconUrl && <img src={look.iconUrl} alt="" className="w-3.5 h-3.5 mr-px inline-block" aria-hidden="true" />}
      <span data-assistant-tile-word>{look.label}</span>
    </span>
  );
}

/**
 * A rule or a page of the document named in the entity's own words, drawn as a
 * chip carrying no icon, in {@link kDefaultTileHue}.
 */
export function ReferenceChip({ form, id, label }: { form: MarkdownReferenceForm; id: string; label: string }) {
  return (
    <span
      data-assistant-reference={form}
      data-assistant-reference-id={id}
      className={chipClasses}
      style={chipStyle(kDefaultTileHue)}
      title={label}
    >
      <span data-assistant-reference-word>{label}</span>
    </span>
  );
}
