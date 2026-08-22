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
} from "@wendoo-lang/core/app";
import { ICON_BASE } from "@/brain/icon-base";
import { EcosimTypeIds } from "@/brain/type-system";
import type { TileVisual } from "./types";

// Visual definitions for well-known tiles

// biome-ignore format: uniform one-liner-per-entry style
export const tileVisuals = new Map<string, Partial<TileVisual>>([
  // Operators
  [mkOperatorTileId(CoreOpId.And), { iconUrl: `${ICON_BASE}/and.svg` }],
  [mkOperatorTileId(CoreOpId.Or), { iconUrl: `${ICON_BASE}/or.svg` }],
  [mkOperatorTileId(CoreOpId.Not), { iconUrl: `${ICON_BASE}/not.svg` }],
  [mkOperatorTileId(CoreOpId.Add), { iconUrl: `${ICON_BASE}/plus.svg` }],
  [mkOperatorTileId(CoreOpId.Subtract), { iconUrl: `${ICON_BASE}/minus.svg` }],
  [mkOperatorTileId(CoreOpId.Multiply), { iconUrl: `${ICON_BASE}/multiply.svg` }],
  [mkOperatorTileId(CoreOpId.Divide), { iconUrl: `${ICON_BASE}/divide.svg` }],
  [mkOperatorTileId(CoreOpId.Negate), { iconUrl: `${ICON_BASE}/negative.svg` }],
  [mkOperatorTileId(CoreOpId.EqualTo), { iconUrl: `${ICON_BASE}/equals.svg` }],
  [mkOperatorTileId(CoreOpId.NotEqualTo), { iconUrl: `${ICON_BASE}/not_equal.svg` }],
  [mkOperatorTileId(CoreOpId.LessThan), { iconUrl: `${ICON_BASE}/less_than.svg` }],
  [mkOperatorTileId(CoreOpId.LessThanOrEqualTo), { iconUrl: `${ICON_BASE}/less_than_or_equal_to.svg` }],
  [mkOperatorTileId(CoreOpId.GreaterThan), { iconUrl: `${ICON_BASE}/greater_than.svg` }],
  [mkOperatorTileId(CoreOpId.GreaterThanOrEqualTo), { iconUrl: `${ICON_BASE}/greater_than_or_equal_to.svg` }],
  [mkOperatorTileId(CoreOpId.Assign), { iconUrl: `${ICON_BASE}/assign.svg` }],
  // Control Flow
  [mkControlFlowTileId(CoreControlFlowId.OpenParen), { iconUrl: `${ICON_BASE}/open-paren.svg` }],
  [mkControlFlowTileId(CoreControlFlowId.CloseParen), { iconUrl: `${ICON_BASE}/close-paren.svg` }],
  // Variable Factories
  [mkVariableFactoryTileId(CoreVariableFactoryId.Boolean), { label: "create a boolean variable", iconUrl: `${ICON_BASE}/switch.svg` }],
  [mkVariableFactoryTileId(CoreVariableFactoryId.Number), { label: "create a number variable", iconUrl: `${ICON_BASE}/number.svg` }],
  [mkVariableFactoryTileId(CoreVariableFactoryId.String), { label: "create a text variable", iconUrl: `${ICON_BASE}/text.svg` }],
  [mkVariableFactoryTileId(EcosimTypeIds.Vector2), { label: "create a vector2 variable", iconUrl: `${ICON_BASE}/vector2.svg` }],
  [mkVariableFactoryTileId(EcosimTypeIds.ActorRef), { label: "create an actor variable", iconUrl: `${ICON_BASE}/actor-mask.svg` }],
  // Literal Factories
  [mkLiteralFactoryTileId(CoreLiteralFactoryId.Number), { iconUrl: `${ICON_BASE}/number.svg` }],
  [mkLiteralFactoryTileId(CoreLiteralFactoryId.String), { iconUrl: `${ICON_BASE}/text.svg` }],
  // Well-known Literals
  [mkLiteralTileId(CoreTypeIds.Boolean, "true"), { iconUrl: `${ICON_BASE}/switch_on.svg` }],
  [mkLiteralTileId(CoreTypeIds.Boolean, "false"), { iconUrl: `${ICON_BASE}/switch_off.svg` }],
  [mkLiteralTileId(CoreTypeIds.Nil, "nil"), { iconUrl: `${ICON_BASE}/nil.svg` }],
  // Modifiers
  // Parameters
  // Sensors
  [mkSensorTileId(CoreHostActions.Random.key), { iconUrl: `${ICON_BASE}/random.svg` }],
  [mkSensorTileId(CoreHostActions.OnPageEntered.key), { iconUrl: `${ICON_BASE}/on-page-enter.svg` }],
  [mkSensorTileId(CoreHostActions.Timeout.key), { iconUrl: `${ICON_BASE}/timer.svg` }],
  [mkSensorTileId(CoreHostActions.CurrentPage.key), { iconUrl: `${ICON_BASE}/page.svg` }],
  [mkSensorTileId(CoreHostActions.PreviousPage.key), { iconUrl: `${ICON_BASE}/page2.svg` }],
  [mkSensorTileId(CoreHostActions.Otherwise.key), { iconUrl: `${ICON_BASE}/otherwise.svg` }],
  // Actuators
  [mkActuatorTileId(CoreHostActions.SwitchPage.key), { iconUrl: `${ICON_BASE}/switch_page.svg` }],
  [mkActuatorTileId(CoreHostActions.RestartPage.key), { iconUrl: `${ICON_BASE}/restart-page.svg` }],
  [mkActuatorTileId(CoreHostActions.Yield.key), { label: "yield", iconUrl: `${ICON_BASE}/yield.svg` }],
  // Field Accessors
  [mkAccessorTileId(EcosimTypeIds.Vector2, "x"), { iconUrl: `${ICON_BASE}/vector2_x.svg` }],
  [mkAccessorTileId(EcosimTypeIds.Vector2, "y"), { iconUrl: `${ICON_BASE}/vector2_y.svg` }],
]);
