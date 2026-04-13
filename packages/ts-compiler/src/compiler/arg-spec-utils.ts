import type { ExtractedArgSpec, ExtractedParam } from "./types.js";

export function collectParams(args: readonly ExtractedArgSpec[]): ExtractedParam[] {
  const result: ExtractedParam[] = [];
  for (const spec of args) collectParamsFromSpec(spec, result);
  return result;
}

function collectParamsFromSpec(spec: ExtractedArgSpec, out: ExtractedParam[]): void {
  switch (spec.kind) {
    case "param":
      out.push(spec);
      break;
    case "modifier":
      break;
    case "choice":
      for (const item of spec.items) collectParamsFromSpec(item, out);
      break;
    case "optional":
      collectParamsFromSpec(spec.item, out);
      break;
    case "repeated":
      collectParamsFromSpec(spec.item, out);
      break;
    case "conditional":
      collectParamsFromSpec(spec.thenItem, out);
      if (spec.elseItem) collectParamsFromSpec(spec.elseItem, out);
      break;
    case "seq":
      for (const item of spec.items) collectParamsFromSpec(item, out);
      break;
  }
}
