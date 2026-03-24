# lib.d.ts Evaluation for Mindcraft TypeScript Compiler

The `packages/typescript` project currently bundles three TypeScript lib files into
`lib-dts.generated.ts` for injection into the authoring environment:

- `lib.es5.d.ts` (4585 lines)
- `lib.decorators.d.ts` (384 lines)
- `lib.decorators.legacy.d.ts` (22 lines)

Since the TypeScript-to-mindcraft-bytecode pipeline requires every runtime-visible declaration
to be backed by a VM implementation, this document categorizes all functionality in these files.

## Recommendation: Curated Declarations File

Rather than importing TypeScript's full `lib.es5.d.ts` and stripping out the unwanted parts,
the recommended approach is to **author a curated declarations file** containing only the
subset mindcraft actually supports. Rationale:

- **No stripping step** -- the build pipeline stays simple (no filter script to maintain).
- **No false affordances** -- users never see `eval`, `Symbol`, `ArrayBuffer`,
  `Object.defineProperty`, etc. in autocomplete.
- **Simpler overloads** -- TypeScript's lib files have complex overloads for edge cases that
  don't apply (e.g., multiple `freeze` overloads, `CallableFunction` vs `NewableFunction`).
- **Controlled updates** -- new TypeScript versions won't silently introduce unsupported
  declarations.
- **Tailored to the VM** -- declarations can match mindcraft's actual semantics (e.g.,
  `Array<T>` methods reflecting what the compiler actually inlines).

The actual needed surface area is roughly 200-400 lines of hand-written declarations vs.
5000+ lines of imported lib files. The existing `bundle-lib-dts.js` script and generated
file can be replaced by a single handwritten `.d.ts` file checked into the repo.

The rest of this document catalogs what to include and what to omit.

---

## Category 1: Omit

Remove from the mindcraft lib.d.ts entirely -- either for security, irrelevance to the
sandboxed VM, or because they expose concepts the runtime will never support.

### Security -- Must Omit

| Declaration                                  | Reason                   |
| -------------------------------------------- | ------------------------ |
| `eval()`                                     | Arbitrary code execution |
| `Function` constructor (`new Function(...)`) | Equivalent to `eval`     |

### Web/Browser/Node -- Irrelevant to Sandboxed VM

| Declaration                                                               | Reason                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `decodeURI()` / `decodeURIComponent()`                                    | No network/URL concept in mindcraft                                |
| `encodeURI()` / `encodeURIComponent()`                                    | Same                                                               |
| `escape()` / `unescape()`                                                 | Deprecated legacy, no use case                                     |
| `Intl` namespace (Collator, NumberFormat, DateTimeFormat)                 | i18n APIs -- heavy, no use case in a game VM                       |
| `ImportMeta`, `ImportCallOptions`, `ImportAssertions`, `ImportAttributes` | Module system concepts; compiler doesn't support `import`/`export` |

### JS Object Model -- Not Applicable

| Declaration                                                              | Reason                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Object` interface + `ObjectConstructor`                                 | Mindcraft uses structs, not prototype-based objects. All methods (`hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `getPrototypeOf`, `getOwnPropertyDescriptor`, `getOwnPropertyNames`, `create`, `defineProperty`, `defineProperties`, `seal`, `freeze`, `preventExtensions`, `isSealed`, `isFrozen`, `isExtensible`, `keys`) are inapplicable |
| `Function` interface (`.apply`, `.call`, `.bind`, `arguments`, `caller`) | Mindcraft closures have no `this` binding, `arguments`, or reflective `.apply/.call/.bind`                                                                                                                                                                                                                                                                |
| `CallableFunction`, `NewableFunction`                                    | Typed overloads of `.apply/.call/.bind`                                                                                                                                                                                                                                                                                                                   |
| `IArguments`                                                             | The `arguments` object doesn't exist                                                                                                                                                                                                                                                                                                                      |
| `PropertyDescriptor`, `PropertyDescriptorMap`, `TypedPropertyDescriptor` | JS engine concept with no equivalent                                                                                                                                                                                                                                                                                                                      |
| `PropertyKey` type alias (`string \| number \| symbol`)                  | Depends on `symbol` which doesn't exist                                                                                                                                                                                                                                                                                                                   |
| `Symbol` interface                                                       | JS engine concept with no equivalent                                                                                                                                                                                                                                                                                                                      |
| `ThisParameterType`, `OmitThisParameter`                                 | `this` typing unsupported                                                                                                                                                                                                                                                                                                                                 |
| `ThisType<T>`                                                            | Same                                                                                                                                                                                                                                                                                                                                                      |
| `WeakKeyTypes`, `WeakKey`                                                | Weak references don't exist                                                                                                                                                                                                                                                                                                                               |

