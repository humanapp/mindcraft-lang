import { CoreTypeIds } from "@mindcraft-lang/core/brain";
import { MyTypeIds } from "../type-system";

export const dataTypeIconMap = new Map<string, string>([
  [CoreTypeIds.Boolean, "/assets/brain/icons/switch.svg"],
  [CoreTypeIds.Number, "/assets/brain/icons/number.svg"],
  [CoreTypeIds.String, "/assets/brain/icons/text.svg"],
  [MyTypeIds.Vector2, "/assets/brain/icons/vector2.svg"],
  [MyTypeIds.ActorRef, "/assets/brain/icons/actor-mask.svg"],
]);

export const dataTypeNameMap = new Map<string, string>([
  [CoreTypeIds.Boolean, "boolean"],
  [CoreTypeIds.Number, "number"],
  [CoreTypeIds.String, "text"],
  [MyTypeIds.Vector2, "vec2"],
  [MyTypeIds.ActorRef, "actor"],
]);
