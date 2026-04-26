import { NativeType, nativeTypeToString, type TypeId } from "./type-system";

/** Build a {@link TypeId} from a `NativeType` and a (unique) type name. */
export function mkTypeId(coreType: NativeType, typeName: string): TypeId {
  return `${nativeTypeToString(coreType)}:<${typeName}>`;
}

/** Type names for the brain's built-in primitive types. */
export const CoreTypeNames = {
  Unknown: "unknown",
  Void: "void",
  Nil: "nil",
  Boolean: "boolean",
  Number: "number",
  String: "string",
  Any: "any",
  Function: "function",
};

/** {@link TypeId}s for the brain's built-in primitive types. */
export const CoreTypeIds = {
  Unknown: mkTypeId(NativeType.Unknown, CoreTypeNames.Unknown),
  Void: mkTypeId(NativeType.Void, CoreTypeNames.Void),
  Nil: mkTypeId(NativeType.Nil, CoreTypeNames.Nil),
  Boolean: mkTypeId(NativeType.Boolean, CoreTypeNames.Boolean),
  Number: mkTypeId(NativeType.Number, CoreTypeNames.Number),
  String: mkTypeId(NativeType.String, CoreTypeNames.String),
  Any: mkTypeId(NativeType.Any, CoreTypeNames.Any),
  Function: mkTypeId(NativeType.Function, CoreTypeNames.Function),
};
