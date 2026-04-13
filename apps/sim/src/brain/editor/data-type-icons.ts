import { CoreTypeIds } from "@mindcraft-lang/core/app";
import { SimTypeIds } from "@/brain/type-system";

export const dataTypeIconMap = new Map<string, string>([
  [CoreTypeIds.Boolean, "/assets/brain/icons/switch.svg"],
  [CoreTypeIds.Number, "/assets/brain/icons/number.svg"],
  [CoreTypeIds.String, "/assets/brain/icons/text.svg"],
  [SimTypeIds.Vector2, "/assets/brain/icons/vector2.svg"],
  [SimTypeIds.ActorRef, "/assets/brain/icons/actor-mask.svg"],
]);

export const dataTypeNameMap = new Map<string, string>([
  [CoreTypeIds.Boolean, "boolean"],
  [CoreTypeIds.Number, "number"],
  [CoreTypeIds.String, "text"],
  [SimTypeIds.Vector2, "vec2"],
  [SimTypeIds.ActorRef, "actor"],
]);
