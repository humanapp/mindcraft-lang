import {
  bag,
  CoreParameterId,
  CoreTypeIds,
  type CreateHostActuatorOptions,
  type ExecutionContext,
  extractNumberValue,
  extractStringValue,
  getSlotId,
  mkCallDef,
  optional,
  type ParameterTileInput,
  param,
  type ReadonlyList,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/app";
import { hasArg } from "@/brain/actions/utils";
import { getSelf } from "@/brain/execution-context-types";
import { TileIds } from "@/brain/tileids";

const AnonString = param(CoreParameterId.AnonymousString, {
  anonymous: true,
});

const Duration = param(TileIds.Parameter.Duration);

const callDef = mkCallDef(bag(optional(AnonString), optional(Duration)));

const kAnonymousStringSlotId = getSlotId(callDef, AnonString);
const kDurationSlotId = getSlotId(callDef, Duration);

function execSay(ctx: ExecutionContext, args: ReadonlyList<Value>): Value {
  const self = getSelf(ctx);

  if (!self) {
    console.warn("Say actuator called without Actor in execution context");
    return VOID_VALUE;
  }

  let text: string | undefined;
  const hasStringArg = hasArg(args, kAnonymousStringSlotId);
  if (hasStringArg) {
    const stringValue = args.get(kAnonymousStringSlotId);
    text = extractStringValue(stringValue);
  }

  const durationSecs = extractNumberValue(args.get(kDurationSlotId));
  self.displayString(text, durationSecs);

  return VOID_VALUE;
}

export default {
  key: TileIds.Actuator.Say,
  callDef,
  fn: { exec: execSay },
  isAsync: false,
  metadata: { label: "say", iconUrl: "/assets/brain/icons/say.svg" },
} satisfies CreateHostActuatorOptions;

export const parameters: ParameterTileInput[] = [
  {
    id: TileIds.Parameter.Duration,
    dataType: CoreTypeIds.Number,
    label: "duration",
    iconUrl: "/assets/brain/icons/duration.svg",
  },
];
