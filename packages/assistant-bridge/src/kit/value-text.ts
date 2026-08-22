import type { BrainTileLiteralDef, ReadonlyList, Value } from "@wendoo/core/app";
import { NativeType } from "@wendoo/core/app";
import type { ITileCatalog } from "@wendoo/core/brain";
import { tileSentenceWord } from "@wendoo/core/brain/language-service";
import type { Localizer } from "@wendoo/core/localization";
import type { BrainActionArgSlot } from "@wendoo/core/runtime";
import { bufferToHex } from "@wendoo/core/runtime";

/** Longest rendering a single value produces before it is cut. */
const maxLength = 48;

/**
 * Renders a number as the decimal form the run's device computes it at. Pass
 * the run environment's `appServices.numerics.formatNumber`, so a value on a
 * single-precision device renders at single precision.
 */
export type NumberText = (value: number) => string;

/**
 * Names the value a literal tile mints, under which a dispatched struct or list
 * reads as the word that tile reads by. Returns `undefined` for a value no
 * literal tile mints. Build one with {@link createValueLabeler}.
 */
export type ValueLabel = (value: Value) => string | undefined;

/** Names no value, for rendering that must not consult labels. */
const namesNothing: ValueLabel = () => undefined;

/** Cut `text` to {@link maxLength}, marking the cut. */
function bound(text: string): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

/** 32-bit FNV-1a of `text`, as eight lowercase hex digits. */
function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** A rendered value, and whether any part of it carries no readable content. */
interface RenderedValue {
  readonly text: string;
  /** True when a native-backed struct stands anywhere inside the value. */
  readonly opaque: boolean;
}

/** A rendering whose every part carries readable content. */
function readable(text: string): RenderedValue {
  return { text, opaque: false };
}

/** Render every entry of `values`, in order. */
function renderEach(values: ReadonlyList<Value>, numberText: NumberText, labelOf: ValueLabel): RenderedValue[] {
  const parts: RenderedValue[] = [];
  for (let i = 0; i < values.size(); i++) parts.push(render(values.get(i), numberText, labelOf));
  return parts;
}

/**
 * Render `value` within {@link maxLength}, distinguishing values that differ. A
 * container whose contents fit renders as its type id carrying those contents;
 * one whose contents do not fit renders as its type id and a digest of them.
 */
function render(value: Value, numberText: NumberText, labelOf: ValueLabel): RenderedValue {
  switch (value.t) {
    case NativeType.Nil:
      return readable("nil");
    case NativeType.Void:
      return readable("void");
    case NativeType.Unknown:
      return readable("unknown");
    case NativeType.Boolean:
      return readable(value.v ? "true" : "false");
    case NativeType.Number:
      return readable(numberText(value.v));
    case NativeType.String:
      return readable(bound(JSON.stringify(value.v)));
    case NativeType.Enum:
      return readable(`${value.typeId}.${value.v}`);
    case NativeType.Buffer:
      return readable(`buffer#${digest(bufferToHex(value))}`);
    case NativeType.Function:
      return readable(`fn#${value.funcId}`);
    case NativeType.Map:
      return readable(`${value.typeId}{${value.v.size()}}`);
    case NativeType.List: {
      const label = labelOf(value);
      if (label !== undefined) return readable(label);
      const parts = renderEach(value.v, numberText, labelOf);
      const listed = `${value.typeId}[${parts.map((part) => part.text).join(",")}]`;
      return {
        text: listed.length <= maxLength ? listed : `${value.typeId}[${value.v.size()}]#${digest(listed)}`,
        opaque: parts.some((part) => part.opaque),
      };
    }
    case NativeType.Struct: {
      const label = labelOf(value);
      if (label !== undefined) return readable(label);
      if (value.native !== undefined) return { text: `${value.typeId}(opaque)`, opaque: true };
      const parts = value.v ? renderEach(value.v, numberText, labelOf) : [];
      const listed = `${value.typeId}(${parts.map((part) => part.text).join(",")})`;
      return {
        text: listed.length <= maxLength ? listed : `${value.typeId}#${digest(listed)}`,
        opaque: parts.some((part) => part.opaque),
      };
    }
    default:
      return readable(String(value.t));
  }
}

/**
 * Render a brain runtime value as a short, stable string for a trace summary.
 * Scalars render as their value. A struct or list renders as the word `labelOf`
 * names it by, and otherwise as its type id carrying its contents, cut to a
 * digest of those contents when they do not fit. A struct backed by a host
 * object that `labelOf` does not name renders as its type id marked opaque,
 * the one shape whose identity is not readable.
 *
 * @param value - The runtime value to render.
 * @param numberText - How a number renders; see {@link NumberText}.
 * @param labelOf - The word a value reads by; see {@link ValueLabel}.
 */
