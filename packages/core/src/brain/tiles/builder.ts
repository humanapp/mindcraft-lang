import type { IReadStream } from "../../platform/stream";
import type {
  BrainTileDefCreateOptions,
  BrainTileLiteralDefOptions,
  IBrainTileDef,
  IBrainTileDefBuilder,
  ITileCatalog,
  TileId,
  TypeId,
} from "../interfaces";
import { BrainTileDef_deserialize, BrainTileDefBase_peekHeader } from "../model/tiledef";
import { BrainTileControlFlowDef, BrainTileControlFlowDef_deserialize } from "./controlflow";
import { BrainTileLiteralDef, BrainTileLiteralDef_deserialize } from "./literals";
import { BrainTileMissingDef_deserialize } from "./missing";
import { BrainTileOperatorDef, BrainTileOperatorDef_deserialize } from "./operators";
import { BrainTilePageDef_deserialize } from "./pagetiles";
import { BrainTileVariableDef, BrainTileVariableDef_deserialize } from "./variables";

export class BrainTileDefBuilder implements IBrainTileDefBuilder {
  // Operator Tiles
  createOperatorTileDef(opId: string, opts: BrainTileDefCreateOptions = {}): IBrainTileDef {
    return new BrainTileOperatorDef(opId, opts);
  }
  deserializeOperatorTileDef(stream: IReadStream, catalog: ITileCatalog): IBrainTileDef {
    return BrainTileOperatorDef_deserialize(stream, catalog);
  }

  // Control Flow Tiles
  createControlFlowTileDef(cfId: string, opts: BrainTileDefCreateOptions = {}): IBrainTileDef {
    return new BrainTileControlFlowDef(cfId, opts);
  }
  deserializeControlFlowTileDef(stream: IReadStream, catalog: ITileCatalog): IBrainTileDef {
    return BrainTileControlFlowDef_deserialize(stream, catalog);
  }

  // Variable Tiles
  createVariableTileDef(
    tileId: TileId,
    varName: string,
    varType: TypeId,
    uniqueId: string,
    opts: BrainTileDefCreateOptions = {}
  ): IBrainTileDef {
    return new BrainTileVariableDef(tileId, varName, varType, uniqueId, opts);
  }
  deserializeVariableTileDef(stream: IReadStream, catalog: ITileCatalog): IBrainTileDef {
    return BrainTileVariableDef_deserialize(stream, catalog);
  }

  // Literal Tiles
  createLiteralTileDef(valueType: TypeId, value: unknown, opts: BrainTileLiteralDefOptions = {}): IBrainTileDef {
    return new BrainTileLiteralDef(valueType, value, opts);
  }
  deserializeLiteralTileDef(stream: IReadStream, catalog: ITileCatalog): IBrainTileDef {
    return BrainTileLiteralDef_deserialize(stream, catalog);
  }

  // top-level deserialize (delegates to specific tile type deserializers)
  deserializeTileDef(stream: IReadStream, catalog: ITileCatalog): IBrainTileDef {
    const { kind } = BrainTileDefBase_peekHeader(stream);
    switch (kind) {
      case "operator":
        return this.deserializeOperatorTileDef(stream, catalog);
      case "variable":
        return this.deserializeVariableTileDef(stream, catalog);
      case "literal":
        return this.deserializeLiteralTileDef(stream, catalog);
      case "page":
        return BrainTilePageDef_deserialize(stream, catalog);
      case "missing":
        return BrainTileMissingDef_deserialize(stream, catalog);
      default:
        return BrainTileDef_deserialize(stream, catalog);
    }
  }
}