### Binary Data -- No Use Case

| Declaration                                                                                                                                                 | Reason                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `ArrayBuffer`, `ArrayBufferConstructor`, `ArrayBufferTypes`, `ArrayBufferLike`, `ArrayBufferView`                                                           | Binary buffer manipulation has no use in a game logic VM |
| `DataView`, `DataViewConstructor`                                                                                                                           | Same                                                     |
| `Int8Array`, `Uint8Array`, `Uint8ClampedArray`, `Int16Array`, `Uint16Array`, `Int32Array`, `Uint32Array`, `Float32Array`, `Float64Array` + all constructors | Typed arrays for binary data -- omit entirely            |

### Decorators

| Declaration                                                                                                          | Reason                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| All of `lib.decorators.d.ts` (TC39 decorator context types)                                                          | Evaluate once class support lands. Mindcraft already has its own `@Sensor`/`@Actuator` decorators in the ambient "mindcraft" module; determine whether the standard decorator context types are also needed or whether mindcraft-specific decorator types are sufficient |
| All of `lib.decorators.legacy.d.ts` (`ClassDecorator`, `PropertyDecorator`, `MethodDecorator`, `ParameterDecorator`) | Legacy decorator types -- evaluate alongside class support. May be needed if the compiler targets the legacy decorator emit                                                                                                                                              |

### Error Subtypes -- Excessive for V1

| Declaration                                    | Reason                                              |
| ---------------------------------------------- | --------------------------------------------------- |
| `EvalError` / `EvalErrorConstructor`           | `eval` is omitted, so `EvalError` is meaningless    |
| `RangeError` / `RangeErrorConstructor`         | One `Error` type is sufficient for V1               |
| `ReferenceError` / `ReferenceErrorConstructor` | Same                                                |
| `SyntaxError` / `SyntaxErrorConstructor`       | Same                                                |
| `TypeError` / `TypeErrorConstructor`           | Same                                                |
| `URIError` / `URIErrorConstructor`             | URI functions omitted, so `URIError` is meaningless |

---

## Category 2: Must Be Backed by Mindcraft Runtime

These are things users of a TypeScript-like language would reasonably expect to work.

### Already Implemented (No New Work)

| Declaration                                                                                               | Status                                                                                 |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `NaN`, `Infinity`                                                                                         | Number constants -- can be emitted via `PUSH_CONST`                                    |
| `Boolean` interface + constructor                                                                         | Primitive type already supported                                                       |
| `Number` interface (partial)                                                                              | Primitive type exists; `toString()` via existing Number->String conversion             |
| `NumberConstructor` constants (`MAX_VALUE`, `MIN_VALUE`, `NaN`, `NEGATIVE_INFINITY`, `POSITIVE_INFINITY`) | Static numeric constants -- trivial `PUSH_CONST`                                       |
| `Array<T>` interface (partial)                                                                            | `length`, `push`, `indexOf`, `filter`, `map`, `forEach` already compiler-inlined       |
| `ReadonlyArray<T>`                                                                                        | Type-only aspects work for type checking; methods share implementation with `Array<T>` |
| `PromiseLike<T>`, `Promise<T>`                                                                            | Already declared in the "mindcraft" ambient module; async/await supported              |
| `TemplateStringsArray`                                                                                    | Template literals already compile to string concatenation                              |

### Needs Implementation

#### Low Difficulty

**Global functions:**

| Declaration                | Notes                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `parseInt(string, radix?)` | Host function wrapping number parsing. String->Number conversion exists but lacks radix support |
| `parseFloat(string)`       | Host function. String->Number conversion already exists                                         |
| `isNaN(number)`            | Host function: `value !== value` check                                                          |
| `isFinite(number)`         | Host function                                                                                   |

**Math object (~20 host functions, all one-liners delegating to platform math):**

| Method/Property                                                            | Notes                                           |
| -------------------------------------------------------------------------- | ----------------------------------------------- |
| Constants: `E`, `LN10`, `LN2`, `LOG2E`, `LOG10E`, `PI`, `SQRT1_2`, `SQRT2` | Trivial numeric constants                       |
| `abs`, `ceil`, `floor`, `round`                                            | Pure numeric, one-liner each                    |
| `min`, `max`                                                               | Variadic numeric, simple                        |
| `pow`, `sqrt`, `exp`, `log`                                                | One-liner each                                  |
| `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`                       | Trig -- one-liner each                          |
| `random()`                                                                 | `random` sensor already exists; just wire it up |

