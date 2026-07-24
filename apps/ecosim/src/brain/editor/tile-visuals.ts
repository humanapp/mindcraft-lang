import {
  CoreControlFlowId,
  CoreHostActions,
  CoreLiteralFactoryId,
  CoreOpId,
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
} from "@mindcraft-lang/core/app";
import { ICON_BASE } from "@/brain/icon-base";
import { EcosimTypeIds } from "@/brain/type-system";
import type { TileVisual } from "./types";

// Visual definitions for well-known tiles

// biome-ignore format: uniform one-liner-per-entry style
export const tileVisuals = new Map<string, Partial<TileVisual>>([
  // Operators
  [mkOperatorTileId(CoreOpId.And), { label: "AND", iconUrl: `${ICON_BASE}/and.svg` }],
  [mkOperatorTileId(CoreOpId.Or), { label: "OR", iconUrl: `${ICON_BASE}/or.svg` }],
  [mkOperatorTileId(CoreOpId.Not), { label: "NOT", iconUrl: `${ICON_BASE}/not.svg` }],
  [mkOperatorTileId(CoreOpId.Add), { label: "plus", iconUrl: `${ICON_BASE}/plus.svg` }],
  [mkOperatorTileId(CoreOpId.Subtract), { label: "minus", iconUrl: `${ICON_BASE}/minus.svg` }],
  [mkOperatorTileId(CoreOpId.Multiply), { label: "multiplied by", iconUrl: `${ICON_BASE}/multiply.svg` }],
  [mkOperatorTileId(CoreOpId.Divide), { label: "divided by", iconUrl: `${ICON_BASE}/divide.svg` }],
  [mkOperatorTileId(CoreOpId.Negate), { label: "negative", iconUrl: `${ICON_BASE}/negative.svg` }],
  [mkOperatorTileId(CoreOpId.EqualTo), { label: "equal to", iconUrl: `${ICON_BASE}/equals.svg` }],
  [mkOperatorTileId(CoreOpId.NotEqualTo), { label: "not equal to", iconUrl: `${ICON_BASE}/not_equal.svg` }],
  [mkOperatorTileId(CoreOpId.LessThan), { label: "less than", iconUrl: `${ICON_BASE}/less_than.svg` }],
  [mkOperatorTileId(CoreOpId.LessThanOrEqualTo), { label: "less than or equal to", iconUrl: `${ICON_BASE}/less_than_or_equal_to.svg` }],
  [mkOperatorTileId(CoreOpId.GreaterThan), { label: "greater than", iconUrl: `${ICON_BASE}/greater_than.svg` }],
  [mkOperatorTileId(CoreOpId.GreaterThanOrEqualTo), { label: "greater than or equal to", iconUrl: `${ICON_BASE}/greater_than_or_equal_to.svg` }],
  [mkOperatorTileId(CoreOpId.Assign), { label: "gets", iconUrl: `${ICON_BASE}/assign.svg` }],
  // Control Flow
  [mkControlFlowTileId(CoreControlFlowId.OpenParen), { label: "(", iconUrl: `${ICON_BASE}/open-paren.svg` }],
  [mkControlFlowTileId(CoreControlFlowId.CloseParen), { label: ")", iconUrl: `${ICON_BASE}/close-paren.svg` }],
  // Variable Factories
  [mkVariableFactoryTileId(CoreVariableFactoryId.Boolean), { label: "create a boolean variable", iconUrl: `${ICON_BASE}/switch.svg` }],
  [mkVariableFactoryTileId(CoreVariableFactoryId.Number), { label: "create a number variable", iconUrl: `${ICON_BASE}/number.svg` }],
  [mkVariableFactoryTileId(CoreVariableFactoryId.String), { label: "create a text variable", iconUrl: `${ICON_BASE}/text.svg` }],
  [mkVariableFactoryTileId(EcosimTypeIds.Vector2), { label: "create a vector2 variable", iconUrl: `${ICON_BASE}/vector2.svg` }],
  [mkVariableFactoryTileId(EcosimTypeIds.ActorRef), { label: "create an actor variable", iconUrl: `${ICON_BASE}/actor-mask.svg` }],
  // Literal Factories
  [mkLiteralFactoryTileId(CoreLiteralFactoryId.Number), { label: "create a number tile", iconUrl: `${ICON_BASE}/number.svg` }],
  [mkLiteralFactoryTileId(CoreLiteralFactoryId.String), { label: "create a text tile", iconUrl: `${ICON_BASE}/text.svg` }],
  // Well-known Literals
  [mkLiteralTileId(CoreTypeIds.Boolean, "true"), { label: "true", iconUrl: `${ICON_BASE}/switch_on.svg` }],
  [mkLiteralTileId(CoreTypeIds.Boolean, "false"), { label: "false", iconUrl: `${ICON_BASE}/switch_off.svg` }],
  [mkLiteralTileId(CoreTypeIds.Nil, "nil"), { label: "nil", iconUrl: `${ICON_BASE}/nil.svg` }],
  // Modifiers
  // Parameters
  // Sensors
  [mkSensorTileId(CoreHostActions.Random.key), { label: "random number", iconUrl: `${ICON_BASE}/random.svg` }],
  [mkSensorTileId(CoreHostActions.OnPageEntered.key), { label: "on page entered", iconUrl: `${ICON_BASE}/on-page-enter.svg` }],
  [mkSensorTileId(CoreHostActions.Timeout.key), { label: "timeout", iconUrl: `${ICON_BASE}/timer.svg` }],
  [mkSensorTileId(CoreHostActions.CurrentPage.key), { label: "current page", iconUrl: `${ICON_BASE}/page.svg` }],
  [mkSensorTileId(CoreHostActions.PreviousPage.key), { label: "previous page", iconUrl: `${ICON_BASE}/page2.svg` }],
  // Actuators
  [mkActuatorTileId(CoreHostActions.SwitchPage.key), { label: "switch page", iconUrl: `${ICON_BASE}/switch_page.svg` }],
  [mkActuatorTileId(CoreHostActions.RestartPage.key), { label: "restart page", iconUrl: `${ICON_BASE}/restart-page.svg` }],
  [mkActuatorTileId(CoreHostActions.Yield.key), { label: "yield", iconUrl: `${ICON_BASE}/yield.svg` }],
  // Field Accessors
  [mkAccessorTileId(EcosimTypeIds.Vector2, "x"), { label: "x", iconUrl: `${ICON_BASE}/vector2_x.svg` }],
  [mkAccessorTileId(EcosimTypeIds.Vector2, "y"), { label: "y", iconUrl: `${ICON_BASE}/vector2_y.svg` }],
]);
