import type { ReadonlyList, Value } from "@mindcraft-lang/core/app";
import { NativeType } from "@mindcraft-lang/core/app";
import type { ITileCatalog } from "@mindcraft-lang/core/brain";
import { tileSentenceWord } from "@mindcraft-lang/core/brain/language-service";
import type { Localizer } from "@mindcraft-lang/core/localization";
import type { BrainActionArgSlot } from "@mindcraft-lang/core/runtime";

/** Longest rendering a single value produces before it is cut. */
const maxLength = 48;

/**
 * Renders a number as the decimal form the run's device computes it at. Pass
 * the run environment's `appServices.numerics.formatNumber`, so a value on a
 * single-precision device renders at single precision.
 */
export type NumberText = (value: number) => string;

/** Cut `text` to {@link maxLength}, marking the cut. */
function bound(text: string): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

/**
 * Render a brain runtime value as a short, stable string for a trace summary.
 * Scalars render as their value; containers render as their type and size; a
 * struct renders as its type id.
 *
 * @param value - The runtime value to render.
 * @param numberText - How a number renders; see {@link NumberText}.
 */
export function renderValue(value: Value, numberText: NumberText): string {
  switch (value.t) {
    case NativeType.Nil:
      return "nil";
    case NativeType.Void:
      return "void";
    case NativeType.Unknown:
      return "unknown";
    case NativeType.Boolean:
      return value.v ? "true" : "false";
    case NativeType.Number:
      return numberText(value.v);
    case NativeType.String:
      return bound(JSON.stringify(value.v));
    case NativeType.Enum:
      return `${value.typeId}.${value.v}`;
    case NativeType.List:
      return `${value.typeId}[${value.v.size()}]`;
    case NativeType.Map:
      return `${value.typeId}{${value.v.size()}}`;
    case NativeType.Struct:
      return String(value.typeId);
    case NativeType.Function:
      return `fn#${value.funcId}`;
    case NativeType.Buffer:
      return "buffer";
    default:
      return String(value.t);
  }
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
 */
export function renderArgs(
  slots: ReadonlyList<BrainActionArgSlot>,
  args: ReadonlyList<Value>,
  nameOf: (tileId: string) => string,
  numberText: NumberText
): string[] {
  const rendered: string[] = [];
  for (let i = 0; i < slots.size(); i++) {
    const value = args.get(i);
    if (value === undefined || isUnfilled(value)) continue;
    const argSpec = slots.get(i).argSpec;
    const text = renderValue(value, numberText);
    rendered.push(argSpec.anonymous ? text : `${nameOf(argSpec.tileId)}=${text}`);
  }
  return rendered;
}
