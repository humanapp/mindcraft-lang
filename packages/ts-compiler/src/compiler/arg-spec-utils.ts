import type { ExtractedArgSpec, ExtractedModifier, ExtractedParam } from "./types.js";

export interface ArgSlot {
  slotId: number;
  spec: ExtractedParam | ExtractedModifier;
  repeated?: boolean;
}

export function collectArgSlots(args: readonly ExtractedArgSpec[]): ArgSlot[] {
  const result: ArgSlot[] = [];
  const counter = { value: 0 };
  for (const spec of args) collectArgSlotsFromSpec(spec, result, counter);
  return result;
}

function collectArgSlotsFromSpec(
  spec: ExtractedArgSpec,
  out: ArgSlot[],
  counter: { value: number },
  repeated?: boolean
): void {
  switch (spec.kind) {
    case "param":
    case "modifier":
      out.push({ slotId: counter.value++, spec, repeated });
      break;
    case "choice":
      for (const item of spec.items) collectArgSlotsFromSpec(item, out, counter, repeated);
      break;
    case "optional":
      collectArgSlotsFromSpec(spec.item, out, counter, repeated);
      break;
    case "repeated":
      collectArgSlotsFromSpec(spec.item, out, counter, true);
      break;
    case "conditional":
      collectArgSlotsFromSpec(spec.thenItem, out, counter, repeated);
      if (spec.elseItem) collectArgSlotsFromSpec(spec.elseItem, out, counter, repeated);
      break;
    case "seq":
      for (const item of spec.items) collectArgSlotsFromSpec(item, out, counter, repeated);
      break;
  }
}

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
