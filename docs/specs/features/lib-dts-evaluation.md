# lib.d.ts Evaluation for Mindcraft TypeScript Compiler

The `packages/typescript` project bundles three TypeScript lib files into `lib-dts.generated.ts`
for injection into the authoring environment:

- `lib.es5.d.ts` (4585 lines)
- `lib.decorators.d.ts` (384 lines)
- `lib.decorators.legacy.d.ts` (22 lines)

Since the TypeScript-to-mindcraft-bytecode pipeline requires every runtime-visible declaration
to be backed by a VM implementation, this document categorizes all functionality in these files.

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

### Strip from lib.d.ts (omit entirely)

- `eval`, `Function` constructor
- URI functions (`decodeURI`, `encodeURI`, `decodeURIComponent`, `encodeURIComponent`)
- `escape` / `unescape`
- `Symbol`, `PropertyKey` (redefine as `string | number` if needed)
- Entire `Object`/prototype reflection API
- `Function.prototype.apply/call/bind`, `CallableFunction`, `NewableFunction`, `IArguments`
- `PropertyDescriptor`, `TypedPropertyDescriptor`
- `ThisParameterType`, `OmitThisParameter`, `ThisType`
- All TypedArrays + `ArrayBuffer` + `DataView`
- `WeakKeyTypes`, `WeakKey`
- `Intl` namespace
- `ImportMeta`, `ImportCallOptions`, `ImportAssertions`, `ImportAttributes`
- All decorator context types (both decorator lib files)
- Error subtypes (`EvalError`, `RangeError`, `ReferenceError`, `SyntaxError`, `TypeError`, `URIError`)

### Implement for V1 (mandatory for a useful language)

1. **Math object** -- low difficulty, high value. ~20 host functions + 8 constants.
2. **Core String methods** -- low difficulty. `charAt`, `charCodeAt`, `indexOf`, `lastIndexOf`,
   `slice`, `substring`, `toLowerCase`, `toUpperCase`, `trim`, `split`, `concat`. ~12 host functions.
3. **Core Array methods** -- low-to-medium difficulty. `pop`, `shift`, `unshift`, `reverse`,
   `sort`, `slice`, `concat`, `join`, `splice`, `some`, `every`, `reduce`, `lastIndexOf`.
   Many can be compiler-inlined like existing `map`/`filter`/`forEach`.
4. **Global parsing** -- `parseInt`, `parseFloat`, `isNaN`, `isFinite`. Trivial.
5. **Number formatting** -- `toFixed()`, `toString(radix)`. Low difficulty.

### Implement for V1 if feasible (nice-to-have)

- `Error` type + constructor (medium; gated on compiler supporting `try/catch/throw`)
- `JSON.parse` / `JSON.stringify` (medium; useful for data persistence)
- `Date.now()` minimal subset (medium)

### Defer past V1

- Full `Date` object with all getters/setters
- `RegExp` + regex-dependent string methods (`match`, `replace` with regex, `search`)
- User-constructable Promises
- Locale-aware functionality (`localeCompare`, `toLocaleString`, etc.)
