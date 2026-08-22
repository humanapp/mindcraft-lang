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
  optional,
  type ParameterTileInput,
  param,
  type ReadonlyList,
  type Value,
  VOID_VALUE,
} from "@wendoo-lang/core/app";
import { EcosimHostActions } from "@/brain/abi-ids";
import { hasArg } from "@/brain/actions/utils";
import { getSelf } from "@/brain/execution-context-types";
import { ICON_BASE } from "@/brain/icon-base";
import { TileIds } from "@/brain/tileids";

const AnonString = param(CoreParameterId.AnonymousString, {
  anonymous: true,
});

const Duration = param(TileIds.Parameter.Duration);

const callDef = mkCallDef(bag(optional(AnonString), optional(Duration)));

const kAnonymousStringSlotId = getSlotId(callDef, AnonString);
const kDurationSlotId = getSlotId(callDef, Duration);

function execSay(ctx: ExecutionContext, args: ReadonlyList<Value>): Value {
  try {
    const self = getSelf(ctx);

    if (!self) {
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
    self.displayString(text, durationSecs);
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
  metadata: { label: "say", iconUrl: `${ICON_BASE}/say.svg` },
} satisfies CreateHostActuatorOptions;

export const parameters: ParameterTileInput[] = [
  {
    id: TileIds.Parameter.Duration,
    dataType: CoreTypeIds.Number,
    label: "duration",
    iconUrl: `${ICON_BASE}/duration.svg`,
  },
];
