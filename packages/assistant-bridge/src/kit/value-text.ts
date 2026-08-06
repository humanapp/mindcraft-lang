import { NativeType, type Value } from "@mindcraft-lang/core/app";

/** Longest rendering a single value produces before it is cut. */
const maxLength = 48;

/** Cut `text` to {@link maxLength}, marking the cut. */
function bound(text: string): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

/**
 * Render a brain runtime value as a short, stable string for a trace summary.
 * Scalars render as their value; containers render as their type and size; a
 * struct renders as its type id.
 */
export function renderValue(value: Value): string {
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
      return String(value.v);
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