**String methods:**

| Method                          | Notes                                                     |
| ------------------------------- | --------------------------------------------------------- |
| `length` (property)             | Verify it works via `GET_FIELD` on string values          |
| `charAt(pos)`                   | Simple host function                                      |
| `charCodeAt(index)`             | Simple host function                                      |
| `indexOf(search, pos?)`         | Simple host function wrapping platform string search      |
| `lastIndexOf(search, pos?)`     | Same pattern                                              |
| `slice(start?, end?)`           | Host function wrapping platform substring                 |
| `substring(start, end?)`        | Same as `slice` with slightly different edge cases        |
| `toLowerCase()`                 | Trivial host function                                     |
| `toUpperCase()`                 | Trivial host function                                     |
| `trim()`                        | Trivial host function                                     |
| `concat(...strings)`            | `+` already works for strings; variadic version is simple |
| `toString()`                    | Identity on string                                        |
| `valueOf()`                     | Identity                                                  |
| `String.fromCharCode(...codes)` | Host function: numbers -> string                          |

**Array methods (can be compiler-inlined like existing `map`/`filter`/`forEach`):**

| Method                       | Notes                                           |
| ---------------------------- | ----------------------------------------------- |
| `pop()`                      | Remove last element                             |
| `shift()`                    | Remove first element                            |
| `unshift(...items)`          | Prepend elements                                |
| `reverse()`                  | In-place list reversal                          |
| `indexOf(search, from?)`     | Already implemented                             |
| `lastIndexOf(search, from?)` | Reverse search variant                          |
| `some(predicate)`            | Like filter but returns boolean; can be inlined |
| `every(predicate)`           | Same pattern                                    |
| `toString()`                 | Equivalent to `.join(",")`                      |
| `Array.isArray(arg)`         | Compiler intrinsic: check if value is ListValue |

**Number formatting:**

| Method             | Notes                                                    |
| ------------------ | -------------------------------------------------------- |
| `toString(radix?)` | Number->String conversion exists but needs radix support |
| `toFixed(digits?)` | Host function wrapping platform toFixed                  |
| `valueOf()`        | Identity                                                 |

#### Medium Difficulty

**String methods (more complex):**

| Method                     | Notes                                                                     |
| -------------------------- | ------------------------------------------------------------------------- |
| `split(separator, limit?)` | Returns `Array<string>`. Needs host function that creates a `ListValue`   |
| `replace(search, replace)` | String-only overload is straightforward. Regex overload depends on RegExp |
| `match(regexp)`            | Depends on RegExp implementation                                          |
| `search(regexp)`           | Depends on RegExp                                                         |

**Array methods (more complex):**

| Method                                  | Notes                                                       |
| --------------------------------------- | ----------------------------------------------------------- |
| `sort(compareFn?)`                      | Needs to call user-provided comparator function during sort |
| `splice(start, deleteCount?, ...items)` | In-place modification with insertion                        |
| `concat(...items)`                      | Create new list from merging lists                          |
| `join(separator?)`                      | Convert list elements to strings and join                   |
| `slice(start?, end?)`                   | Create sub-list                                             |
| `reduce(callback, initial?)`            | Accumulator loop calling indirect                           |
| `reduceRight(callback, initial?)`       | Same in reverse                                             |

**Error:**

| Declaration                            | Notes                                                                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Error` interface + `ErrorConstructor` | VM already has TRY/THROW/FAULT. Needs formalized Error value type with `name`, `message`, `stack?`. Gated on compiler support for `try/catch/throw` |

**JSON:**

| Declaration        | Notes                                                                     |
| ------------------ | ------------------------------------------------------------------------- |
| `JSON.parse()`     | Map between mindcraft value types and JSON strings. `parse` returns `any` |
| `JSON.stringify()` | Takes a value and returns string                                          |

**RegExp (medium-to-hard):**

| Declaration                      | Notes                                                                                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RegExp` interface + constructor | Pattern matching. Platform has regex support but needs VM integration, result types (`RegExpMatchArray`, `RegExpExecArray`), and cross-platform consistency |

**Date (medium-high, lots of surface area):**

