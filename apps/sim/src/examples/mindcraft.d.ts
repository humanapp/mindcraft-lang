/// <reference no-default-lib="true"/>

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

declare module "mindcraft" {
  interface MindcraftTypeMap {
    boolean: boolean;
    number: number;
    string: string;
    AnyList: AnyList;
    BrainContext: BrainContext;
    EngineContext: EngineContext;
    RuleContext: RuleContext;
    Context: Context;
    Vector2: Vector2;
    ActorRef: ActorRef;
    ActorRef?: ActorRef | null;
    Vector2?: Vector2 | null;
  }

  export type AnyList = Array<number | string | boolean | null>;
  export interface BrainContext {
    readonly __brand: unique symbol;
    getVariable(name: string): MindcraftValue | null;
    setVariable(name: string, value: MindcraftValue): void;
    getTargetActor(): ActorRef | null;
    getTargetPosition(): Vector2 | null;
  }
  export interface EngineContext {
    readonly __brand: unique symbol;
    getActorsByArchetype(archetype: string): Array<ActorRef>;
    getActorById(id: number): ActorRef;
  }
  export interface RuleContext {
    readonly __brand: unique symbol;
    getVariable(name: string): MindcraftValue | null;
    setVariable(name: string, value: MindcraftValue): void;
  }
  export interface Context {
    readonly __brand: unique symbol;
    readonly time: number;
    readonly dt: number;
    readonly tick: number;
    readonly brain: BrainContext;
    readonly engine: EngineContext;
    readonly rule: RuleContext;
    readonly self: ActorRef;
  }
  export interface Vector2 {
    x: number;
    y: number;
    add(other: Vector2): Vector2;
    sub(other: Vector2): Vector2;
    mul(scalar: number): Vector2;
    div(scalar: number): Vector2;
    dot(other: Vector2): number;
    cross(other: Vector2): number;
    magnitude(): number;
    normalize(): Vector2;
    distance(other: Vector2): number;
    lerp(goal: Vector2, alpha: number): Vector2;
    angle(other: Vector2): number;
    rotate(angle: number): Vector2;
  }
  export interface ActorRef {
    readonly __brand: unique symbol;
    readonly id: number;
    position: Vector2;
    rotation: number;
    readonly "energy pct": number;
    readonly forward: Vector2;
  }

  type MindcraftValue = MindcraftTypeMap[keyof MindcraftTypeMap];
  type MindcraftType = keyof MindcraftTypeMap | (string & {});

  interface ModifierSpec { readonly __brand: "modifier" }
  interface ParamSpec { readonly __brand: "param" }
  interface ChoiceSpec { readonly __brand: "choice" }
  interface OptionalSpec { readonly __brand: "optional" }
  interface RepeatedSpec { readonly __brand: "repeated" }
  interface ConditionalSpec { readonly __brand: "conditional" }
  interface SeqSpec { readonly __brand: "seq" }
  type ArgSpec = ModifierSpec | ParamSpec | ChoiceSpec | OptionalSpec | RepeatedSpec | ConditionalSpec | SeqSpec;

  export function modifier(id: string, opts?: { label: string; icon?: string }): ModifierSpec;
  export function param(name: string, opts: { type: MindcraftType; default?: unknown; anonymous?: boolean }): ParamSpec;
  export function choice(name: string, ...items: ArgSpec[]): ChoiceSpec;
  export function choice(...items: ArgSpec[]): ChoiceSpec;
  export function optional(item: ArgSpec): OptionalSpec;
  export function repeated(item: ModifierSpec, opts?: { min?: number; max?: number }): RepeatedSpec;
  export function conditional(condition: string, thenItem: ArgSpec, elseItem?: ArgSpec): ConditionalSpec;
  export function seq(...items: ArgSpec[]): SeqSpec;

  export interface SensorConfig {
    name: string;
    label?: string;
    icon?: string;
    docs?: string;
    tags?: string[];
    args?: ArgSpec[];
    onExecute(ctx: Context, args: Record<string, unknown>): unknown;
    onPageEntered?(ctx: Context): void;
  }

  export interface ActuatorConfig {
    name: string;
    label?: string;
    icon?: string;
    docs?: string;
    tags?: string[];
    args?: ArgSpec[];
    onExecute(ctx: Context, args: Record<string, unknown>): void | Promise<void>;
    onPageEntered?(ctx: Context): void;
  }

  export function Sensor(config: SensorConfig): unknown;
  export function Actuator(config: ActuatorConfig): unknown;
}
