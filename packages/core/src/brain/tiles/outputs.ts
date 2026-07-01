import { type ActionOutputSpec, mkOutputTileId, mkOutputVarKey, type TypeId } from "../../runtime";
import { type BrainTileDefCreateOptions, TilePlacement } from "../interfaces";
import { BrainTileDefBase } from "../model/tiledef";

/**
 * Tile definition for a sensor output value-tile: an inline, read-only value
 * exposed by a sensor's declared output. The tile reads the backing rule
 * variable keyed by {@link mkOutputVarKey} (`__out.<outputType>.<name>`), which
 * the sensor writes via `setOutput`.
 *
 * Identity is the `(outputType, name)` pair: two sensors declaring the same
 * identity produce the same {@link mkOutputTileId tile id} and therefore one
 * shared tile. The tile is offered downstream only when a sensor listing its
 * {@link outputKey} in its `providedOutputs` is present in the rule hierarchy.
 */
export class BrainTileOutputDef extends BrainTileDefBase {
  readonly kind = "output";

  /** Output name as declared on the sensor. */
  readonly outputName: string;

  /** Value type the output produces, used for editor type compatibility. */
  readonly outputType: TypeId;

  /** Backing rule-variable key this tile reads, and the identity a providing sensor lists. */
  readonly outputKey: string;

  /**
   * @param outputType - the resolved {@link TypeId} of the output value
   * @param outputName - the output name declared on the sensor
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
 * Build the inline output value-tiles for a built-in sensor's declared
 * {@link ActionOutputSpec} outputs. The declaring sensor exposes each tile's
 * {@link BrainTileOutputDef.outputKey} through its `providedOutputs`, which gates
 * the tile downstream; the sensor writes each output with {@link setSensorOutput}
 * and the tile reads the matching backing rule variable.
 */
export function buildDescriptorOutputTiles(outputs: readonly ActionOutputSpec[]): BrainTileOutputDef[] {
  const tiles: BrainTileOutputDef[] = [];
  for (const output of outputs) {
    tiles.push(
      new BrainTileOutputDef(output.type, output.name, {
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
