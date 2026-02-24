import { Error } from "../../platform/error";
import type { IReadStream } from "../../platform/stream";
import {
  type BrainTileDefCreateOptions,
  CoreControlFlowId,
  type ITileCatalog,
  mkControlFlowTileId,
  TilePlacement,
} from "../interfaces";
import { BrainTileDefBase, BrainTileDefBase_deserializeHeader } from "../model/tiledef";
import { getBrainServices } from "../services";

export class BrainTileControlFlowDef extends BrainTileDefBase {
  readonly kind = "controlFlow";
  readonly cfId: string;

  constructor(cfId: string, opts: BrainTileDefCreateOptions = {}) {
    super(mkControlFlowTileId(cfId), opts);
    this.cfId = cfId;
  }
}

export function BrainTileControlFlowDef_deserialize(
  stream: IReadStream,
  catalog: ITileCatalog
): BrainTileControlFlowDef {
  const { kind, tileId } = BrainTileDefBase_deserializeHeader(stream);
  if (kind !== "controlFlow") {
    throw new Error(`BrainTileControlFlowDef.deserialize: invalid kind ${kind}`);
  }
  const tileDef = catalog.get(tileId);
  if (tileDef && tileDef.kind === "controlFlow") {
    return tileDef as BrainTileControlFlowDef;
  }
  throw new Error(`BrainTileControlFlowDef.deserialize: unknown tileId ${tileId}`);
}

function registerCoreControlFlowTileDef(cfId: string, opts: BrainTileDefCreateOptions = {}) {
  const tileDef = new BrainTileControlFlowDef(cfId, opts);
  getBrainServices().tiles.registerTileDef(tileDef);
}

export function registerCoreControlFlowTileDefs() {
  const tiles = getBrainServices().tiles;
  const register = (cfId: string, opts: BrainTileDefCreateOptions = {}) => {
    const tileDef = new BrainTileControlFlowDef(cfId, opts);
    tiles.registerTileDef(tileDef);
  };
  register(CoreControlFlowId.OpenParen, { placement: TilePlacement.EitherSide });
  register(CoreControlFlowId.CloseParen, { placement: TilePlacement.EitherSide });
  //registerCoreControlFlowTileDef(CoreControlFlowId.Continue, TilePlacement.DoSide | TilePlacement.InsideLoop, false);
  //registerCoreControlFlowTileDef(CoreControlFlowId.Break, TilePlacement.DoSide | TilePlacement.InsideLoop, false);
  //registerCoreControlFlowTileDef(CoreControlFlowId.ForEach, TilePlacement.WhenSide, false);
}
