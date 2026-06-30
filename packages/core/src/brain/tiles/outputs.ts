import { Dict } from "../../platform/dict";
import { type ActionOutputSpec, mkOutputTileId, mkOutputVarKey, type TypeId } from "../../runtime";
import { BitSet } from "../../util/bitset";
import { type BrainTileDefCreateOptions, OUTPUT_CAPABILITY_BIT_OFFSET, TilePlacement } from "../interfaces";
import { BrainTileDefBase } from "../model/tiledef";

/**
 * Tile definition for a sensor output value-tile: an inline, read-only value
 * exposed by a sensor's declared output. The tile reads the backing rule
 * variable keyed by {@link mkOutputVarKey} (`__out.<outputType>.<name>`), which
 * the sensor writes via `setOutput`.
 *
 * Identity is the `(outputType, name)` pair: two sensors declaring the same
 * identity produce the same {@link mkOutputTileId tile id} and therefore one
 * shared tile. The tile is gated by a per-identity capability supplied through
 * `opts.requirements`; the declaring sensors provide that capability so the tile
 * is offered only downstream of a sensor that declares it.
 */
export class BrainTileOutputDef extends BrainTileDefBase {
  readonly kind = "output";

  /** Output name as declared on the sensor. */
  readonly outputName: string;

  /** Value type the output produces, used for editor type compatibility. */
  readonly outputType: TypeId;

  /** Backing rule-variable key this tile reads (and `setOutput` writes). */
  readonly outputKey: string;

  /**
   * @param outputType - the resolved {@link TypeId} of the output value
   * @param outputName - the output name declared on the sensor
   * @param opts - tile options; `requirements` carries the gating capability
   */
  constructor(outputType: TypeId, outputName: string, opts: BrainTileDefCreateOptions = {}) {
    if (opts.placement === undefined) opts.placement = TilePlacement.EitherSide | TilePlacement.Inline;
    super(mkOutputTileId(outputType, outputName), opts);
    this.outputName = outputName;
    this.outputType = outputType;
    this.outputKey = mkOutputVarKey(outputType, outputName);
  }
}

/**
 * Interns sensor-output identities to capability bits during one tile
 * registration pass. Each distinct identity key (see {@link mkOutputVarKey})
 * maps to one bit at or above {@link OUTPUT_CAPABILITY_BIT_OFFSET}; every
 * declaring sensor provides that bit and the one shared output tile requires it.
 * Bits are edit-time only and are not serialized, so a single allocator must
 * span a whole registration pass for a shared identity to resolve to one bit.
 */
export class OutputCapabilityAllocator {
  private next = OUTPUT_CAPABILITY_BIT_OFFSET;
  private readonly bits = new Dict<string, number>();

  /** Capability bit for an output identity key, allocating a fresh bit on first request and reusing it thereafter. */
  alloc(identityKey: string): number {
    const existing = this.bits.get(identityKey);
    if (existing !== undefined) return existing;
    const bit = this.next++;
    this.bits.set(identityKey, bit);
    return bit;
  }
}

/**
 * Build the inline output value-tiles for a built-in sensor's declared
 * {@link ActionOutputSpec} outputs. Each output identity is interned to a gating
 * capability via `outputCapabilities` and the bit is recorded in `sensorCaps`
 * (the declaring sensor provides it); the returned tile requires the same bit.
 * The sensor writes each output with {@link setSensorOutput} and the tile reads
 * the matching backing rule variable.
 */
export function buildDescriptorOutputTiles(
  outputs: readonly ActionOutputSpec[],
  outputCapabilities: OutputCapabilityAllocator,
  sensorCaps: BitSet
): BrainTileOutputDef[] {
  const tiles: BrainTileOutputDef[] = [];
  for (const output of outputs) {
    const bit = outputCapabilities.alloc(mkOutputVarKey(output.type, output.name));
    sensorCaps.set(bit);
    tiles.push(
      new BrainTileOutputDef(output.type, output.name, {
        requirements: new BitSet().set(bit),
        metadata: {
          label: output.label ?? output.name,
          iconUrl: output.iconUrl,
          docsMarkdown: output.docsMarkdown,
          tags: output.tags,
        },
      })
    );
  }
  return tiles;
}
