import { CoreTypeIds } from "@mindcraft-lang/core/app";
import { EcosimTypeIds } from "@/brain/type-system";

export const dataTypeIconMap = new Map<string, string>([
  [CoreTypeIds.Boolean, "/assets/brain/icons/switch.svg"],
  [CoreTypeIds.Number, "/assets/brain/icons/number.svg"],
  [CoreTypeIds.String, "/assets/brain/icons/text.svg"],
  [EcosimTypeIds.Vector2, "/assets/brain/icons/vector2.svg"],
  [EcosimTypeIds.ActorRef, "/assets/brain/icons/actor-mask.svg"],
]);

export const dataTypeNameMap = new Map<string, string>([
  [CoreTypeIds.Boolean, "boolean"],
  [CoreTypeIds.Number, "number"],
  [CoreTypeIds.String, "text"],
  [EcosimTypeIds.Vector2, "vec2"],
  [EcosimTypeIds.ActorRef, "actor"],
]);
