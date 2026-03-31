import type {
  EnumTypeDef,
  FunctionTypeDef,
  ListTypeDef,
  MapTypeDef,
  NullableTypeDef,
  StructTypeDef,
  TypeDef,
  UnionTypeDef,
} from "@mindcraft-lang/core/brain";
import { getBrainServices, NativeType } from "@mindcraft-lang/core/brain";

const AMBIENT_HEADER = `
/** @deprecated Not available in Mindcraft */
interface CallableFunction {}
/** @deprecated Not available in Mindcraft */
interface Function {}
/** @deprecated Not available in Mindcraft */
interface IArguments {}
/** @deprecated Not available in Mindcraft */
interface NewableFunction {}
/** @deprecated Not available in Mindcraft */
interface Object {}
/** @deprecated Not available in Mindcraft */
interface RegExp {}

interface Boolean {}
interface Number {}
interface String {}
interface Array<T> {
  readonly length: number;
  [n: number]: T;
  push(...items: T[]): number;
  pop(): T | undefined;
  shift(): T | undefined;
  unshift(...items: T[]): number;
  splice(start: number, deleteCount?: number, ...items: T[]): T[];
  indexOf(searchElement: T, fromIndex?: number): number;
  lastIndexOf(searchElement: T, fromIndex?: number): number;
  includes(searchElement: T, fromIndex?: number): boolean;
  find(predicate: (value: T, index: number, array: T[]) => unknown): T | undefined;
  findIndex(predicate: (value: T, index: number, array: T[]) => unknown): number;
  some(predicate: (value: T, index: number, array: T[]) => unknown): boolean;
  every(predicate: (value: T, index: number, array: T[]) => unknown): boolean;
  forEach(callbackfn: (value: T, index: number, array: T[]) => void): void;
  map<U>(callbackfn: (value: T, index: number, array: T[]) => U): U[];
  filter(predicate: (value: T, index: number, array: T[]) => unknown): T[];
  reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T;
  reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U;
  reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T;
  reduceRight<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U;
  concat(...items: (T | T[])[]): T[];
  join(separator?: string): string;
  reverse(): T[];
  slice(start?: number, end?: number): T[];
  sort(compareFn?: (a: T, b: T) => number): T[];
}
type Record<K extends string | number | symbol, T> = { [P in K]: T; };
interface PromiseLike<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}
interface Promise<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<T | TResult>;
  finally(onfinally?: (() => void) | null): Promise<T>;
}
interface PromiseConstructor {
  new <T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void): Promise<T>;
  resolve(): Promise<void>;
  resolve<T>(value: T | PromiseLike<T>): Promise<T>;
  reject<T = never>(reason?: unknown): Promise<T>;
  all<T extends readonly unknown[]>(values: T): Promise<{ -readonly [P in keyof T]: T[P] extends PromiseLike<infer U> ? U : T[P] }>;
  race<T extends readonly unknown[]>(values: T): Promise<T[number] extends PromiseLike<infer U> ? U : T[number]>;
}
declare var Promise: PromiseConstructor;
`;

const AMBIENT_MODULE_START = `
declare module "mindcraft" {
  interface MindcraftTypeMap {
    boolean: boolean;
    number: number;
    string: string;
`;

const AMBIENT_MODULE_END = `
  type MindcraftType = keyof MindcraftTypeMap;

  export interface ParamDef {
    type: MindcraftType;
    default?: unknown;
    anonymous?: boolean;
  }

  export interface SensorConfig {
    name: string;
    output: MindcraftType;
    params?: Record<string, ParamDef>;
    onExecute(ctx: Context, params: Record<string, unknown>): unknown;
    onPageEntered?(ctx: Context): void;
  }

  export interface ActuatorConfig {
    name: string;
    params?: Record<string, ParamDef>;
    onExecute(ctx: Context, params: Record<string, unknown>): void | Promise<void>;
    onPageEntered?(ctx: Context): void;
  }

  export function Sensor(config: SensorConfig): unknown;
  export function Actuator(config: ActuatorConfig): unknown;
}
`;

function isStructTypeDef(def: TypeDef): def is StructTypeDef {
  return def.coreType === NativeType.Struct;
}

function isNativeBacked(def: StructTypeDef): boolean {
  return def.fieldGetter !== undefined || def.fieldSetter !== undefined || def.snapshotNative !== undefined;
}

