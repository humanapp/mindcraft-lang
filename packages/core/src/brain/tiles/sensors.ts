import { Error } from "../../platform/error";
import {
  type BrainFunctionEntry,
  type BrainTileDefCreateOptions,
  CoreSensorId,
  CoreTypeIds,
  mkSensorTileId,
  TilePlacement,
  type TypeId,
} from "../interfaces";
import { BrainActionTileBase, BrainTileDefBase } from "../model/tiledef";
import fnOnPageEntered from "../runtime/sensors/on-page-entered";
import fnRandom from "../runtime/sensors/random";
import { getBrainServices } from "../services";

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
   * @param isAsync - Whether the sensor function returns a Promise
   * @param fn - The host function that implements the sensor's logic
   * @param outputType - The type identifier of the sensor's output value
   * @param callSpec - Specification of the sensor's arguments and metadata
   * @param opts - Optional configuration for tile placement and display properties
   */
  constructor(sensorId: string, fnEntry: BrainFunctionEntry, outputType: TypeId, opts: BrainTileDefCreateOptions = {}) {
    // Default sensors to WhenSide placement if not specified
    if (opts.placement === undefined) opts.placement = TilePlacement.WhenSide;
    super(mkSensorTileId(sensorId), fnEntry, opts);
    this.sensorId = sensorId;
    this.outputType = outputType;
  }
}

export function registerCoreSensorTileDefs() {
  const tiles = getBrainServices().tiles;
  const register = (sensorId: string, outputType: TypeId, opts: BrainTileDefCreateOptions = {}) => {
    const fnEntry = getBrainServices().functions.get(sensorId);
    if (!fnEntry) throw new Error(`registerCoreSensorTileDefs: missing function entry for ${sensorId}`);
    const tileDef = new BrainTileSensorDef(sensorId, fnEntry, outputType, opts);
    tiles.registerTileDef(tileDef);
  };
  register(fnRandom.fnId, CoreTypeIds.Number, {
    placement: TilePlacement.EitherSide | TilePlacement.Inline,
  });
  register(fnOnPageEntered.fnId, CoreTypeIds.Boolean);
}