| Declaration                          | Notes                                                                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Date` interface + `DateConstructor` | Full Date with getters/setters for year, month, day, hours, etc. VM already has `time` concept on ExecutionContext. Could offer a minimal subset (`Date.now()` only) for V1 |

#### Hard

| Declaration              | Notes                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PromiseConstructorLike` | User-land Promise construction (`new Promise((resolve, reject) => ...)`). VM has async handles but they're host-driven, not user-constructable. Fundamentally changes the async model |

### Type-Only (No Runtime Cost)

Pure compile-time constructs needing no runtime backing:

| Declaration                                                                     | Notes                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `Partial<T>`, `Required<T>`, `Readonly<T>`                                      | Mapped types                                            |
| `Pick<T, K>`, `Record<K, T>`, `Omit<T, K>`                                      | Mapped types                                            |
| `Exclude<T, U>`, `Extract<T, U>`                                                | Conditional types                                       |
| `NonNullable<T>`                                                                | Type narrowing                                          |
| `Parameters<T>`, `ConstructorParameters<T>`, `ReturnType<T>`, `InstanceType<T>` | Introspection utility types                             |
| `Uppercase<S>`, `Lowercase<S>`, `Capitalize<S>`, `Uncapitalize<S>`              | Intrinsic string manipulation types (compile-time only) |
| `NoInfer<T>`                                                                    | Inference control                                       |
| `Awaited<T>`                                                                    | Promise unwrapping type                                 |
| `ArrayLike<T>`                                                                  | Structural type                                         |
| `ConcatArray<T>`                                                                | For concat overloads                                    |

---

## Recommended V1 Strategy

Author a curated `mindcraft-lib.d.ts` (or equivalent) checked into the repo, containing only
the declarations listed below. Replace the current `bundle-lib-dts.js` pipeline.

### Include in the curated file

1. **Global constants** -- `NaN`, `Infinity`.
2. **Global functions** -- `parseInt`, `parseFloat`, `isNaN`, `isFinite`.
3. **Math object** -- low difficulty, high value. ~20 host functions + 8 constants.
4. **String interface** -- `length`, `charAt`, `charCodeAt`, `indexOf`, `lastIndexOf`,
   `slice`, `substring`, `toLowerCase`, `toUpperCase`, `trim`, `split`, `concat`,
   `toString`, `valueOf`, index access. `String.fromCharCode`. ~12 host functions.
5. **Number interface** -- `toString(radix?)`, `toFixed(digits?)`, `valueOf()`.
   `NumberConstructor` constants (`MAX_VALUE`, `MIN_VALUE`, `NaN`, etc.).
6. **Boolean interface** -- `valueOf()`.
7. **Array<T> interface** -- `length`, `push`, `pop`, `shift`, `unshift`, `reverse`,
   `sort`, `indexOf`, `lastIndexOf`, `slice`, `concat`, `join`, `splice`,
   `forEach`, `map`, `filter`, `some`, `every`, `reduce`, `reduceRight`,
   `toString`, index access. `Array.isArray`. `ReadonlyArray<T>` for type-checking.
8. **Promise<T> / PromiseLike<T>** -- already in the ambient "mindcraft" module.
9. **Utility types** -- `Partial`, `Required`, `Readonly`, `Pick`, `Record`, `Omit`,
   `Exclude`, `Extract`, `NonNullable`, `Parameters`, `ReturnType`, `Awaited`,
   `ConstructorParameters`, `InstanceType`, `NoInfer`.
10. **Intrinsic string types** -- `Uppercase`, `Lowercase`, `Capitalize`, `Uncapitalize`.

### Do not include (omit from curated file)

Everything in Category 1 above. Nothing from `lib.es5.d.ts` should be imported wholesale;
only the specific declarations above are written into the curated file.

### Include for V1 if feasible (nice-to-have)

- `Error` type + constructor (medium; gated on compiler supporting `try/catch/throw`)
- `JSON.parse` / `JSON.stringify` (medium; useful for data persistence)
- `Date.now()` minimal subset (medium)

### Defer past V1

- Full `Date` object with all getters/setters
- `RegExp` + regex-dependent string methods (`match`, `replace` with regex, `search`)
- User-constructable Promises
- Locale-aware functionality (`localeCompare`, `toLocaleString`, etc.)
- Decorator context types (evaluate alongside class support)

Prompt for this work:
````markdown

# Task: Replace lib.d.ts Bundle with Curated Mindcraft Standard Library Declarations

## Context

