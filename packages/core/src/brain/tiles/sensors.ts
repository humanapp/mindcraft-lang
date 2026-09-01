import { Error } from "../../platform/error";
import { type ActionDescriptor, mkSensorTileId, type TypeId, type UserActionIdentity } from "../../runtime";
import fnCurrentPage from "../../runtime/sensors/current-page";
import fnOnPageEntered from "../../runtime/sensors/on-page-entered";
import fnOtherwise from "../../runtime/sensors/otherwise";
import fnPreviousPage from "../../runtime/sensors/previous-page";
import fnRandom from "../../runtime/sensors/random";
import fnTimeout from "../../runtime/sensors/timeout";
import { BitSet } from "../../util/bitset";
import { type BrainTileDefCreateOptions, CoreCapabilityBits, TilePlacement } from "../interfaces";
import { BrainActionTileBase } from "../model/tiledef";
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
   * When true, the sensor's returned value is a writable l-value: a field write
   * on its result is permitted. Defaults to false, making the result read-only.
   */
  readonly writableResult: boolean;

  /** Namespace and stable id of the compiled user action backing this tile. Absent for platform sensors. */
  readonly userIdentity?: UserActionIdentity;

  /**
   * Creates a new sensor tile definition.
   *
   * @param sensorId - Unique identifier for this sensor
   * @param action - Stable action metadata for this sensor
   * @param opts - Optional configuration for tile placement and display properties
   */
  constructor(
    sensorId: string,
    action: ActionDescriptor,
    opts: BrainTileDefCreateOptions & { userIdentity?: UserActionIdentity } = {}
  ) {
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
    this.writableResult = opts.writableResult ?? false;
    this.userIdentity = opts.userIdentity;
  }
}

/** Register the built-in core sensor tiles on `services`. */
export function registerCoreSensorTileDefs(services: BrainServices) {
  const tiles = services.edit.tiles;
  const register = (sensorId: string, action: typeof fnRandom.descriptor, opts: BrainTileDefCreateOptions = {}) => {
    const tileDef = new BrainTileSensorDef(sensorId, action, opts);
    tiles.registerTileDef(tileDef);
  };
  register(fnRandom.key, fnRandom.descriptor, {
    placement: TilePlacement.EitherSide | TilePlacement.Inline,
    metadata: { label: "random number", language: { form: "a random number" } },
  });
  register(fnOnPageEntered.key, fnOnPageEntered.descriptor, {
    metadata: { label: "this page starts", language: { form: "this page starts", frame: "event" } },
  });
  register(fnTimeout.key, fnTimeout.descriptor, {
    metadata: { label: "timer", language: { form: "wait for", bare: "a moment" } },
  });
  const pageSensorCaps = new BitSet().set(CoreCapabilityBits.PageSensor);
  register(fnCurrentPage.key, fnCurrentPage.descriptor, {
    placement: TilePlacement.EitherSide | TilePlacement.Inline,
    capabilities: pageSensorCaps,
    metadata: { label: "current page", language: { form: "the current page" } },
  });
  register(fnPreviousPage.key, fnPreviousPage.descriptor, {
    placement: TilePlacement.EitherSide | TilePlacement.Inline,
    capabilities: pageSensorCaps,
    metadata: { label: "previous page", language: { form: "the previous page" } },
  });
  register(fnOtherwise.key, fnOtherwise.descriptor, {
    deprecated: true,
    placement: TilePlacement.WhenSide | TilePlacement.Inline,
    capabilities: new BitSet().set(CoreCapabilityBits.RequiresPrecedingSiblingRule),
    metadata: { label: "otherwise", language: { form: "otherwise", frame: "adverb" } },
  });
}
