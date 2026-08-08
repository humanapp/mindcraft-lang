import { Error } from "../../platform/error";
import type { TypeId } from "../../runtime";
import type {
  BrainTileDefCreateOptions,
  BrainTileLiteralDefOptions,
  IBrainTileDef,
  IBrainTileDefBuilder,
  ITileCatalog,
  TileId,
} from "../interfaces";
import type { BrainServices } from "../services";
import { BrainTileControlFlowDef } from "./controlflow";
import { BrainTileLiteralDef } from "./literals";
import { BrainTileOperatorDef } from "./operators";
import { BrainTileVariableDef } from "./variables";

/** Concrete {@link IBrainTileDefBuilder}: factory methods for building each kind of {@link IBrainTileDef}. */
export class BrainTileDefBuilder implements IBrainTileDefBuilder {
  private services_?: BrainServices;

  setServices(services: BrainServices): void {
    this.services_ = services;
  }

  private requireServices(): BrainServices {
    if (!this.services_) {
      throw new Error("BrainTileDefBuilder: services not initialized. Call setServices() first.");
    }
    return this.services_;
  }

  // Operator Tiles
  createOperatorTileDef(opId: string, opts: BrainTileDefCreateOptions = {}): IBrainTileDef {
    return new BrainTileOperatorDef(opId, opts, this.requireServices());
  }

  // Control Flow Tiles
  createControlFlowTileDef(cfId: string, opts: BrainTileDefCreateOptions = {}): IBrainTileDef {
    return new BrainTileControlFlowDef(cfId, opts);
  }

  // Variable Tiles
  createVariableTileDef(
    catalog: ITileCatalog,
    tileId: TileId,
    varName: string,
    varType: TypeId,
    uniqueId: string,
    opts: BrainTileDefCreateOptions = {}
  ): IBrainTileDef {
    return this.register_(catalog, new BrainTileVariableDef(tileId, varName, varType, uniqueId, opts));
  }

  // Literal Tiles
  createLiteralTileDef(
    catalog: ITileCatalog,
    valueType: TypeId,
    value: unknown,
    opts: BrainTileLiteralDefOptions = {}
  ): IBrainTileDef {
    return this.register_(catalog, new BrainTileLiteralDef(valueType, value, opts, this.requireServices()));
  }

  /** The def `catalog` already holds under `tileDef`'s id, registering `tileDef` under it when it holds none. */
  private register_(catalog: ITileCatalog, tileDef: IBrainTileDef): IBrainTileDef {
    const existing = catalog.get(tileDef.tileId);
    if (existing) return existing;
    catalog.registerTileDef(tileDef);
    return tileDef;
  }
}
