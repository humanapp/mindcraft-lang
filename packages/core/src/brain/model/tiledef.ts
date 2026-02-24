import { Error } from "../../platform/error";
import type { IReadStream, IWriteStream } from "../../platform/stream";
import { fourCC } from "../../primitives";
import { BitSet, type ReadonlyBitSet } from "../../util/bitset";
import type {
  BrainFunctionEntry,
  BrainTileDefCreateOptions,
  BrainTileKind,
  IBrainActionTileDef,
  IBrainTileDef,
  ITileCatalog,
  ITileVisual,
  TileId,
  TilePlacement,
} from "../interfaces";

export type AstBuildContext = {};

const STags = {
  TDHD: fourCC("TDHD"), // TileDef header
  TKND: fourCC("TKND"), // Tile kind
  TIID: fourCC("TIID"), // Tile id
};

type BrainTileDefHeader = {
  kind: BrainTileKind;
  tileId: TileId;
};

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

  serializeHeader(stream: IWriteStream): void {
    stream.writeTaggedU32(STags.TDHD, 1);
    stream.writeTaggedString(STags.TKND, this.kind);
    stream.writeTaggedString(STags.TIID, this.tileId);
  }

  serialize(stream: IWriteStream): void {
    this.serializeHeader(stream);
  }
}

export abstract class BrainActionTileBase extends BrainTileDefBase implements IBrainActionTileDef {
  readonly fnEntry: BrainFunctionEntry;

  constructor(tileId: TileId, fnEntry: BrainFunctionEntry, opts: BrainTileDefCreateOptions) {
    super(tileId, opts);
    this.fnEntry = fnEntry;
  }
}

export function BrainTileDefBase_deserializeHeader(stream: IReadStream): BrainTileDefHeader {
  const version = stream.readTaggedU32(STags.TDHD);
  if (version !== 1) {
    throw new Error(`BrainTileDef.deserialize: unsupported version ${version}`);
  }
  const kind = stream.readTaggedString(STags.TKND) as BrainTileKind;
  const tileId = stream.readTaggedString(STags.TIID);
  return { kind, tileId };
}

export function BrainTileDefBase_peekHeader(stream: IReadStream): BrainTileDefHeader {
  stream.pushReadPos();
  try {
    return BrainTileDefBase_deserializeHeader(stream);
  } finally {
    stream.popReadPos();
  }
}

export function BrainTileDef_deserialize(stream: IReadStream, catalog: ITileCatalog): IBrainTileDef {
  const { kind, tileId } = BrainTileDefBase_deserializeHeader(stream);
  const tileDef = catalog.get(tileId);
  if (!tileDef) {
    throw new Error(`BrainTileDef.deserialize: unknown tileId ${tileId}`);
  }
  if (kind !== tileDef.kind) {
    throw new Error(
      `BrainTileDef.deserialize: kind mismatch for tileId ${tileId} (expected ${tileDef.kind}, got ${kind})`
    );
  }
  return tileDef;
}
