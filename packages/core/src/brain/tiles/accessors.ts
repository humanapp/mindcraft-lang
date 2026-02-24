import { type BrainTileDefCreateOptions, mkAccessorTileId, TilePlacement } from "../interfaces";
import type { TypeId } from "../interfaces/type-system";
import { BrainTileDefBase } from "../model/tiledef";
import { getBrainServices } from "../services";

export type BrainAccessorTileDefCreateOptions = BrainTileDefCreateOptions & {
  /** When true, the field is read-only and cannot appear as an assignment target. */
  readOnly?: boolean;
};

/**
 * Tile definition for struct field accessors.
 *
 * An accessor tile appears immediately after an expression that produces a struct value
 * and selects a named field from it. In tile sequences, the syntax is:
 *
 *   [$my_position] [x]        ->  FieldAccessExpr(variable(my_position), "x")
 *   [$my_position] [x] [=] [10]  ->  Assignment(FieldAccess(variable(my_position), "x"), 10)
 *
 * The parser treats accessor tiles as LED (left denotation) tokens --
 * they bind to the left expression at maximum precedence, like postfix operators.
 *
 * When `readOnly` is true, the parser rejects assignments to this field and the
 * tile suggestion system suppresses the assignment operator after a field access
 * using this accessor.
 */
export class BrainTileAccessorDef extends BrainTileDefBase {
  readonly kind = "accessor";
  readonly fieldName: string;
  readonly structTypeId: TypeId;
  readonly fieldTypeId: TypeId;
  readonly readOnly: boolean;

  constructor(
    structTypeId: TypeId,
    fieldName: string,
    fieldTypeId: TypeId,
    opts: BrainAccessorTileDefCreateOptions = {}
  ) {
    if (opts.placement === undefined) opts.placement = TilePlacement.EitherSide;
    super(mkAccessorTileId(structTypeId, fieldName), opts);
    this.structTypeId = structTypeId;
    this.fieldName = fieldName;
    this.fieldTypeId = fieldTypeId;
    this.readOnly = opts.readOnly ?? false;
  }
}

export function createAccessorTileDef(
  structTypeId: TypeId,
  fieldName: string,
  fieldTypeId: TypeId,
  opts?: BrainAccessorTileDefCreateOptions
): BrainTileAccessorDef {
  return new BrainTileAccessorDef(structTypeId, fieldName, fieldTypeId, opts);
}

export function isAccessorTileDef(tileDef: BrainTileDefBase): tileDef is BrainTileAccessorDef {
  return tileDef.kind === "accessor";
}

export function registerAccessorTileDef(
  structTypeId: TypeId,
  fieldName: string,
  fieldTypeId: TypeId,
  opts?: BrainAccessorTileDefCreateOptions
) {
  const tileDef = createAccessorTileDef(structTypeId, fieldName, fieldTypeId, opts);
  getBrainServices().tiles.registerTileDef(tileDef);
}
