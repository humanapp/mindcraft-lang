import type { ReadonlyList } from "../platform/list";
import { StringUtils as SU } from "../platform/string";
import type { NamespacedTypeName } from "./tile-ids";
import { NativeType, nativeTypeToString, type TypeId } from "./type-defs";

/** Build a {@link TypeId} from a `NativeType` and a (unique) type name. */
export function mkTypeId(coreType: NativeType, typeName: string): TypeId {
  return `${nativeTypeToString(coreType)}:<${typeName}>`;
}

/** Name of a nullable wrapper around the type named `baseName`. */
export function mkNullableTypeName(baseName: string): string {
  return `${baseName}?`;
}

/** Name of a constructed type: the constructor name applied to argument type ids. */
export function mkConstructedTypeName(constructorName: string, argTypeIds: ReadonlyList<TypeId>): string {
  const parts: string[] = [];
  argTypeIds.forEach((id) => {
    parts.push(id);
  });
  return `${constructorName}<${parts.join(",")}>`;
}

/** Name of a union type over already-sorted member type ids. */
export function mkUnionTypeName(sortedMemberTypeIds: ReadonlyList<TypeId>): string {
  const parts: string[] = [];
  sortedMemberTypeIds.forEach((id) => {
    parts.push(id);
  });
  return parts.join(",");
}

/** Canonical name of a function type from its parameter and return type ids. */
export function mkFunctionTypeName(paramTypeIds: ReadonlyList<TypeId>, returnTypeId: TypeId): string {
  const parts: string[] = [];
  paramTypeIds.forEach((id) => {
    parts.push(id);
  });
  return `Function<(${parts.join(",")})=>${returnTypeId}>`;
}

/**
 * Compose a user type name from its owning namespace and local name. The
 * local name starts with `/`, so the result is `<namespace>:/...`.
 */
export function mkNamespacedTypeName(namespace: string, localName: string): string {
  return `${namespace}:${localName}`;
}

// Characters that appear only in derived structural type names (unions,
// instantiations, anonymous structs, nullables), never in a binding-keyed
// namespaced name.
const kStructuralNameChars = ["<", ">", "{", "}", ",", "&", "|", "(", ")", "?", " ", "\t", "\n"];

/**
 * Split a binding-keyed user type name (`<namespace>:/file::binding`) into
 * its namespace and local name. Returns undefined for platform names and
 * derived structural names. A namespace never contains `:/`, so the split
 * point is the first `:/` in the name.
 */
export function splitNamespacedTypeName(name: string): NamespacedTypeName | undefined {
  for (const ch of kStructuralNameChars) {
    if (SU.indexOf(name, ch) >= 0) return undefined;
  }
  const fileStart = SU.indexOf(name, ":/");
  if (fileStart < 0) return undefined;
  return {
    namespace: SU.substring(name, 0, fileStart),
    localName: SU.substring(name, fileStart + 1),
  };
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
  Buffer: "buffer",
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
  Buffer: mkTypeId(NativeType.Buffer, CoreTypeNames.Buffer),
};