The `packages/typescript` project compiles TypeScript to mindcraft bytecode. It currently bundles
TypeScript's `lib.es5.d.ts`, `lib.decorators.d.ts`, and `lib.decorators.legacy.d.ts` (5000+ lines)
via `scripts/bundle-lib-dts.js` into `src/compiler/lib-dts.generated.ts`. This generated file is
dynamically imported by `src/compiler/compile.ts` and injected into a virtual filesystem for the
TypeScript compiler host.

The problem: the vast majority of `lib.es5.d.ts` declares APIs the mindcraft VM will never support
(e.g., `eval`, `Symbol`, `ArrayBuffer`, typed arrays, `Object.defineProperty`, `Function.prototype.apply`,
`Intl`, etc.). Per the evaluation in `docs/specs/features/lib-dts-evaluation.md`, only a small subset
(~200-400 lines) is actually needed.

## What to Do

Replace the generated lib bundle with a single handwritten declarations file that contains only the
subset of standard library types mindcraft supports. Specifically:

### 1. Create `packages/typescript/src/compiler/lib/mindcraft-lib.d.ts`

Write a curated `.d.ts` file containing **only** these declarations. Copy the type signatures from
TypeScript's `lib.es5.d.ts` where applicable, but simplify overloads where mindcraft's simpler
type system doesn't need them.

**Global constants:**
```typescript
declare var NaN: number;
declare var Infinity: number;
```

**Global functions:**
```typescript
declare function parseInt(string: string, radix?: number): number;
declare function parseFloat(string: string): number;
declare function isNaN(number: number): boolean;
declare function isFinite(number: number): boolean;
```

**Math object** -- all constants (`E`, `LN10`, `LN2`, `LOG2E`, `LOG10E`, `PI`, `SQRT1_2`, `SQRT2`)
and methods (`abs`, `acos`, `asin`, `atan`, `atan2`, `ceil`, `cos`, `exp`, `floor`, `log`, `max`,
`min`, `pow`, `random`, `round`, `sin`, `sqrt`, `tan`). Copy the `interface Math` and
`declare var Math: Math` pattern from `lib.es5.d.ts`.

**String interface** -- instance methods: `toString`, `charAt`, `charCodeAt`, `concat`, `indexOf`,
`lastIndexOf`, `slice`, `substring`, `toLowerCase`, `toUpperCase`, `trim`, `split`, `valueOf`,
`length` (readonly property), index access (`readonly [index: number]: string`).
**StringConstructor**: `fromCharCode(...codes: number[]): string`, callable as `(value?: any): string`.
`declare var String: StringConstructor`.

**Boolean interface** -- `valueOf(): boolean`.
**BooleanConstructor**: callable as `<T>(value?: T): boolean`.
`declare var Boolean: BooleanConstructor`.

**Number interface** -- `toString(radix?: number): string`, `toFixed(fractionDigits?: number): string`,
`valueOf(): number`.
**NumberConstructor**: static constants `MAX_VALUE`, `MIN_VALUE`, `NaN`, `NEGATIVE_INFINITY`,
`POSITIVE_INFINITY`. Callable as `(value?: any): number`.
`declare var Number: NumberConstructor`.

**Array<T> interface** -- properties: `length: number`, index access (`[n: number]: T`).
Methods: `toString`, `push`, `pop`, `shift`, `unshift`, `concat`, `join`, `reverse`, `slice`,
`sort`, `splice`, `indexOf`, `lastIndexOf`, `every`, `some`, `forEach`, `map`, `filter`,
`reduce`, `reduceRight`, `find`, `findIndex`, `includes`.
**ArrayConstructor**: `isArray(arg: any): arg is any[]`.
`declare var Array: ArrayConstructor`.

**ReadonlyArray<T>** -- same read-only methods (no `push`, `pop`, `shift`, `unshift`, `reverse`,
`sort`, `splice`). Include `readonly [n: number]: T`.

**ConcatArray<T>** and **ArrayLike<T>** interfaces (needed for Array overloads).

**Utility types** (type-only, no runtime cost):
```typescript
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
type ConstructorParameters<T extends abstract new (...args: any) => any> = T extends abstract new (...args: infer P) => any ? P : never;
type ReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any;
type InstanceType<T extends abstract new (...args: any) => any> = T extends abstract new (...args: any) => infer R ? R : any;
type Awaited<T> = T extends null | undefined ? T : T extends object & { then(onfulfilled: infer F, ...args: infer _): any } ? F extends ((value: infer V, ...args: infer _) => any) ? Awaited<V> : never : T;
type Uppercase<S extends string> = intrinsic;
type Lowercase<S extends string> = intrinsic;
type Capitalize<S extends string> = intrinsic;
type Uncapitalize<S extends string> = intrinsic;
type NoInfer<T> = intrinsic;
```

