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

const emptyBitSet = new BitSet();

/** Abstract base implementing the common {@link IBrainTileDef} fields shared by all tile definitions. */
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

/** Abstract base for tiles bound to an {@link ActionDescriptor} (sensors and actuators). */
export abstract class BrainActionTileBase extends BrainTileDefBase implements IBrainActionTileDef {
  readonly action: ActionDescriptor;

  constructor(tileId: TileId, action: ActionDescriptor, opts: BrainTileDefCreateOptions) {
    super(tileId, opts);
    this.action = action;
  }
}