export function renderValue(value: Value, numberText: NumberText, labelOf: ValueLabel): string {
  return render(value, numberText, labelOf).text;
}

/** The struct or list `tile` bakes; `undefined` when it carries a plain scalar. */
function bakedContainer(tile: BrainTileLiteralDef): Value | undefined {
  const baked = tile.value;
  if (typeof baked !== "object" || baked === null) return undefined;
  const value = baked as Value;
  return value.t === NativeType.Struct || value.t === NativeType.List ? value : undefined;
}

/**
 * Name the struct and list values the catalogs' literal tiles bake, over
 * catalogs that may not exist yet when the labeler is built. The catalogs are
 * read once, on the first value looked up.
 *
 * A value reads by the label of the tile baking the same contents; a
 * native-backed struct, whose contents are a host object, reads by the label of
 * the tile baking that same object. Where several tiles bake one value, the
 * first catalog entry names it.
 *
 * @param catalogsOf - Catalogs to take literal tiles from.
 * @param numberText - How a number renders; pass the one the rendering uses.
 */
export function createValueLabeler(catalogsOf: () => readonly ITileCatalog[], numberText: NumberText): ValueLabel {
  let byContents: Map<string, string> | undefined;
  let byHostObject: Map<unknown, string> | undefined;
  return (value: Value): string | undefined => {
    if (!byContents || !byHostObject) {
      byContents = new Map<string, string>();
      byHostObject = new Map<unknown, string>();
      for (const catalog of catalogsOf()) {
        const tiles = catalog.getAll();
        for (let i = 0; i < tiles.size(); i++) {
          const tile = tiles.get(i);
          if (tile.kind !== "literal") continue;
          const literal = tile as BrainTileLiteralDef;
          const baked = bakedContainer(literal);
          if (!baked) continue;
          if (baked.t === NativeType.Struct && baked.native !== undefined) {
            if (!byHostObject.has(baked.native)) byHostObject.set(baked.native, literal.valueLabel);
            continue;
          }
          const contents = render(baked, numberText, namesNothing);
          if (contents.opaque || byContents.has(contents.text)) continue;
          byContents.set(contents.text, literal.valueLabel);
        }
      }
    }
    if (value.t === NativeType.Struct && value.native !== undefined) return byHostObject.get(value.native);
    const contents = render(value, numberText, namesNothing);
    return contents.opaque ? undefined : byContents.get(contents.text);
  };
}

/**
 * Look up the word a tile reads by in the locale `localizer` renders, over
 * catalogs that may not exist yet when the namer is built. The catalogs are read
 * once, on the first name looked up.
 */
export function createTileNamer(
  catalogsOf: () => readonly ITileCatalog[],
  localizer: Localizer
): (tileId: string) => string {
  let names: Map<string, string> | undefined;
  return (tileId: string): string => {
    if (!names) {
      names = new Map<string, string>();
      for (const catalog of catalogsOf()) {
        catalog.getAll().forEach((tile) => {
          if (!names?.has(tile.tileId)) names?.set(tile.tileId, tileSentenceWord(tile, localizer));
        });
      }
    }
    return names.get(tileId) ?? tileId;
  };
}

/** True when `value` stands for an argument slot the call left empty. */
function isUnfilled(value: Value): boolean {
  return value.t === NativeType.Nil || value.t === NativeType.Void;
}

/**
 * Render the filled argument slots of one call, in slot order. A named slot
 * renders as `name=value` under the name its tile reads by; an anonymous slot,
 * which the author fills with a bare value and no name tile, renders as the
 * value alone.
 *
 * @param slots - The call grammar's flattened argument slots.
 * @param args - Positional argument values, indexed by slot id.
 * @param nameOf - Name a tile reads by; see {@link createTileNamer}.
 * @param numberText - How a number renders; see {@link NumberText}.
 * @param labelOf - The word a value reads by; see {@link createValueLabeler}.
 */
export function renderArgs(
  slots: ReadonlyList<BrainActionArgSlot>,
  args: ReadonlyList<Value>,
  nameOf: (tileId: string) => string,
  numberText: NumberText,
  labelOf: ValueLabel
): string[] {
  const rendered: string[] = [];
  for (let i = 0; i < slots.size(); i++) {
    const value = args.at(i);
    if (value === undefined || isUnfilled(value)) continue;
    const argSpec = slots.get(i).argSpec;
    const text = renderValue(value, numberText, labelOf);
    rendered.push(argSpec.anonymous ? text : `${nameOf(argSpec.tileId)}=${text}`);
  }
  return rendered;
}
