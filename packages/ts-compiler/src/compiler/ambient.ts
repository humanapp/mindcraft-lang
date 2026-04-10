import type {
  EnumTypeDef,
  FunctionTypeDef,
  ITypeRegistry,
  ListTypeDef,
  MapTypeDef,
  NullableTypeDef,
  StructTypeDef,
  TypeDef,
  UnionTypeDef,
} from "@mindcraft-lang/core/brain";
import { NativeType } from "@mindcraft-lang/core/brain";

const AMBIENT_HEADER = `/// <reference no-default-lib="true"/>

declare var NaN: number;
declare var Infinity: number;

declare function parseInt(string: string, radix?: number): number;
declare function parseFloat(string: string): number;
declare function isNaN(number: number): boolean;
declare function isFinite(number: number): boolean;

/** @deprecated Not supported in Mindcraft Runtime */
interface Object {}
/** @deprecated Not supported in Mindcraft Runtime */
interface Function {}
/** @deprecated Not supported in Mindcraft Runtime */
interface CallableFunction {}
/** @deprecated Not supported in Mindcraft Runtime */
interface NewableFunction {}
/** @deprecated Not supported in Mindcraft Runtime */
interface IArguments {}
/** @deprecated Not supported in Mindcraft Runtime */
interface RegExp {}

interface SymbolConstructor {
  readonly iterator: unique symbol;
}
declare var Symbol: SymbolConstructor;

interface IteratorYieldResult<TYield> {
  done?: false;
  value: TYield;
}

interface IteratorReturnResult<TReturn> {
  done: true;
  value: TReturn;
}

type IteratorResult<T, TReturn = any> = IteratorYieldResult<T> | IteratorReturnResult<TReturn>;

interface Iterator<T, TReturn = any, TNext = any> {
  next(...[value]: [] | [TNext]): IteratorResult<T, TReturn>;
  return?(value?: TReturn): IteratorResult<T, TReturn>;
  throw?(e?: any): IteratorResult<T, TReturn>;
}

interface Iterable<T, TReturn = any, TNext = any> {
  [Symbol.iterator](): Iterator<T, TReturn, TNext>;
}

interface IterableIterator<T, TReturn = any, TNext = any> extends Iterator<T, TReturn, TNext> {
  [Symbol.iterator](): IterableIterator<T, TReturn, TNext>;
}

declare type PromiseConstructorLike = new <T>(
  executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void
) => PromiseLike<T>;

interface Math {
  readonly E: number;
  readonly LN10: number;
  readonly LN2: number;
  readonly LOG2E: number;
  readonly LOG10E: number;
  readonly PI: number;
  readonly SQRT1_2: number;
  readonly SQRT2: number;
  abs(x: number): number;
  acos(x: number): number;
  asin(x: number): number;
  atan(x: number): number;
  atan2(y: number, x: number): number;
  ceil(x: number): number;
  cos(x: number): number;
  exp(x: number): number;
  floor(x: number): number;
  log(x: number): number;
  max(...values: number[]): number;
  min(...values: number[]): number;
  pow(x: number, y: number): number;
  random(): number;
  round(x: number): number;
  sin(x: number): number;
  sqrt(x: number): number;
  tan(x: number): number;
}
declare var Math: Math;

interface String {
  toString(): string;
  charAt(pos: number): string;
  charCodeAt(index: number): number;
  concat(...strings: string[]): string;
  indexOf(searchString: string, position?: number): number;
  lastIndexOf(searchString: string, position?: number): number;
  slice(start?: number, end?: number): string;
  substring(start: number, end?: number): string;
  toLowerCase(): string;
  toUpperCase(): string;
  trim(): string;
  split(separator: string, limit?: number): string[];
  valueOf(): string;
  readonly length: number;
  [Symbol.iterator](): IterableIterator<string>;
  readonly [index: number]: string;
}

interface StringConstructor {
  (value?: any): string;
  readonly prototype: String;
  fromCharCode(...codes: number[]): string;
}
declare var String: StringConstructor;

interface Boolean {
  valueOf(): boolean;
}

interface BooleanConstructor {
  <T>(value?: T): boolean;
  readonly prototype: Boolean;
}
declare var Boolean: BooleanConstructor;

interface Number {
  toString(radix?: number): string;
  toFixed(fractionDigits?: number): string;
  valueOf(): number;
}

interface NumberConstructor {
  (value?: any): number;
  readonly prototype: Number;
  readonly MAX_VALUE: number;
  readonly MIN_VALUE: number;
  readonly NaN: number;
  readonly NEGATIVE_INFINITY: number;
  readonly POSITIVE_INFINITY: number;
}
declare var Number: NumberConstructor;

interface TemplateStringsArray extends ReadonlyArray<string> {
  readonly raw: readonly string[];
}

interface ArrayLike<T> {
  readonly length: number;
  readonly [n: number]: T;
}

interface ConcatArray<T> {
  readonly length: number;
  readonly [n: number]: T;
  join(separator?: string): string;
  slice(start?: number, end?: number): T[];
}

interface ReadonlyArray<T> {
  readonly length: number;
  toString(): string;
  concat(...items: ConcatArray<T>[]): T[];
  concat(...items: (T | ConcatArray<T>)[]): T[];
  join(separator?: string): string;
  slice(start?: number, end?: number): T[];
  indexOf(searchElement: T, fromIndex?: number): number;
  lastIndexOf(searchElement: T, fromIndex?: number): number;
  every<S extends T>(
    predicate: (value: T, index: number, array: readonly T[]) => value is S,
    thisArg?: any
  ): this is readonly S[];
  every(predicate: (value: T, index: number, array: readonly T[]) => unknown, thisArg?: any): boolean;
  some(predicate: (value: T, index: number, array: readonly T[]) => unknown, thisArg?: any): boolean;
  forEach(callbackfn: (value: T, index: number, array: readonly T[]) => void, thisArg?: any): void;
  map<U>(callbackfn: (value: T, index: number, array: readonly T[]) => U, thisArg?: any): U[];
  filter<S extends T>(predicate: (value: T, index: number, array: readonly T[]) => value is S, thisArg?: any): S[];
  filter(predicate: (value: T, index: number, array: readonly T[]) => unknown, thisArg?: any): T[];
  reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: readonly T[]) => T): T;
  reduce(
    callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: readonly T[]) => T,
    initialValue: T
  ): T;
  reduce<U>(
    callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: readonly T[]) => U,
    initialValue: U
  ): U;
  find(predicate: (value: T, index: number, obj: readonly T[]) => unknown, thisArg?: any): T | undefined;
  findIndex(predicate: (value: T, index: number, obj: readonly T[]) => unknown, thisArg?: any): number;
  includes(searchElement: T, fromIndex?: number): boolean;
  [Symbol.iterator](): IterableIterator<T>;
  readonly [n: number]: T;
}

interface Array<T> {
  length: number;
  toString(): string;
  push(...items: T[]): number;
  pop(): T | undefined;
  shift(): T | undefined;
  unshift(...items: T[]): number;
  concat(...items: ConcatArray<T>[]): T[];
  concat(...items: (T | ConcatArray<T>)[]): T[];
  join(separator?: string): string;
  reverse(): T[];
  slice(start?: number, end?: number): T[];
  sort(compareFn?: (a: T, b: T) => number): this;
  splice(start: number, deleteCount?: number): T[];
  splice(start: number, deleteCount: number, ...items: T[]): T[];
  indexOf(searchElement: T, fromIndex?: number): number;
  lastIndexOf(searchElement: T, fromIndex?: number): number;
  every<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): this is S[];
  every(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): boolean;
  some(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): boolean;
  forEach(callbackfn: (value: T, index: number, array: T[]) => void, thisArg?: any): void;
  map<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[];
  filter<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): S[];
  filter(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): T[];
  reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T;
  reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T;
  reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U;
  find(predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: any): T | undefined;
  findIndex(predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: any): number;
  includes(searchElement: T, fromIndex?: number): boolean;
  [Symbol.iterator](): IterableIterator<T>;
  [n: number]: T;
}

interface ArrayConstructor {
  from<T>(arrayLike: ArrayLike<T>): T[];
  from<T, U>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => U): U[];
  isArray(arg: any): arg is any[];
  readonly prototype: any[];
}
declare var Array: ArrayConstructor;

interface Map<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): this;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  keys(): K[];
  values(): V[];
  forEach(callbackfn: (value: V, key: K) => void): void;
  readonly size: number;
}

interface MapConstructor {
  new <K, V>(): Map<K, V>;
  new <K, V>(entries: readonly (readonly [K, V])[]): Map<K, V>;
}
declare var Map: MapConstructor;

interface PromiseLike<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): PromiseLike<TResult1 | TResult2>;
}

interface Promise<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | undefined | null
  ): Promise<TResult>;
}

declare var Promise: {
  new <T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void): Promise<T>;
};

type Partial<T> = { [P in keyof T]?: T[P] };
type Required<T> = { [P in keyof T]-?: T[P] };
type Readonly<T> = { readonly [P in keyof T]: T[P] };
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
type Record<K extends keyof any, T> = { [P in K]: T };
type Exclude<T, U> = T extends U ? never : T;
type Extract<T, U> = T extends U ? T : never;
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
type NonNullable<T> = T & {};
type Parameters<T extends (...args: any) => any> = T extends (...args: infer P) => any ? P : never;
type ConstructorParameters<T extends abstract new (...args: any) => any> = T extends abstract new (
  ...args: infer P
) => any
  ? P
  : never;
type ReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any;
type InstanceType<T extends abstract new (...args: any) => any> = T extends abstract new (
  ...args: any
) => infer R
  ? R
  : any;
type Awaited<T> = T extends null | undefined
  ? T
  : T extends object & { then(onfulfilled: infer F, ...args: infer _): any }
    ? F extends (value: infer V, ...args: infer _) => any
      ? Awaited<V>
      : never
    : T;
type Uppercase<S extends string> = intrinsic;
type Lowercase<S extends string> = intrinsic;
type Capitalize<S extends string> = intrinsic;
type Uncapitalize<S extends string> = intrinsic;
type NoInfer<T> = intrinsic;
`;

