import { Dict } from "@mindcraft-lang/core";
import {
  CoreActuatorId,
  CoreControlFlowId,
  CoreLiteralFactoryId,
  CoreOpId,
  CoreSensorId,
  CoreTypeIds,
  CoreVariableFactoryId,
  mkAccessorTileId,
  mkActuatorTileId,
  mkControlFlowTileId,
  mkLiteralFactoryTileId,
  mkLiteralTileId,
  mkModifierTileId,
  mkOperatorTileId,
  mkPageTileId,
  mkParameterTileId,
  mkSensorTileId,
  mkVariableFactoryTileId,
} from "@mindcraft-lang/core/brain";
import { MyTypeIds } from "../type-system";
import type { TileVisual } from "./types";

// Visual definitions for well-known tiles

// biome-ignore format: uniform one-liner-per-entry style
export const tileVisuals = new Dict<string, Partial<TileVisual>>([
  // Operators
  [mkOperatorTileId(CoreOpId.And), { label: "AND" }],
  [mkOperatorTileId(CoreOpId.Or), { label: "OR" }],
  [mkOperatorTileId(CoreOpId.Not), { label: "NOT" }],
  [mkOperatorTileId(CoreOpId.Add), { label: "plus", iconUrl: "/assets/brain/icons/plus.svg" }],
  [mkOperatorTileId(CoreOpId.Subtract), { label: "minus", iconUrl: "/assets/brain/icons/minus.svg" }],
  [mkOperatorTileId(CoreOpId.Multiply), { label: "multiplied by", iconUrl: "/assets/brain/icons/multiply.svg" }],
  [mkOperatorTileId(CoreOpId.Divide), { label: "divided by", iconUrl: "/assets/brain/icons/divide.svg" }],
  [mkOperatorTileId(CoreOpId.Negate), { label: "negative", iconUrl: "/assets/brain/icons/negative.svg" }],
  [mkOperatorTileId(CoreOpId.EqualTo), { label: "equal to", iconUrl: "/assets/brain/icons/equals.svg" }],
  [mkOperatorTileId(CoreOpId.NotEqualTo), { label: "not equal to", iconUrl: "/assets/brain/icons/not_equal.svg" }],
  [mkOperatorTileId(CoreOpId.LessThan), { label: "less than", iconUrl: "/assets/brain/icons/less_than.svg" }],
  [mkOperatorTileId(CoreOpId.LessThanOrEqualTo), { label: "less than or equal to", iconUrl: "/assets/brain/icons/less_than_or_equal_to.svg" }],
  [mkOperatorTileId(CoreOpId.GreaterThan), { label: "greater than", iconUrl: "/assets/brain/icons/greater_than.svg" }],
  [mkOperatorTileId(CoreOpId.GreaterThanOrEqualTo), { label: "greater than or equal to", iconUrl: "/assets/brain/icons/greater_than_or_equal_to.svg" }],
  [mkOperatorTileId(CoreOpId.Assign), { label: "equals", iconUrl: "/assets/brain/icons/assign.svg" }],
  // Control Flow
  [mkControlFlowTileId(CoreControlFlowId.OpenParen), { label: "(", iconUrl: "/assets/brain/icons/open-paren.svg" }],
  [mkControlFlowTileId(CoreControlFlowId.CloseParen), { label: ")", iconUrl: "/assets/brain/icons/close-paren.svg" }],
  // Variable Factories
  [mkVariableFactoryTileId(CoreVariableFactoryId.Boolean), { label: "boolean variable", iconUrl: "/assets/brain/icons/switch.svg" }],
  [mkVariableFactoryTileId(CoreVariableFactoryId.Number), { label: "number variable", iconUrl: "/assets/brain/icons/number.svg" }],
  [mkVariableFactoryTileId(CoreVariableFactoryId.String), { label: "text variable", iconUrl: "/assets/brain/icons/text.svg" }],
  [mkVariableFactoryTileId(MyTypeIds.Vector2), { label: "vector2 variable", iconUrl: "/assets/brain/icons/vector2.svg" }],
  [mkVariableFactoryTileId(MyTypeIds.ActorRef), { label: "actor variable", iconUrl: "/assets/brain/icons/actor-mask.svg" }],
  // Literal Factories
  [mkLiteralFactoryTileId(CoreLiteralFactoryId.Number), { label: "number", iconUrl: "/assets/brain/icons/number.svg" }],
  [mkLiteralFactoryTileId(CoreLiteralFactoryId.String), { label: "text", iconUrl: "/assets/brain/icons/text.svg" }],
  // Well-known Literals
  [mkLiteralTileId(CoreTypeIds.Boolean, "true"), { label: "true", iconUrl: "/assets/brain/icons/switch_on.svg" }],
  [mkLiteralTileId(CoreTypeIds.Boolean, "false"), { label: "false", iconUrl: "/assets/brain/icons/switch_off.svg" }],
  [mkLiteralTileId(CoreTypeIds.Nil, "nil"), { label: "nil", iconUrl: "/assets/brain/icons/nil.svg" }],
  // Modifiers
  // Parameters
  // Sensors
  [mkSensorTileId(CoreSensorId.Random), { label: "random number", iconUrl: "/assets/brain/icons/random.svg" }],
  [mkSensorTileId(CoreSensorId.OnPageEntered), { label: "on page entered", iconUrl: "/assets/brain/icons/on-page-enter.svg" }],
  // Actuators
  [mkActuatorTileId(CoreActuatorId.SwitchPage), { label: "switch page", iconUrl: "/assets/brain/icons/switch_page.svg" }],
  [mkActuatorTileId(CoreActuatorId.RestartPage), { label: "restart page", iconUrl: "/assets/brain/icons/restart-page.svg" }],
  [mkActuatorTileId(CoreActuatorId.Yield), { label: "yield", iconUrl: "/assets/brain/icons/yield.svg" }],
  // Field Accessors
  [mkAccessorTileId(MyTypeIds.Vector2, "x"), { label: "x", iconUrl: "/assets/brain/icons/vector2_x.svg" }],
  [mkAccessorTileId(MyTypeIds.Vector2, "y"), { label: "y", iconUrl: "/assets/brain/icons/vector2_y.svg" }],
]);
