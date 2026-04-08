import { Error } from "../../platform/error";
import type {
  BrainTileDefCreateOptions,
  BrainTileLiteralDefOptions,
  IBrainTileDef,
  IBrainTileDefBuilder,
  TileId,
  TypeId,
} from "../interfaces";
import type { BrainServices } from "../services";
import { BrainTileControlFlowDef } from "./controlflow";
import { BrainTileLiteralDef } from "./literals";
import { BrainTileOperatorDef } from "./operators";
import { BrainTileVariableDef } from "./variables";

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
    tileId: TileId,
    varName: string,
    varType: TypeId,
    uniqueId: string,
    opts: BrainTileDefCreateOptions = {}
  ): IBrainTileDef {
    return new BrainTileVariableDef(tileId, varName, varType, uniqueId, opts);
  }

  // Literal Tiles
  createLiteralTileDef(valueType: TypeId, value: unknown, opts: BrainTileLiteralDefOptions = {}): IBrainTileDef {
    return new BrainTileLiteralDef(valueType, value, opts, this.requireServices());
  }
}