const AMBIENT_MODULE_START = `
declare module "mindcraft" {
  interface MindcraftTypeMap {
    boolean: boolean;
    number: number;
    string: string;
`;

const AMBIENT_MODULE_END = `
  type MindcraftType = keyof MindcraftTypeMap | (string & {});

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

function typeDefToTs(def: TypeDef, registry: ITypeRegistry): string {
  if (def.nullable) {
    const baseDef = registry.get((def as NullableTypeDef).baseTypeId);
    if (!baseDef) return "unknown";
    return `${typeDefToTs(baseDef, registry)} | null`;
  }
  if (def.coreType === NativeType.Union) {
    const parts: string[] = [];
    (def as UnionTypeDef).memberTypeIds.forEach((mid) => {
      parts.push(typeIdToTs(mid, registry));
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
      const elemTs = typeIdToTs((def as ListTypeDef).elementTypeId, registry);
      return `Array<${elemTs}>`;
    }
    case NativeType.Map: {
      const mapDef = def as MapTypeDef;
      const keyTs = typeIdToTs(mapDef.keyTypeId, registry);
      const valTs = typeIdToTs(mapDef.valueTypeId, registry);
      return `Map<${keyTs}, ${valTs}>`;
    }
    case NativeType.Function: {
      const fnDef = def as FunctionTypeDef;
      if (fnDef.paramTypeIds) {
        const params: string[] = [];
        let i = 0;
        fnDef.paramTypeIds.forEach((pid) => {
          params.push(`arg${i}: ${typeIdToTs(pid, registry)}`);
          i++;
        });
        return `(${params.join(", ")}) => ${typeIdToTs(fnDef.returnTypeId, registry)}`;
      }
      return "Function";
    }
    default:
      return "unknown";
  }
}

function typeIdToTs(typeId: string, registry: ITypeRegistry): string {
  const def = registry.get(typeId);
  if (!def) return "unknown";
  return typeDefToTs(def, registry);
}

function needsQuoting(name: string): boolean {
  return !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

function generateStructInterface(def: StructTypeDef, registry: ITypeRegistry): string {
  const nativeBacked = isNativeBacked(def);
  let result = `  export interface ${def.name} {\n`;
  if (nativeBacked) {
    result += "    readonly __brand: unique symbol;\n";
  }
  def.fields.forEach((field) => {
    const tsType = typeIdToTs(field.typeId, registry);
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
      params.push(`${p.name}: ${typeIdToTs(p.typeId, registry)}`);
    });
    const returnType = typeIdToTs(method.returnTypeId, registry);
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

function buildAmbientDeclarationsFromRegistry(registry: ITypeRegistry): string {
  let typeDeclarations = "";
  let typeMapEntries = "";

  for (const [, def] of registry.entries()) {
    if (CORE_TYPE_NAMES.has(def.name)) continue;
    if (def.autoInstantiated) continue;
    if (def.name.includes("::")) continue;

    if (def.nullable) {
      const tsType = typeDefToTs(def, registry);
      typeMapEntries += `    ${def.name}: ${tsType};\n`;
    } else if (isStructTypeDef(def)) {
      typeDeclarations += generateStructInterface(def, registry);
      typeMapEntries += `    ${def.name}: ${def.name};\n`;
    } else if (isEnumTypeDef(def)) {
      typeDeclarations += generateEnumType(def);
      typeMapEntries += `    ${def.name}: ${def.name};\n`;
    } else if (
      def.coreType === NativeType.Boolean ||
      def.coreType === NativeType.Number ||
      def.coreType === NativeType.String
    ) {
      typeMapEntries += `    ${def.name}: ${typeDefToTs(def, registry)};\n`;
    } else if (def.coreType === NativeType.List) {
      const tsType = typeDefToTs(def, registry);
      typeDeclarations += `  export type ${def.name} = ${tsType};\n`;
      typeMapEntries += `    ${def.name}: ${def.name};\n`;
    }
  }

  return `${AMBIENT_HEADER}${AMBIENT_MODULE_START}${typeMapEntries}  }\n\n${typeDeclarations}${AMBIENT_MODULE_END}`;
}

export function buildAmbientDeclarations(types: ITypeRegistry): string {
  return buildAmbientDeclarationsFromRegistry(types);
}
