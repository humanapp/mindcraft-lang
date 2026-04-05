import { Error } from "../../platform/error";
import { BitSet } from "../../util/bitset";
import {
  type ActionDescriptor,
  type BrainTileDefCreateOptions,
  CoreCapabilityBits,
  mkSensorTileId,
  TilePlacement,
  type TypeId,
} from "../interfaces";
import { BrainActionTileBase } from "../model/tiledef";
import fnCurrentPage from "../runtime/sensors/current-page";
import fnOnPageEntered from "../runtime/sensors/on-page-entered";
import fnPreviousPage from "../runtime/sensors/previous-page";
import fnRandom from "../runtime/sensors/random";
import fnTimeout from "../runtime/sensors/timeout";
import type { BrainServices } from "../services";

/**
 * Defines a sensor tile for the brain system.
 *
 * Sensors are brain tiles that read environmental or entity state and produce output values.
 * They can be synchronous or asynchronous, accept optional arguments, and return typed outputs.
 * Sensors are typically placed on the "when" side of brain logic, providing input data for
 * decision-making and actions.
 */
export class BrainTileSensorDef extends BrainActionTileBase {
  /** The type of brain tile - always "sensor" for sensor tiles */
  readonly kind = "sensor";

  /** Unique identifier for this sensor, used to reference it in brain configurations */
  readonly sensorId: string;

  /** The type identifier of the value this sensor outputs (e.g., "number", "boolean", "entity") */
  readonly outputType: TypeId;

  /**
   * Creates a new sensor tile definition.
   *
   * @param sensorId - Unique identifier for this sensor
   * @param action - Stable action metadata for this sensor
   * @param opts - Optional configuration for tile placement and display properties
   */
  constructor(sensorId: string, action: ActionDescriptor, opts: BrainTileDefCreateOptions = {}) {
    if (action.kind !== "sensor") {
      throw new Error(`BrainTileSensorDef: expected sensor action for ${sensorId}`);
    }
    if (action.outputType === undefined) {
      throw new Error(`BrainTileSensorDef: missing output type for ${sensorId}`);
    }
    // Default sensors to WhenSide placement if not specified
    if (opts.placement === undefined) opts.placement = TilePlacement.WhenSide;
    super(mkSensorTileId(sensorId), action, opts);
    this.sensorId = sensorId;
    this.outputType = action.outputType;
  }
}

export function registerCoreSensorTileDefs(services: BrainServices) {
  const tiles = services.tiles;
  const register = (sensorId: string, action: typeof fnRandom.descriptor, opts: BrainTileDefCreateOptions = {}) => {
    const tileDef = new BrainTileSensorDef(sensorId, action, opts);
    tiles.registerTileDef(tileDef);
  };
  register(fnRandom.fnId, fnRandom.descriptor, {
    placement: TilePlacement.EitherSide | TilePlacement.Inline,
  });
  register(fnOnPageEntered.fnId, fnOnPageEntered.descriptor);
  register(fnTimeout.fnId, fnTimeout.descriptor);
  const pageSensorCaps = new BitSet().set(CoreCapabilityBits.PageSensor);
  register(fnCurrentPage.fnId, fnCurrentPage.descriptor, {
    placement: TilePlacement.EitherSide | TilePlacement.Inline,
    capabilities: pageSensorCaps,
  });
  register(fnPreviousPage.fnId, fnPreviousPage.descriptor, {
    placement: TilePlacement.EitherSide | TilePlacement.Inline,
    capabilities: pageSensorCaps,
  });
}
