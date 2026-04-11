import { BitSet, type ReadonlyBitSet } from "../../util/bitset";
import type {
  ActionDescriptor,
  BrainTileDefCreateOptions,
  BrainTileKind,
  IBrainActionTileDef,
  IBrainTileDef,
  ITileMetadata,
  TileId,
  TilePlacement,
} from "../interfaces";

export type AstBuildContext = {};

const emptyBitSet = new BitSet();

export abstract class BrainTileDefBase implements IBrainTileDef {
  abstract readonly kind: BrainTileKind;
  readonly tileId: TileId;
  metadata?: ITileMetadata;
  placement?: TilePlacement;
  deprecated?: boolean;
  hidden?: boolean;
  persist?: boolean;
  capabilities_?: BitSet;
  requirements_?: BitSet;

  constructor(tileId: TileId, opts: BrainTileDefCreateOptions) {
    this.tileId = tileId;
    this.placement = opts.placement;
    this.deprecated = opts.deprecated;
    this.hidden = opts.hidden;
    this.persist = opts.persist;
    this.capabilities_ = opts.capabilities; // || lazy init in capabilities()
    this.requirements_ = opts.requirements; // || lazy init in requirements()
    this.metadata = opts.metadata;
  }

  capabilities(): ReadonlyBitSet {
    return this.capabilities_ ?? emptyBitSet;
  }

  requirements(): ReadonlyBitSet {
    return this.requirements_ ?? emptyBitSet;
  }
}

export abstract class BrainActionTileBase extends BrainTileDefBase implements IBrainActionTileDef {
  readonly action: ActionDescriptor;

  constructor(tileId: TileId, action: ActionDescriptor, opts: BrainTileDefCreateOptions) {
    super(tileId, opts);
    this.action = action;
  }
}
