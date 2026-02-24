import {
  bag,
  CoreParameterId,
  CoreTypeIds,
  type ExecutionContext,
  extractNumberValue,
  extractStringValue,
  getSlotId,
  type MapValue,
  mkCallDef,
  optional,
  param,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/brain";
import { getSelf } from "@/brain/execution-context-types";
import type { ActionDef } from "@/brain/fns/action-def";
import { TileIds } from "@/brain/tileids";

const AnonString = param(CoreParameterId.AnonymousString, {
  anonymous: true,
});

const Duration = param(TileIds.Parameter.Duration);

const callDef = mkCallDef(bag(optional(AnonString), optional(Duration)));

const kAnonymousStringSlotId = getSlotId(callDef, AnonString);
const kDurationSlotId = getSlotId(callDef, Duration);

function execSay(ctx: ExecutionContext, args: MapValue): Value {
  const self = getSelf(ctx);

  if (!self) {
    console.warn("Say actuator called without Actor in execution context");
    return VOID_VALUE;
  }

  let text: string | undefined;
  const hasStringArg = args.v.has(kAnonymousStringSlotId);
  if (hasStringArg) {
    const stringValue = args.v.get(kAnonymousStringSlotId);
    text = extractStringValue(stringValue);
  }

  const durationSecs = extractNumberValue(args.v.get(kDurationSlotId));
  self.displayString(text, durationSecs);

  return VOID_VALUE;
}

export default {
  tileId: TileIds.Actuator.Say,
  callDef,
  fn: { exec: execSay },
  isAsync: false,
  returnType: CoreTypeIds.Void,
  visual: { label: "say", iconUrl: "/assets/brain/icons/say.svg" },
} satisfies ActionDef;