function typeDefToTs(def: TypeDef): string {
  if (def.nullable) {
    const baseDef = getBrainServices().types.get((def as NullableTypeDef).baseTypeId);
    if (!baseDef) return "unknown";
    return `${typeDefToTs(baseDef)} | null`;
  }
  if (def.coreType === NativeType.Union) {
    const parts: string[] = [];
    (def as UnionTypeDef).memberTypeIds.forEach((mid) => {
      parts.push(typeIdToTs(mid));
    });
    return parts.join(" | ");
  }
  switch (def.coreType) {
    case NativeType.Void:
      return "void";
    case NativeType.Nil:
      return "null";
    case NativeType.Boolean:
      return "boolean";
    case NativeType.Number:
      return "number";
    case NativeType.String:
      return "string";
    case NativeType.Any:
      return "number | string | boolean | null";
    case NativeType.Struct:
    case NativeType.Enum:
      return def.name;
    case NativeType.List: {
      const elemTs = typeIdToTs((def as ListTypeDef).elementTypeId);
      return `Array<${elemTs}>`;
    }
    case NativeType.Map:
      return `Record<string, ${typeIdToTs((def as MapTypeDef).valueTypeId)}>`;
    case NativeType.Function: {
      const fnDef = def as FunctionTypeDef;
      if (fnDef.paramTypeIds) {
        const params: string[] = [];
        let i = 0;
        fnDef.paramTypeIds.forEach((pid) => {
          params.push(`arg${i}: ${typeIdToTs(pid)}`);
          i++;
        });
        return `(${params.join(", ")}) => ${typeIdToTs(fnDef.returnTypeId)}`;
      }
      return "Function";
    }
    default:
      return "unknown";
  }
}

function typeIdToTs(typeId: string): string {
  const def = getBrainServices().types.get(typeId);
  if (!def) return "unknown";
  return typeDefToTs(def);
}

function needsQuoting(name: string): boolean {
  return !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

function generateStructInterface(def: StructTypeDef): string {
  const nativeBacked = isNativeBacked(def);
  let result = `  export interface ${def.name} {\n`;
  if (nativeBacked) {
    result += "    readonly __brand: unique symbol;\n";
  }
  def.fields.forEach((field) => {
    const tsType = typeIdToTs(field.typeId);
    const fieldName = needsQuoting(field.name) ? `"${field.name}"` : field.name;
    if (nativeBacked) {
      result += `    readonly ${fieldName}: ${tsType};\n`;
    } else {
      result += `    ${fieldName}: ${tsType};\n`;
    }
  });
  def.methods?.forEach((method) => {
    const params: string[] = [];
    method.params.forEach((p) => {
      params.push(`${p.name}: ${typeIdToTs(p.typeId)}`);
    });
    const returnType = typeIdToTs(method.returnTypeId);
    const fullReturn = method.isAsync ? `Promise<${returnType}>` : returnType;
    result += `    ${method.name}(${params.join(", ")}): ${fullReturn};\n`;
  });
  result += "  }\n";
  return result;
}

const CORE_TYPE_NAMES = new Set(["boolean", "number", "string", "void", "nil", "unknown", "any"]);

function isEnumTypeDef(def: TypeDef): def is EnumTypeDef {
  return def.coreType === NativeType.Enum;
}

function generateEnumType(def: EnumTypeDef): string {
  const members: string[] = [];
  def.symbols.forEach((sym) => {
    members.push(`"${sym.key}"`);
  });
  return `  export type ${def.name} = ${members.join(" | ") || "never"};\n`;
}

export function buildAmbientDeclarations(): string {
  const registry = getBrainServices().types;
  let typeDeclarations = "";
  let typeMapEntries = "";

  for (const [, def] of registry.entries()) {
    if (CORE_TYPE_NAMES.has(def.name)) continue;
    if (def.autoInstantiated) continue;

    if (def.nullable) {
      const tsType = typeDefToTs(def);
      typeMapEntries += `    ${def.name}: ${tsType};\n`;
    } else if (isStructTypeDef(def)) {
      typeDeclarations += generateStructInterface(def);
      typeMapEntries += `    ${def.name}: ${def.name};\n`;
    } else if (isEnumTypeDef(def)) {
      typeDeclarations += generateEnumType(def);
      typeMapEntries += `    ${def.name}: ${def.name};\n`;
    } else if (
      def.coreType === NativeType.Boolean ||
      def.coreType === NativeType.Number ||
      def.coreType === NativeType.String
    ) {
      typeMapEntries += `    ${def.name}: ${typeDefToTs(def)};\n`;
    } else if (def.coreType === NativeType.List || def.coreType === NativeType.Map) {
      const tsType = typeDefToTs(def);
      typeDeclarations += `  export type ${def.name} = ${tsType};\n`;
      typeMapEntries += `    ${def.name}: ${def.name};\n`;
    }
  }

  return `${AMBIENT_HEADER}${AMBIENT_MODULE_START}${typeMapEntries}  }\n\n${typeDeclarations}${AMBIENT_MODULE_END}`;
}
