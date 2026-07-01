import { List, type ReadonlyList } from "../../platform/list";
import type { ActionDescriptor, TileId } from "../../runtime";
import { BitSet, type ReadonlyBitSet } from "../../util/bitset";
import type {
  BrainTileDefCreateOptions,
  BrainTileKind,
  IBrainActionTileDef,
  IBrainTileDef,
  ITileMetadata,
  TilePlacement,
} from "../interfaces";

const emptyBitSet = new BitSet();
const emptyOutputs: ReadonlyList<string> = new List<string>();

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
  providedOutputs_?: ReadonlyList<string>;

  constructor(tileId: TileId, opts: BrainTileDefCreateOptions) {
    this.tileId = tileId;
    this.placement = opts.placement;
    this.deprecated = opts.deprecated;
    this.hidden = opts.hidden;
    this.persist = opts.persist;
    this.capabilities_ = opts.capabilities; // || lazy init in capabilities()
    this.requirements_ = opts.requirements; // || lazy init in requirements()
    this.providedOutputs_ = opts.providedOutputs;
    this.metadata = opts.metadata;
  }

  capabilities(): ReadonlyBitSet {
    return this.capabilities_ ?? emptyBitSet;
  }

  requirements(): ReadonlyBitSet {
    return this.requirements_ ?? emptyBitSet;
  }

  providedOutputs(): ReadonlyList<string> {
    return this.providedOutputs_ ?? emptyOutputs;
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
