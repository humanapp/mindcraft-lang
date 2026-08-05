import { CoreTypeIds } from "@mindcraft-lang/core/app";
import { ICON_BASE } from "@/brain/icon-base";
import { EcosimTypeIds } from "@/brain/type-system";

export const dataTypeIconMap = new Map<string, string>([
  [CoreTypeIds.Boolean, `${ICON_BASE}/switch.svg`],
  [CoreTypeIds.Number, `${ICON_BASE}/number.svg`],
  [CoreTypeIds.String, `${ICON_BASE}/text.svg`],
  [EcosimTypeIds.Vector2, `${ICON_BASE}/vector2.svg`],
  [EcosimTypeIds.ActorRef, `${ICON_BASE}/actor-mask.svg`],
]);

export const dataTypeNameMap = new Map<string, string>([
  [CoreTypeIds.Boolean, "boolean"],
  [CoreTypeIds.Number, "number"],
  [CoreTypeIds.String, "text"],
  [EcosimTypeIds.Vector2, "vec2"],
  [EcosimTypeIds.ActorRef, "actor"],
]);
