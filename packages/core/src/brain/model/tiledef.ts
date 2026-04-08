import { BitSet, type ReadonlyBitSet } from "../../util/bitset";
import type {
  ActionDescriptor,
  BrainTileDefCreateOptions,
  BrainTileKind,
  IBrainActionTileDef,
  IBrainTileDef,
  ITileVisual,
  TileId,
  TilePlacement,
} from "../interfaces";

export type AstBuildContext = {};

const emptyBitSet = new BitSet();

export abstract class BrainTileDefBase implements IBrainTileDef {
  abstract readonly kind: BrainTileKind;
  readonly tileId: TileId;
  visual?: ITileVisual; // platform-specific visual representation, can be supplied in constructor options or at registration time via `tileVisualProvider`
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
    this.visual = opts.visual;
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