**TemplateStringsArray** (needed for tagged template literals):
```typescript
interface TemplateStringsArray extends ReadonlyArray<string> {
  readonly raw: readonly string[];
}
```

**Do NOT include** any of the following:
- `eval`, `Function` constructor or `Function` interface methods (apply/call/bind)
- `CallableFunction`, `NewableFunction`, `IArguments`
- `Symbol`, `PropertyKey` (use `string | number` where needed)
- `Object` interface or `ObjectConstructor`
- `PropertyDescriptor`, `PropertyDescriptorMap`, `TypedPropertyDescriptor`
- `ThisParameterType`, `OmitThisParameter`, `ThisType`
- URI functions (`decodeURI`, `encodeURI`, `decodeURIComponent`, `encodeURIComponent`)
- `escape`, `unescape`
- `ArrayBuffer`, `DataView`, typed arrays (`Int8Array`, `Uint8Array`, etc.)
- `WeakKeyTypes`, `WeakKey`
- `RegExp`, `RegExpMatchArray`, `RegExpExecArray` (deferred past V1)
- `Date`, `DateConstructor` (deferred past V1)
- `Error` or any error subtypes (deferred until `try/catch/throw` compiler support)
- `JSON` (deferred)
- `Intl` namespace
- `ImportMeta`, `ImportCallOptions`, `ImportAssertions`, `ImportAttributes`
- `Promise`, `PromiseLike`, `PromiseConstructorLike` (these are already declared in `ambient.ts`)
- Decorator types from `lib.decorators.d.ts` and `lib.decorators.legacy.d.ts`

Start the file with `/// <reference no-default-lib="true"/>` to prevent TypeScript from
auto-including any other lib files.

### 2. Create a new bundler script `scripts/bundle-lib-dts.js`

Replace the existing script. Instead of reading from `node_modules/typescript/lib/`, it should
read the single `src/compiler/lib/mindcraft-lib.d.ts` file and write it into
`src/compiler/lib-dts.generated.ts` in the same `LIB_FILES` format:

```typescript
export const LIB_FILES: Record<string, string> = {
  "lib.es5.d.ts": `<escaped content of mindcraft-lib.d.ts>`,
};
```

The key must remain `"lib.es5.d.ts"` because `virtual-host.ts` returns
`/lib/lib.es5.d.ts` as the default lib file name.

### 3. Update `src/compiler/ambient.ts`

The `AMBIENT_HEADER` in `ambient.ts` currently declares polyfill interfaces for `Promise<T>`
and `Array<T>` methods (`find`, `findIndex`, `includes`). After this change:

- `Promise<T>` and `Promise` constructor should remain in `AMBIENT_HEADER` (they are
  mindcraft-specific async semantics, separate from the standard lib).
- The `Array<T>` augmentation for `find`, `findIndex`, `includes` should be **removed** from
  `AMBIENT_HEADER` because these methods will now be declared directly in `mindcraft-lib.d.ts`.

### 4. Regenerate and verify

After making the changes:
1. Run the bundle script: `node scripts/bundle-lib-dts.js` (from `packages/typescript/`)
2. Run `npm run typecheck` in `packages/typescript/` to verify no type errors
3. Run `npm run check` in `packages/typescript/` for linting
4. Run `npm run test` in `packages/typescript/` to verify all existing tests still pass

### Important Notes

- **Do not modify `virtual-host.ts` or `compile.ts`** -- the existing plumbing that loads
  `LIB_FILES` and injects them into the virtual filesystem should continue working unchanged.
- **Do not add JSDoc comments** to the declarations unless they are genuinely useful for
  autocomplete tooltips (e.g., Math method parameter names). Avoid copying verbose JSDoc from
  TypeScript's lib files.
- Follow the project's code conventions: read `.github/instructions/global.instructions.md`
  before writing any code. ASCII-only in comments, no rationale comments, no placeholder code.
- The `lib-dts.generated.ts` file is machine-generated and should not be read during
  exploration (per `global.instructions.md`).
- After all code changes, run `npm run typecheck` and `npm run check` in `packages/typescript/`.

````
