import {
  bag,
  CoreParameterId,
  CoreTypeIds,
  type CreateHostActuatorOptions,
  type ExecutionContext,
  extractNumberValue,
  extractStringValue,
  getSlotId,
  logger,
  mkCallDef,
  mkNumberValue,
  optional,
  type ParameterTileInput,
  param,
  type ReadonlyList,
  type Value,
  VOID_VALUE,
} from "@wendoo/core/app";
import { EcosimHostActions } from "../abi-ids";
import { getSelf } from "../execution-context-types";
import { TileIds } from "../tileids";
import { hasArg, SAY_DEFAULT_DURATION_SECONDS } from "./utils";

const AnonString = param(CoreParameterId.AnonymousString, {
  anonymous: true,
  name: "text",
});

const Duration = param(TileIds.Parameter.Duration, {
  unit: "seconds",
  default: mkNumberValue(SAY_DEFAULT_DURATION_SECONDS),
});

const callDef = mkCallDef(bag(optional(AnonString), optional(Duration)));

const kAnonymousStringSlotId = getSlotId(callDef, AnonString);
const kDurationSlotId = getSlotId(callDef, Duration);

function execSay(ctx: ExecutionContext, args: ReadonlyList<Value>): Value {
  try {
    const selfActor = getSelf(ctx);

    if (!selfActor) {
      logger.warn("Say actuator called without Actor in execution context");
      return VOID_VALUE;
    }

    let text: string | undefined;
    const hasStringArg = hasArg(args, kAnonymousStringSlotId);
    if (hasStringArg) {
      const stringValue = args.at(kAnonymousStringSlotId);
      text = extractStringValue(stringValue);
    }

    const durationSecs = extractNumberValue(args.at(kDurationSlotId));
    selfActor.displayString(text, durationSecs);
  } catch (error) {
    logger.error("Error executing Say actuator:", error);
  }

  return VOID_VALUE;
}

export default {
  ...EcosimHostActions.Say,
  callDef,
  fn: { exec: execSay },
  isAsync: false,
  metadata: { label: "say" },
} satisfies CreateHostActuatorOptions;

/** Parameter tiles the `say` actuator accepts. */
export const parameters: ParameterTileInput[] = [
  {
    id: TileIds.Parameter.Duration,
    dataType: CoreTypeIds.Number,
    label: "duration",
  },
];
