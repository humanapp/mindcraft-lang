# `@mindcraft-lang/typescript` -- Phased Implementation Plan

Companion to [user-authored-sensors-actuators.md](user-authored-sensors-actuators.md).
See also [vscode-authoring-debugging.md](vscode-authoring-debugging.md) -- section 6 (Debug Metadata)
defines the compiler-emitted structures needed in Phase 11a+. Sections 1-5/7-20 cover
VS Code extension and bridge concerns that are out of scope for this plan.
Focused on the compiler pipeline -- no VS Code extension, no bridge, no editor-specific concerns.

---

## Workflow Convention

Each phase follows this loop:

1. **Kick off** -- "Implement Phase N." The implementer reads this doc, the spec,
   and any relevant instruction files before writing code. After implementation,
   STOP and present the work for review. Do not write the Phase Log entry, amend
   the spec, update the Current State section, or perform any post-mortem activity.
2. **Review + refine** -- Followup prompts within the same conversation.
3. **Declare done** -- "Phase N is complete." Only the user can declare the phase
   complete. Do not move to the post-mortem step until the user requests it.
4. **Post-mortem** -- "Run post-mortem for Phase N." This step:
   - Diffs planned deliverables vs what was actually built.
   - Records the outcome in the Phase Log (bottom of this doc). The Phase Log is
     a post-mortem artifact -- never write it during implementation.
   - Amends `user-authored-sensors-actuators.md` with dated notes if the spec
     was wrong or underspecified.
   - Propagates discoveries to upcoming phases in this doc (updated risks,
     changed deliverables, new prerequisites).
   - Writes a repo memory note with key decisions for future conversations.
5. **Next phase** -- New conversation (or same if context is not exhausted).

The planning doc is the source of truth across conversations. Session memory does
not survive. Keep this doc current.

---

## Current State

- (Updated 2026-03-24) Phases 0-15 are complete, plus the Array method lowering
  detour, the VM list mutation ops detour, and the Array.sort detour. Phase 15 added
  ternary operator (`? :`) and nullish coalescing (`??`) compilation. Ternary uses
  the same JumpIfFalse/Jump/Label pattern as `if`/`else`. `??` uses
  `TypeCheck(NativeType.Nil)` for runtime nil detection rather than operator
  overloads. Phase 14 added `for...of` loop
  desugaring and removed the custom module-scoped `Array<T>` from ambient
  declarations. The Array method detour added lowering for `includes`, `some`,
  `every`, `find`, `concat`, `join`, `reverse`, and `slice`. The list mutation
  ops detour added 4 new VM opcodes (`LIST_POP`, `LIST_SHIFT`, `LIST_REMOVE`,
  `LIST_INSERT`) and compiler lowering for `pop`, `shift`, `unshift`, and
  `splice`. The sort detour added the `LIST_SWAP` opcode (Op 99) and
  `lowerListSort` which emits an insertion sort as bytecode using
  `CALL_INDIRECT` for the comparator callback. Only `fill` and `copyWithin`
  still produce compile-time diagnostics. All other unrecognized array methods
  also produce diagnostics. The ambient header augments the global `Array<T>` with
  `find`, `findIndex`, and `includes` signatures (ES2015/ES2016 methods not in
  `lib.es5.d.ts`). `NonNullExpression` and `AsExpression` are now handled in
  `lowerExpression`. `break`/`continue` work via
  the existing loop stack with a separate `continueTarget` label. Phase 13's
  GET_FIELD for struct
  has been replaced by ctx-as-native-struct (implemented out of band). Context,
  SelfContext, and EngineContext are now native-backed structs with fieldGetters,
  registered in `packages/core/src/brain/runtime/context-types.ts`. Struct method
  dispatch is implemented as a general-purpose feature via `lowerStructMethodCall()`.
  The ctx `StructValue` occupies local slot 0 in `onExecute` and lifecycle functions.
  The VM auto-injects it via `FunctionBytecode.injectCtxTypeId`: when set, `spawnFiber`
  creates the ctx struct from `fiber.executionContext` and prepends it to the caller's
  args, so the caller passes one fewer argument than `numParams`. This replaced the
  previous manual wrapping in `authored-function.ts` (removed).
  All compile-time phantom code (ctxSymbol tracking, isCtxExpression, isCtxSelfAccess,
  isCtxEngineAccess, lowerCtxMethodCall, variable declaration skip) has been removed.
  See [ctx-as-native-struct.md](ctx-as-native-struct.md).
  `packages/typescript` has a working build, test suite, type-checking pipeline, AST
  validation, descriptor extraction, the callDef design, end-to-end bytecode
  compilation and execution, control flow (`if`/`else`, `while`, `for`,
  `break`/`continue`, block-scoped `let`/`const`, variable shadowing, assignments,
  `++`/`--`), logical operators (`&&`, `||` with short-circuit evaluation, `!`),
  string concatenation (`+` with `Add` overload), template literal lowering
  (desugared to string concatenation with implicit type coercion via conversion
  functions), user-defined helper functions (`CALL`), callsite-persistent top-level
  variables (`LOAD_CALLSITE_VAR` / `STORE_CALLSITE_VAR` with module init function),
  `onPageEntered` lifecycle support (user body compilation + always-generated
  wrapper that calls module init then user function), `null` and `undefined`
  literal support (both map to `NIL_VALUE`), nullish comparison support
  (`x === null`, `x !== undefined`) via nil operator overloads in core and
  `tsTypeToTypeId` handling of `TypeFlags.Null`, `TypeFlags.Undefined`, and
  nullable union types, a linker that merges `UserAuthoredProgram` functions
  and constants into a `BrainProgram` with `CALL`/`PUSH_CONST` operand remapping,
  a VM dispatch wrapper (`createUserTileExec`) that spawns fibers for user
  bytecode with inline sync execution via `vm.spawnFiber()` + `vm.runFiber()`,
  a registration bridge (`registerUserTile`) that wires user-authored tiles
  into the `FunctionRegistry` and `TileCatalog`, ambient type declarations
  generated from `ITypeRegistry` (user-creatable structs as plain interfaces,
  native-backed structs as branded readonly interfaces), object literal
  compilation to `STRUCT_NEW` / `STRUCT_SET` bytecode (contextual type resolution,
  nested struct support, native-backed struct rejection), and array literal
  compilation to `LIST_NEW` / `LIST_PUSH` bytecode (contextual/alias type
  resolution, element-type matching fallback, nested struct-in-list support),
  `NativeType.Any` with tagged `AnyCodec` (self-contained encode/decode for
  nil/boolean/number/string via `TypeUtils` discrimination), `AnyList`
  registration in `registerCoreTypes()`, `tsTypeToTypeId` union-to-Any
  resolution (multi-member unions map to `CoreTypeIds.Any`), mixed-type
  array literal compilation (`[1, "hello", true]` resolves to `AnyList`),
  map/Record literal compilation to `MAP_NEW` / `MAP_SET` bytecode
  (contextual type resolution via named alias or string index type,
  `resolveMapTypeId()` with `MapConstructor` instantiation fallback,
  struct-first disambiguation for object literals, VM `execMapNew` fix
  to read typeId from constant pool), and enum value literal compilation
  (string literals with enum-typed contextual type produce `EnumValue`
  constants via `tryResolveEnumValue()` using `checker.getContextualType()`
  - registry `resolveByName()` + `coreType === NativeType.Enum` check).
    Enum types also get `EqualTo`/`NotEqualTo` operator overloads auto-registered
    in `addEnumType()`, so `===`/`!==` comparisons between enum values work.
- (Updated 2026-03-23) Core type system foundational rework complete (all 8 phases
  plus list/array method detour). See `core-type-system-phased-impl.md` for details.
  Key additions affecting remaining compiler phases:
  - **Nullable types:** `addNullableType(baseTypeId)` creates nullable variants via
    `NullableCodec`. `tsTypeToTypeId()` returns nullable TypeIds for `T | null`/
    `T | undefined`. Ambient emits `T | null`.
  - **Generic type constructors:** `TypeConstructor` interface, `ListConstructor`,
    `MapConstructor` registered in `registerCoreTypes()`. `instantiate(name, args)`
    creates types on demand. `resolveListTypeId()` now uses
    `registry.instantiate("List", [elementTypeId])` instead of scanning.
    `autoInstantiated?: boolean` flag on TypeDef.
  - **Union types:** `NativeType.Union = 10`, `UnionTypeShape`, `UnionCodec`.
    `getOrCreateUnionType()` with normalization (flatten, dedup, sort, nullable
    subsumption). `tsTypeToTypeId()` returns union TypeIds for resolvable
    multi-member unions (falls back to `Any` only for unresolvable members).
    `expandTypeIdMembers()` replaced `unwrapNullableTypeId()`.
    `resolveOperatorWithExpansion()` handles cross-product operator lookup.
  - **`typeof` lowering:** `Op.TYPE_CHECK = 150`, `IrTypeCheck`. `typeof x ===
"string"` patterns lower to a single `TYPE_CHECK` opcode. Supports `"number"`,
    `"string"`, `"boolean"`, `"undefined"`, `"function"`. `"object"` rejected.
  - **First-class function references:** `NativeType.Function = 11`,
    `FunctionValue` in `Value` union, `Op.CALL_INDIRECT = 160`, `FunctionCodec`,
    `IrPushFunctionRef`/`IrCallIndirect` IR nodes, linker remaps `FunctionValue`
    constants.
  - **Closures:** `Op.MAKE_CLOSURE = 170`, `Op.LOAD_CAPTURE = 171` (no
    `STORE_CAPTURE` -- capture-by-value). Arrow functions and function expressions
    compile as separate closure function entries. Capture analysis via TS checker
    symbol resolution.
  - **Type-level function signatures:** `FunctionTypeShape`, `FunctionTypeDef`,
    `getOrCreateFunctionType()` with memoization. `tsTypeToTypeId()` resolves call
    signatures to specific function type TypeIds. `ts.TypeFlags.Void` maps to
    `CoreTypeIds.Void`. Ambient emits arrow syntax for function types.
  - **Structural subtyping:** `isStructurallyCompatible(source, target)` on
    `ITypeRegistry`. `nominal?: boolean` on `StructTypeShape`. Memoized.
    `checkStructAssignmentCompat()` wired into `lowerAssignment` and variable
    declaration lowering.
  - **List/array methods (detour):** `IrListGet`/`IrListSet`/`IrSwap` IR nodes.
    Element access (`arr[i]`, `arr[i] = val`) via `lowerElementAccess()` /
    `lowerElementAccessAssignment()`. Five list methods (`.push`, `.indexOf`,
    `.filter`, `.map`, `.forEach`) compiled to inline loops -- no new opcodes.
    `allocLocal()` on `ScopeStack` for anonymous temporaries. Method call dispatch
    infrastructure via `lowerListMethodCall`. Ambient declarations now use the
    global `Array<T>` from `lib.es5.d.ts` directly (custom module-scoped `Array<T>`
    removed in Phase 14); list type aliases (`NumberList`, etc.) are emitted as
    `type NumberList = Array<number>`. `for...of` loops desugar to index-based
    iteration via `lowerForOfStatement()`.
  - **`tsTypeToTypeId()` enhanced:** Now resolves named types (structs, enums)
    via symbol name lookup on the registry, not just primitives. Accepts optional
    `checker?: ts.TypeChecker` parameter for resolving call signatures.
  - **`.length` on lists:** `lowerPropertyAccess()` detects `.length` on
    list-typed expressions and emits `IrListLen` -> `Op.LIST_LEN`.
- `src/index.ts` re-exports `compileUserTile`, `initCompiler`, `buildAmbientDeclarations`,
  `CompileDiagnostic`, `CompileResult`, `ExtractedDescriptor`, `ExtractedParam` from
  the compiler module alongside `UserAuthoredProgram` and `UserTileLinkInfo`
  interfaces, `linkUserPrograms` and `LinkResult` from the linker module, and
  `createUserTileExec`, `registerUserTile` from the runtime module.
- `src/linker/linker.ts` exports `linkUserPrograms(brainProgram, userPrograms[])` which
  appends user functions to the brain program, remaps `CALL`, `PUSH_CONST`, and
  `MAKE_CLOSURE` operands, remaps `FunctionValue` constants (funcId + offset),
  merges constants, copies `injectCtxTypeId` through to linked functions, and
  returns `LinkResult` with `linkedEntryFuncId`, `linkedInitFuncId`, and
  `linkedOnPageEnteredFuncId` per user program.
- `src/runtime/authored-function.ts` exports `createUserTileExec(linkedProgram,
linkInfo, vm, scheduler)` returning a `HostAsyncFn` with `exec` and `onPageEntered`
  methods. Sync tiles execute inline via `vm.spawnFiber()` + `vm.runFiber()`.
  The ctx `StructValue` is no longer created here -- the VM auto-injects it via
  `FunctionBytecode.injectCtxTypeId` on the entry/lifecycle functions.
- `src/runtime/registration-bridge.ts` exports `registerUserTile(linkInfo, hostFn)`
  performing three-step registration using `getBrainServices()`: param tile defs
  (with type resolution via `ITypeRegistry.resolveByName`), function entry,
  sensor/actuator tile def.
- `src/compiler/compile.ts` exports `compileUserTile(source, options?)` which accepts
  a TypeScript source string and optional `CompileOptions`, runs it through a fully
  in-memory virtual `ts.CompilerHost`, validates the AST, extracts descriptor metadata,
  lowers and emits bytecode into a `UserAuthoredProgram`. `CompileOptions` supports
  `ambientSource` for app-injected ambient declarations. Type resolution uses
  `getBrainServices().types.resolveByName()`. Operator overloads and
  host function IDs are resolved directly via `getBrainServices()`. The lib `.d.ts`
  content is lazy-loaded via `initCompiler()` (async, dynamic `import()`) so bundlers
  like Vite automatically chunk the ~230KB lib strings into a separate file loaded
  on demand.
- Pipeline: parse -> type check -> validate AST -> extract descriptor -> lower -> emit
  -> assemble program.
- `src/compiler/validator.ts` rejects unsupported constructs (classes, enums, `var`,
  `for...in`, `eval`, computed property names, etc.) with positioned diagnostics.
- `src/compiler/descriptor.ts` extracts `ExtractedDescriptor` from the
  `Sensor()`/`Actuator()` default export: `kind`, `name`, `outputType`, `params`,
  `execIsAsync`, `onExecuteNode`, `onPageEnteredNode`.
- `src/compiler/types.ts` defines `CompileDiagnostic`, `ExtractedDescriptor`,
  `ExtractedParam`.
- `src/compiler/scope.ts` provides `ScopeStack` -- a block-scoping variable allocator
  with `pushScope`/`popScope`/`declareLocal`/`resolveLocal`. Used by the lowering pass
  for `let`/`const` variable declarations and identifier resolution.
- `src/compiler/ir.ts` defines IR node types including control flow (`IrLabel`,
  `IrJump`, `IrJumpIfFalse`, `IrJumpIfTrue`, `IrDup`), multi-function support
  (`IrCall`, `IrLoadCallsiteVar`, `IrStoreCallsiteVar`), struct/list construction
  (`IrStructNew`, `IrStructSet`, `IrListNew`, `IrListPush`), list operations
  (`IrListLen`, `IrListGet`, `IrListSet`, `IrSwap`, `IrListSwap`), function references
  (`IrPushFunctionRef`, `IrCallIndirect`, `IrMakeClosure`, `IrLoadCapture`),
  and type checking (`IrTypeCheck`).
- `src/compiler/lowering.ts` exports `lowerProgram()` which compiles all file-level
  function declarations, the `onExecute` body, the optional user `onPageEntered` body,
  a module init function (if callsite-persistent vars exist), and an always-generated
  `onPageEntered` wrapper into a `ProgramLoweringResult` containing multiple
  `FunctionEntry` records. `FunctionEntry` includes an optional `injectCtxTypeId`
  field (set to `ContextTypeIds.Context` on `onExecute` and `onPageEntered-wrapper`
  entries) that propagates through `emitFunction` to `FunctionBytecode`, enabling
  the VM to auto-inject the ctx struct at slot 0.
  `ProgramLoweringResult` includes `onPageEnteredWrapperId`.
  Supports `if`/`else`, `while`, C-style `for`, `break`/`continue`, block-scoped
  variable declarations, assignments (`=`, `+=`, `-=`, `*=`, `/=`), prefix/postfix
  `++`/`--`, logical operators (`&&`, `||` with short-circuit via `DUP` +
  `JumpIfFalse`/`JumpIfTrue`, `!` via `HostCallArgs(Not)`), string concatenation
  (via `Add(String, String)` operator), template literal lowering (desugared to
  concatenation with implicit type coercion via conversion functions),
  user-defined function calls, callsite-persistent variable access, struct/list/map
  literal compilation, `typeof` lowering to `TYPE_CHECK`, function references
  (`IrPushFunctionRef`), closures (`IrMakeClosure`/`IrLoadCapture` via
  `lowerClosureExpression` + `findCapturedVariables`), indirect calls
  (`IrCallIndirect`), element access (`arr[i]` via `lowerElementAccess()`),
  element assignment (`arr[i] = val` via `lowerElementAccessAssignment()`), list
  methods (`.push`, `.indexOf`, `.filter`, `.map`, `.forEach`, `.sort` via
  `lowerListMethodCall`), struct method dispatch (`lowerStructMethodCall` for
  methods declared via `StructMethodDecl`, e.g., `ctx.self.getVariable()`),
  `.length` on list-typed expressions (via `IrListLen`),
  operator resolution with union type expansion (`resolveOperatorWithExpansion()`),
  and structural subtyping checks on assignments (`checkStructAssignmentCompat()`).
- `src/compiler/virtual-host.ts` provides `createVirtualCompilerHost()` -- a
  browser-compatible `ts.CompilerHost` with zero Node.js API usage.
- `src/compiler/ambient.ts` exports `buildAmbientDeclarations()` which generates the
  `"mindcraft"` ambient module by iterating `ITypeRegistry.entries()` via
  `getBrainServices().types`. Generates plain interfaces for user-creatable structs,
  branded readonly interfaces (with `__brand: unique symbol`) for native-backed structs
  (including Context, SelfContext, EngineContext with their fields and method
  signatures via `StructMethodDecl`),
  string union types for enums, `Array<T>` interfaces (with method signatures for
  `.push`, `.indexOf`, `.filter`, `.map`, `.forEach`) for lists, `Record` aliases for
  maps, `T | null` for nullable types, `member1 | member2 | ...` for union types,
  `(arg0: T) => R` arrow syntax for function types, and `MindcraftTypeMap` entries
  for strongly-typed primitives. Auto-instantiated types (from generic constructors)
  are skipped (no named aliases generated). Core types (`boolean`, `number`, `string`,
  `void`, `nil`, `unknown`) are hardcoded in `AMBIENT_MODULE_START` and skipped during
  registry iteration to avoid duplication. Replaces the previous
  `buildAmbientSource(appTypeEntries?)` API.
- `scripts/bundle-lib-dts.js` generates `src/compiler/lib-dts.generated.ts` at build
  time, bundling TypeScript's `lib.es5.d.ts` + decorator libs as string constants.
- `package.json` has an `exports` map for proper bundler resolution.
- `apps/sim` depends on `@mindcraft-lang/typescript` (local `file:` dep) and calls
  `initCompiler()` in `bootstrap.ts` to preload the compiler in the background.
- `@mindcraft-lang/core` already has all VM primitives needed: `LOAD_LOCAL`,
  `STORE_LOCAL`, `LOAD_CALLSITE_VAR`, `STORE_CALLSITE_VAR` opcodes are implemented in
  the VM. `BytecodeEmitter` has corresponding methods. `ConstantPool` is available.
  `FunctionBytecode` / `Program` / `Op` / `Instr` interfaces are available.
  The seam exists.
- `BytecodeEmitter` and `ConstantPool` are exported from
  `@mindcraft-lang/core/brain` via the compiler barrel (added in Phase 0).
- All compiler code must run in the browser at authoring time. No Node.js-only APIs
  (`node:fs`, `node:path`, etc.) in runtime code paths. Build-time scripts (code
  generation, lib bundling) may use Node.js. See the spec's Stage 1 for details.
- (Added 2026-03-20, resolved 2026-03-20) **CallDef design resolved.** The `params` /
  `ExtractedParam[]` representation maps mechanically to a `BrainActionCallDef` via a
  builder function (`buildCallDef`). Each named param becomes a `param()` arg spec
  scoped to the tile (`user.<tileName>.<paramName>`). Each anonymous param
  (`anonymous: true` in the descriptor) references a shared `anon.<type>` tile def
  that is auto-registered on the fly if it does not already exist. All params go into
  a `bag()`, with optional params wrapped in `optional()`. SlotIds are assigned in
  declaration order. The `onExecute` function receives the MapValue of args; compiled
  bytecode unpacks each param into a local variable in a preamble, applying defaults
  for absent optional params. `ExtractedParam` gains an `anonymous: boolean` field.
  `UserAuthoredProgram` includes `callDef: BrainActionCallDef` and
  `outputType?: TypeId`. TileIds use a `user.` prefix (e.g.,
  `tile.sensor->user.nearby-enemy`). See the spec's updated Section A (Params
  descriptor shape), Stage 3, and Section C (Integration with tile system) for full
  details.

---

## Phases

### Phase 0: Package skeleton and test wiring

**Objective:** Make `packages/typescript` a real, buildable, testable package with
`typescript` as a production dependency and a working test runner. Prove the
`@mindcraft-lang/core` consumption seam compiles.

**Packages/files touched:**

- `packages/typescript/package.json` -- add `typescript` as a production dep, add
  `test` / `pretest` scripts, add `tsx` devDependency
- `packages/typescript/tsconfig.json` -- add path aliases resolving
  `@mindcraft-lang/core`
- `packages/typescript/src/index.ts` -- keep existing types, add a re-export proving
  the core seam
- `packages/typescript/src/compiler/compile.ts` -- stub orchestrator with the public
  API signature
- `packages/typescript/src/compiler/compile.spec.ts` -- one test that imports the API
  and asserts it exists

**Concrete deliverables:**

1. `npm run build` succeeds in `packages/typescript`
2. `npm test` runs and passes at least one test
3. `typescript` (the TS compiler API) is a production dependency
4. Core types (`Op`, `BytecodeEmitter`, `ConstantPool`, `Program`, `FunctionBytecode`)
   are importable and resolved

**Acceptance criteria:**

- `npm run build && npm test` passes from `packages/typescript/`
- `npm run check` (biome) passes
- No dist/ output references `@mindcraft-lang/core` internals that aren't stable exports

**Key risks:**

- tsconfig resolution between the two workspace packages -- need to verify that
  `@mindcraft-lang/core`'s built dist exports resolve correctly for the TS package's
  compilation and tests
- `typescript` as a prod dep vs devDep: it must be prod because user code compilation
  happens in-browser at authoring time, not just at build time

---

### Phase 1: Virtual file host + TS type checking

**Objective:** Accept a TypeScript source string, set it up in a virtual
`ts.CompilerHost` alongside a minimal `mindcraft.d.ts` ambient file, run the TS type
checker, and return diagnostics. This is spec Stage 1 in isolation.

**Packages/files touched:**

- `packages/typescript/src/compiler/virtual-host.ts` --
  `createVirtualCompilerHost(files, options)` implementation
- `packages/typescript/src/compiler/ambient.ts` -- hardcoded `mindcraft.d.ts` content
  (minimal: `Sensor`, `Actuator`, `Context` with `time`, `dt`,
  `self.getVariable`, `self.setVariable`)
- `packages/typescript/src/compiler/compile.ts` -- wire up: source string in,
  `ts.createProgram`, return diagnostics
- `packages/typescript/src/compiler/compile.spec.ts` -- tests:
  - Valid sensor source produces zero diagnostics
  - Source with type error produces diagnostics with correct positions
  - Source referencing undefined API method produces error

**Concrete deliverables:**

1. `compileUserTile(source: string): CompileResult` exists (returns diagnostics at
   minimum, no bytecode yet)
2. Virtual file host works with `ts.createProgram`
3. `mindcraft.d.ts` ambient is minimal but sufficient for the vertical slice

**Acceptance criteria:**

- Test: valid sensor source -> 0 TS diagnostics
- Test: `ctx.engine.nonExistent()` -> diagnostic error
- Test: wrong argument type -> diagnostic error

**Key risks:**

- TypeScript compiler API is large and slightly different between versions. Pin to
  `~5.7.2` (already done in package.json).
- `mindcraft.d.ts` surface design -- start tiny, expand later. Don't try to design
  the full engine context API now.
- **Browser compatibility.** The virtual host must be fully in-memory -- no `node:fs`,
  `node:path`, or any other Node.js-only API. TypeScript's default `CompilerHost`
  uses `node:fs` internally, so every host method (`readFile`, `fileExists`,
  `getSourceFile`, `getDefaultLibFileName`, etc.) must be replaced with an in-memory
  implementation. `ts.sys` must not be used. TypeScript's lib `.d.ts` files (e.g.,
  `lib.es5.d.ts`) must be bundled as string constants at build time (a build script
  may read them from `node_modules/typescript/lib/` and generate a source module).
  `getDefaultLibFileName` must return a virtual path that exists in the in-memory
  file map, not a real filesystem path.

---

### Phase 2: AST validation + descriptor extraction

**Objective:** Walk the TS AST to (a) reject unsupported constructs and (b) extract the
`Sensor()` / `Actuator()` descriptor metadata. This is spec Stages 2-3.

**Packages/files touched:**

- `packages/typescript/src/compiler/validator.ts` -- AST walker that rejects classes,
  `eval`, `var`, dynamic imports, etc. Produces diagnostics.
- `packages/typescript/src/compiler/descriptor.ts` -- Extract `kind`, `name`,
  `outputType`, `params`, `execFuncNode`, `onPageEnteredNode` from the default export
- `packages/typescript/src/compiler/types.ts` -- `ExtractedDescriptor`,
  `ExtractedParam`, `CompileDiagnostic` types
- Tests for both

**Concrete deliverables:**

1. Validator rejects `class`, `eval`, `var`, `for...in`, computed property names --
   with diagnostics
2. Descriptor extraction reads `Sensor({ name, output, params, exec })` from AST
3. `onPageEntered` named export detected if present
4. Compile pipeline now runs: parse -> check -> validate -> extract

**Acceptance criteria:**

- Test: source with `class Foo {}` -> validation diagnostic
  "Classes are not supported"
- Test: source with `var x = 1` -> diagnostic
  "`var` is not allowed, use `let` or `const`"
- Test: valid sensor source -> `ExtractedDescriptor` with correct `name`,
  `kind: "sensor"`, `outputType`, params list
- Test: actuator source with `async exec` -> descriptor with async flag
- Test: source with `export function onPageEntered` -> `onPageEnteredNode` is non-null

**Key risks:**

- Descriptor shape must be a literal object expression. If users assign to a variable
  first, extraction fails. This is an intentional constraint -- document and enforce it.
- The validator needs to be exhaustive over disallowed AST node kinds. Use
  `ts.SyntaxKind` enum to enumerate. Reject unknown nodes rather than silently
  accepting.
- (Added 2026-03-20) `CompileDiagnostic` and `CompileResult` types already exist in
  `compile.ts` from Phase 0. Phase 2's planned `types.ts` should either import from
  there or relocate them -- avoid duplication.

**Prerequisite before Phase 3:** The `params` representation has been formalized
(resolved 2026-03-20). `ExtractedParam[]` maps mechanically to a `BrainActionCallDef`
via the callDef builder. Named params create per-tile `BrainTileParameterDef` entries;
anonymous params reuse or auto-create shared `anon.<type>` tile defs. Phase 3 can
proceed with this design. See the spec's updated Section A and Section C for details.

---

### Phase 3: Minimal lowering -- the first vertical slice

**Objective:** Lower the simplest possible `exec` function body to IR and emit working
bytecode. Target: a sync sensor that does arithmetic on params and returns a boolean.
No helpers, no callsite vars, no control flow.

**Packages/files touched:**

- `packages/typescript/src/compiler/ir.ts` -- IR node types (start small: `PushConst`,
  `LoadLocal`, `StoreLocal`, `Return`, `HostCallArgs`, arithmetic ops)
- `packages/typescript/src/compiler/lowering.ts` -- TS AST -> IR for: variable
  declarations, number/string/boolean literals, binary expressions, return statements,
  parameter access
- `packages/typescript/src/compiler/emit.ts` -- IR -> `FunctionBytecode` using
  `BytecodeEmitter` + `ConstantPool` from core
- `packages/typescript/src/compiler/call-def-builder.ts` -- converts
  `ExtractedDescriptor` to `BrainActionCallDef`
- `packages/typescript/src/compiler/compile.ts` -- wire lowering + emission into the
  pipeline, produce a `UserAuthoredProgram`
- `packages/typescript/src/compiler/types.ts` -- add `anonymous: boolean` to
  `ExtractedParam`
- `packages/typescript/src/compiler/descriptor.ts` -- extract `anonymous` flag from
  param definitions
- `packages/typescript/src/compiler/ambient.ts` -- make `params` optional, add
  `anonymous?: boolean` to `ParamDef`
- Tests that compile a source string and execute the resulting bytecode in the VM

**Concrete deliverables:**

1. A sensor like the following compiles to valid bytecode:

   ```typescript
   export default Sensor({
     name: "is-close",
     output: "boolean",
     params: { distance: { type: "number", default: 5 } },
     onExecute(ctx: Context, params: { distance: number }): boolean {
       return params.distance < 10;
     },
   });
   ```

2. The bytecode passes `BytecodeVerifier`
3. The bytecode executes in a real `VM` instance and returns the correct value
4. `UserAuthoredProgram` is fully assembled with functions, constants, callDef, and
   metadata
5. `buildCallDef()` produces correct `BrainActionCallDef` from `ExtractedDescriptor`:
   correct argSlots, slotIds, tileId strings, optional/required distinction,
   anonymous flag

**Acceptance criteria:**

- End-to-end test: source string -> `UserAuthoredProgram` -> `VM.runFiber()` ->
  correct return value
- Test covers: number literal, boolean literal, string literal, `<` comparison,
  `return`
- `BytecodeVerifier` passes on output
- Test: `buildCallDef` for a descriptor with one required param and one optional
  param -> callDef has 2 argSlots with correct tileIds and optional/required flags
- Test: `buildCallDef` for a descriptor with an anonymous param -> argSpec has
  `anonymous: true` and tileId starts with `tile.parameter->anon.`

**Key risks:**

- Getting parameter passing right. The `onExecute` function receives `(ctx, params)`.
  `params` must be a struct/map. Need to decide how parameters map to local slots.
- Binary expression lowering -- need to decide if `<` compiles to a HOST_CALL
  (existing operator overload) or a new mechanism. The spec says arithmetic operators
  use `HOST_CALL_ARGS`. Need to check if the existing operator host functions accept
  individual args or a `MapValue`.
- This is the hardest phase because it forces all the plumbing to work for the first
  time.
- (Updated 2026-03-20) **CallDef design resolved.** The `ExtractedParam[]` maps to a
  `BrainActionCallDef` via `buildCallDef()`. Named params produce per-tile parameter
  tileIds (`user.<tileName>.<paramName>`). Anonymous params reference shared
  `anon.<type>` tile defs (auto-registered on the fly if missing). The `onExecute`
  bytecode receives a MapValue keyed by slotId and unpacks params into locals in a
  preamble. `ambient.ts` needs `params` made optional, and `ParamDef` needs
  `anonymous?: boolean`. `ExtractedParam` gains `anonymous: boolean`. New file
  `call-def-builder.ts` handles the conversion. No callSpec combinators are exposed
  to user code.

---

### Phase 4: Control flow + local variables

**Objective:** Support `if`/`else`, `while`, `for`, `let`/`const` with block scoping,
and `break`/`continue`.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- add visitors for `IfStatement`,
  `WhileStatement`, `ForStatement`, `Block`, `VariableDeclarationList`
- `packages/typescript/src/compiler/ir.ts` -- add `Jump`, `JumpIfFalse`,
  `JumpIfTrue`, `Label`
- `packages/typescript/src/compiler/scope.ts` -- scope stack for local variable
  allocation with block scoping
- Tests

**Concrete deliverables:**

1. `if`/`else` compiles and executes correctly
2. `while` loop compiles and executes (including with `break`/`continue`)
3. `for` loop (C-style) compiles
4. Block-scoped `let`/`const` allocate distinct local slots; shadowing works
5. Nested blocks produce correct variable indices

**Acceptance criteria:**

- Test: sensor with
  `if (params.x > 5) { return true; } else { return false; }` ->
  correct results for x=3 and x=10
- Test: sensor with a `while` loop counting to N -> correct result
- Test: shadowed variables (`let x = 1; { let x = 2; }; return x;`) -> returns 1
- Test: `for (let i = 0; i < 3; i++)` -> runs 3 iterations

**Key risks:**

- `break`/`continue` need a label stack to track enclosing loop boundaries
- Variable slot reuse across non-overlapping scopes (optimization, can defer)
- (Added 2026-03-20, resolved) **Trailing RET required.** When `if`/`else` emits a
  `Jump(endLabel)` at the end of the then-branch, the `endLabel` must target a valid
  instruction. If the `if`/`else` is the last statement, the label points past the end
  of the bytecode, which fails `BytecodeVerifier`. Solved by appending a trailing `RET`
  instruction at the end of every lowered function body.

---

### Phase 5: Helper functions + callsite-persistent state

**Objective:** Support user-defined helper functions (compiled as additional
`FunctionBytecode` entries, called via `CALL`) and top-level `let`/`const` as
callsite-persistent variables (`LOAD_CALLSITE_VAR` / `STORE_CALLSITE_VAR`).

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- handle `FunctionDeclaration` at
  file level, function calls via `CALL` opcode
- `packages/typescript/src/compiler/compile.ts` -- two-pass: first pass assigns
  function IDs, second pass compiles (same pattern as `BrainCompiler`)
- `packages/typescript/src/compiler/emit.ts` -- emit multiple `FunctionBytecode`
  entries into `Program.functions`
- `packages/typescript/src/compiler/scope.ts` -- distinguish module-level scope
  (callsite vars) from function-level scope (locals)
- Module init function generation (compiler-generated function that evaluates
  top-level initializers)

**Concrete deliverables:**

1. Helper functions compile and are callable from `exec`:

   ```typescript
   function clamp(v: number, lo: number, hi: number): number {
     if (v < lo) return lo;
     if (v > hi) return hi;
     return v;
   }

   export default Sensor({
     ...,
     exec(ctx, params) {
       return clamp(params.x, 0, 100) > 50;
     },
   });
   ```

2. Top-level `let` -> `STORE_CALLSITE_VAR` / `LOAD_CALLSITE_VAR`
3. Module init function generated for top-level initializers
4. `UserAuthoredProgram.numCallsiteVars` is correct
5. Callsite vars persist across invocations (test by running the program twice and
   verifying state accumulates)

**Acceptance criteria:**

- Test: helper function called from `exec` returns correct value
- Test: top-level `let count = 0; ... count += 1; return count;` -> returns 1 on
  first call, 2 on second
- Test: multiple top-level vars -> correct slot indices
- Test: module init function resets state when `callsiteVars` is freshly allocated

**Key risks:**

- Function ID assignment ordering. Must match the two-pass pattern from
  `BrainCompiler` so that `CALL` operands are correct.
- Module init function must run before the first `exec` invocation. The exec wrapper
  checks for uninitialized `callsiteVars` and runs init.
- (Added 2026-03-20) **`ScopeStack` is function-scoped, not module-scoped.** Phase 4's
  `ScopeStack` tracks locals within a single function body. Phase 5 must either create
  a new `ScopeStack` per compiled function or distinguish module-level scope (callsite
  vars) from function-level scope (locals) with a separate mechanism.
- (Added 2026-03-20) **Assignment and `++`/`--` are already implemented.** Phase 4
  added `=`, `+=`, `-=`, `*=`, `/=`, prefix/postfix `++`/`--`. Phase 5's helper
  function calling will benefit from these being available. The lowering context
  already uses `LowerContext` with a `ScopeStack` -- extending to multi-function
  should be straightforward.

---

### Phase 6: `onPageEntered` + lifecycle wrapper

**Objective:** Compile the `export function onPageEntered(ctx)` named export and
generate the `onPageEntered` wrapper that runs module init then calls the user's
function.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- compile `onPageEnteredNode` from
  descriptor, generate `onPageEntered` wrapper function that calls module init then
  user `onPageEntered` (leverages existing `lowerProgram` multi-function infrastructure)
- `packages/typescript/src/compiler/compile.ts` -- set
  `lifecycleFuncIds.onPageEntered` on `UserAuthoredProgram`

**Concrete deliverables:**

1. `onPageEntered` compiles as a separate `FunctionBytecode`
2. Generated wrapper calls module init, then user `onPageEntered`
3. `UserAuthoredProgram.lifecycleFuncIds.onPageEntered` points to wrapper
4. If no user `onPageEntered`, wrapper still runs module init

**Acceptance criteria:**

- Test: `onPageEntered` resets a callsite var; next `exec` call sees the reset value
- Test: source without `onPageEntered` -> wrapper still generated, runs init
- Test: `onPageEntered` wrapper calls user function after init (user function can
  override init values)

**Key risks:**

- Low risk. Straightforward extension of Phase 5.
- (Added 2026-03-21) **NIL_VALUE fallthrough required.** All generated function bodies
  (including the `onPageEntered` wrapper) must push `NIL_VALUE` before trailing
  `Return` nodes. The VM's `RET` instruction unconditionally pops a return value.
  Phase 5 established this pattern; Phase 6 must follow it for the generated wrapper
  and any compiled `onPageEntered` user function body.
- (Added 2026-03-21) **`onPageEntered` is now inside the descriptor object.** Phase 2
  moved `onPageEntered` from a file-level named export into the `Sensor()`/`Actuator()`
  config object. Phase 6's plan text still references `export function onPageEntered`
  -- the implementation should extract and compile `descriptor.onPageEnteredNode`
  instead.

---

### Phase 7: Linker

**Objective:** Implement the linker that merges `UserAuthoredProgram` functions and
constants into a `BrainProgram`, remapping `CALL` and `PUSH_CONST` operands. Prove the
linked program executes correctly in the VM.

**Packages/files touched:**

- `packages/typescript/src/linker/linker.ts` --
  `linkUserPrograms(brainProgram, userPrograms[])` function
- `packages/typescript/src/linker/linker.spec.ts` -- tests

**Concrete deliverables:**

1. `linkUserPrograms()` appends user functions to `BrainProgram.functions`, remaps
   `CALL` funcId operands (+offset), remaps `PUSH_CONST` indices, merges constants
2. Returns the linked entry funcId for each user program
3. A test that creates a minimal `BrainProgram` + `UserAuthoredProgram`, links them,
   and runs the combined program

**Acceptance criteria:**

- Test: linked program's user function is callable by funcId from brain code
- Test: constant pool indices are correct after merging
- Test: `CALL` to a user helper function resolves correctly in the linked program

**Key risks:**

- Must remap all `PUSH_CONST` instructions in user bytecode, not just in entry
  function -- all helper functions too
- Must handle the case where user programs share no constants (trivial) and where
  they have overlapping constant values (dedup during merge, or just append)
- (Added 2026-03-21) **`lifecycleFuncIds.onPageEntered` must be remapped.** The
  `onPageEntered` wrapper funcId is relative to the user program's function array.
  After linking, the linker must remap it (add the function offset) and return the
  remapped lifecycle funcIds alongside `linkedEntryFuncId`. The wrapper is always
  present (never undefined), so no null-check is needed.

---

### Phase 8: VM dispatch wrapper + registration bridge

**Objective:** Build the `BrainFunctionEntry` exec wrapper that spawns a fiber for
user bytecode, manages callsite-persistent state, and resolves handles. Wire it through
function and tile registration so a brain rule can invoke a user-authored tile
end-to-end. Also build `onPageEntered` dispatch.

**Packages/files touched:**

- `packages/typescript/src/runtime/authored-function.ts` --
  `createUserTileExec(linkedProgram, linkInfo, vm, scheduler)` returning `HostFn`
  with `exec` and `onPageEntered` methods
- `packages/typescript/src/runtime/registration-bridge.ts` --
  `registerUserTile(linkInfo, services)` that performs the three-step registration
  flow: ensure param tile defs, register in `FunctionRegistry`, add to `TileCatalog`
- `packages/typescript/src/runtime/authored-function.spec.ts` -- integration tests

**Prerequisites from earlier phases:**

- `UserTileLinkInfo` from Phase 7 provides `linkedEntryFuncId` and
  `linkedOnPageEnteredFuncId` (already remapped by the linker). The wrapper uses
  these directly -- no offset arithmetic needed.
- The `onPageEntered` wrapper is always generated (Phase 6 decision), so
  `linkedOnPageEnteredFuncId` is always present. The wrapper already calls
  module init internally, so the bridge does not call `initFuncId` separately.
- `UserAuthoredProgram.callDef` is a fully constructed `BrainActionCallDef`
  (Phase 3). The registration bridge passes it directly to
  `functions.register()`.
- `UserAuthoredProgram.numCallsiteVars` gives the size for `callsiteVars`
  allocation.

**Concrete deliverables:**

1. `exec` wrapper function:
   - Retrieves or allocates `callsiteVars` via `getCallSiteState`/`setCallSiteState`
     from `@mindcraft-lang/core/brain` (keyed by `ctx.currentCallSiteId`)
   - On first allocation, creates `List<Value>` of size `numCallsiteVars` filled
     with `NIL_VALUE`, then spawns a fiber for `linkedOnPageEnteredFuncId` to run
     module init
   - Spawns a fiber via `IFiberScheduler.spawn(linkedEntryFuncId, args, ctx)`
   - Attaches `callsiteVars` to the spawned `Fiber`
   - Resolves the handle via `HandleTable` when the spawned fiber completes
2. `onPageEntered` dispatch:
   - Spawns a fiber for `linkedOnPageEnteredFuncId` (the wrapper resets callsite
     vars via module init, then calls user `onPageEntered` if present)
   - Attaches the callsite's `callsiteVars` to the fiber
3. Registration bridge:
   - Ensures parameter tile defs exist (named -> `BrainTileParameterDef` scoped
     to `user.<tileName>.<paramName>`; anonymous -> shared `anon.<type>` with
     auto-creation)
   - Registers `BrainFunctionEntry` via `functions.register(userId, true, fn,
callDef)` -- always async per spec's unified invocation model
   - Creates `BrainTileSensorDef` or `BrainTileActuatorDef` and adds to catalog
4. Integration test: compile a sensor from source -> link into a `BrainProgram` ->
   register via bridge -> invoke from a brain fiber -> verify return value
5. Integration test: same for an actuator

**Acceptance criteria:**

- Test: sync sensor resolves handle within same tick (fiber completes without AWAIT,
  handle resolves immediately)
- Test: callsite vars persist across two invocations of the same tile (second call
  sees state from first call)
- Test: two callsites get independent callsite var state (each
  `ctx.currentCallSiteId` produces its own `callsiteVars`)
- Test: `onPageEntered` dispatch resets callsite vars and runs user body
- Test: registration bridge creates correct `BrainTileSensorDef` / `BrainTileActuatorDef`
  with expected tileId (`tile.sensor->user.<name>` / `tile.actuator->user.<name>`)
- Test: parameter tile defs are registered (named + anonymous)

**Key risks:**

- **Fiber lifecycle and handle resolution.** The `IFiberScheduler.spawn()` API returns
  a fiber ID. Need to subscribe to fiber completion (e.g., via `scheduler.onFiberDone`
  or polling fiber state) to resolve the handle. The exact mechanism depends on what
  `IFiberScheduler` exposes -- check the interface before implementing.
- **`callsiteVars` attachment timing.** The `callsiteVars` list must be attached to
  the `Fiber` before the fiber's first `LOAD_CALLSITE_VAR` instruction executes. Since
  `spawn()` creates the fiber, the attachment must happen between `spawn()` and the
  first `vmDispatch` step.
- **Module init on first allocation.** The very first time a callsite is invoked, the
  `callsiteVars` array is fresh (all `NIL_VALUE`). The module init function must run
  before `onExecute` to set initial values. This can be done by spawning a fiber for
  `linkedOnPageEnteredFuncId` (which calls init) before spawning the `onExecute` fiber,
  or by calling init within the same fiber via a combined wrapper. Check whether
  sequential fiber spawning within a single tick is supported.
- **Type resolution for param tile defs.** The registration bridge maps
  `ExtractedParam.type` strings (e.g., `"number"`) to `TypeId` values for
  `BrainTileParameterDef` construction via `ITypeRegistry.resolveByName()`.

---

### Phase 9: Logical operators (`&&`, `||`, `!`)

**Objective:** Add short-circuit `&&` and `||` operators and unary `!` (boolean NOT)
to the lowering pass.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- add cases for `&&`, `||`, `!`

**Prerequisites:** Null comparisons (`=== null`, `!== null`) and `!nil` are already
handled by Phase 6.5 nil operator overloads. This phase adds only the general-purpose
logical operators.

**Concrete deliverables:**

1. `&&` emits: evaluate LHS, `JumpIfFalse(end)` (short-circuit), `Pop`, evaluate RHS,
   `Label(end)`. The result is the LHS value if falsy, else the RHS value (JS
   semantics).
2. `||` emits: evaluate LHS, `JumpIfTrue(end)` (short-circuit), `Pop`, evaluate RHS,
   `Label(end)`. The result is the LHS value if truthy, else the RHS value.
3. `!` emits: evaluate operand, `HostCallArgs` for the boolean NOT operator
   (`CoreOpId.Not`). The nil-typed `!nil -> true` case is already registered
   (Phase 6.5).

**Acceptance criteria:**

- Test: `true && false` -> `false`
- Test: `false && sideEffect()` -> `false` (side effect not called)
- Test: `false || true` -> `true`
- Test: `true || sideEffect()` -> `true` (side effect not called)
- Test: `!true` -> `false`, `!false` -> `true`
- Test: `0 && 42` -> `0` (JS value-preserving semantics)

**Key risks:**

- **Truthiness semantics.** `JumpIfFalse`/`JumpIfTrue` depend on the VM's truthiness
  rules. Verify that the VM treats `0`, `""`, `false`, and `NIL_VALUE` as falsy and
  everything else as truthy, matching JavaScript semantics. If the VM only checks
  boolean values, a truthiness coercion HOST_CALL may be needed.

---

### Phase 10: String operations

**Objective:** Support string concatenation via `+` and template literal lowering.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- template literal lowering,
  string `+` operator resolution

**Concrete deliverables:**

1. `"hello" + " world"` compiles via the existing binary expression path using the
   string `Add` operator overload (already registered in core for
   `String + String -> String`).
2. Template literals (`` `hello ${name}` ``) desugar to a chain of string
   concatenations: `"hello " + name`. The lowering walks `ts.TemplateExpression`
   child spans and emits `PushConst(headText)` then for each span:
   `lowerExpression(span.expression)`, `HostCallArgs(Add)`, `PushConst(tailText)`,
   `HostCallArgs(Add)`.
3. Tagged template literals are rejected by the validator (already excluded by the
   subset).

**Acceptance criteria:**

- Test: `"a" + "b"` -> `"ab"`
- Test: `` `count: ${n}` `` where n=42 -> `"count: 42"`
- Test: `` `${a}-${b}` `` with multiple spans -> correct concatenation
- Test: empty template literal ` ` ``->`""`

**Key risks:**

- **String + non-string coercion.** TS allows `"hello" + 42`. Need to verify whether
  the core operator overloads handle `String + Number -> String` coercion, or whether
  a `toString` HOST_CALL is needed for the non-string operand.
- **Template literal AST structure.** `ts.TemplateExpression` has a `head`
  (`TemplateHead`) and `templateSpans` array, each with an `expression` and a
  `literal` (either `TemplateMiddle` or `TemplateTail`). The lowering must handle
  all combinations including empty head/tail strings.

---

### Phase 11a: Type registry ambient generation

**Objective:** Build the ambient type generation infrastructure that derives TypeScript
interface declarations from `ITypeRegistry`, distinguishing user-creatable structs
from native-backed structs. This establishes the type foundation that Phase 11b's
object literal compilation depends on.

#### Native-backed vs user-creatable struct types

The core `StructTypeShape` supports two categories of struct types, distinguished by
the presence of runtime hooks:

- **User-creatable structs** (e.g., `Vector2`): No `fieldGetter`, `fieldSetter`, or
  `snapshotNative` hooks. Fields are stored in the `StructValue.v` Dict. User code
  can create instances via object literals (`{ x: 1, y: 2 }`), which compile to
  `STRUCT_NEW` + `STRUCT_SET` (Phase 11b).
- **Native-backed structs** (e.g., `ActorRef`): Have one or more hooks registered.
  The `StructValue.native` field wraps a host object (or lazy resolver function).
  The VM's `GET_FIELD` delegates to `fieldGetter`, `SET_FIELD` delegates to
  `fieldSetter`, and `deepCopyValue` (triggered by assignment) calls `snapshotNative`
  to materialize lazy handles. User code **cannot** create instances of these types
  via object literals -- they can only be received from host functions or sensor
  parameters, because there is no way for user bytecode to provide the `native` handle.

This distinction must be reflected in the ambient type declarations (this phase)
and the compiler's lowering logic (Phase 11b).

**Packages/files touched:**

- `packages/core/src/brain/interfaces/type-system.ts` -- add enumeration method
  (e.g., `entries(): Iterable<[TypeId, TypeDef]>`) to `ITypeRegistry`
  (`resolveByName(name)` already exists)
- `packages/typescript/src/compiler/ambient.ts` -- `buildAmbientFromRegistry(registry)`
  that generates interface declarations for all struct types, `MindcraftTypeMap`
  entries, and a `resolveTypeId` function from the registry (note:
  `ITypeRegistry.resolveByName()` already provides this -- the generator can
  use it directly or wrap it). Native-backed struct
  interfaces must use a private brand (e.g., `readonly __brand: unique symbol`) to
  prevent structural compatibility with object literals, while user-creatable struct
  interfaces are plain and structurally constructable.

**Concrete deliverables:**

1. `ITypeRegistry.entries()` exposes registered types for the generator.
2. `buildAmbientFromRegistry(registry)` generates ambient `.d.ts` content by iterating
   over all registered types:
   - For user-creatable struct types (no hooks): emit a plain interface with typed
     fields, e.g., `interface Vector2 { x: number; y: number; }`.
   - For native-backed struct types (any hook present): emit a branded interface with
     readonly fields, e.g.,
     `interface ActorRef { readonly __brand: unique symbol; readonly id: number; readonly position: Vector2; readonly "energy pct": number; }`.
     The brand prevents object literal assignment. If a `fieldSetter` is registered,
     the corresponding fields may omit `readonly` -- but for v1, treating all
     native-backed fields as readonly is a safe default.
   - For both: add `MindcraftTypeMap` entries mapping the type name to the interface.
   - Returns `ambientSource`. Type resolution uses `ITypeRegistry.resolveByName()`
     which already handles all registered types. Replaces the manual
     `buildAmbientSource(appTypeEntries?)` API.
3. Native-backed struct types are usable as variable and parameter types
   (e.g., `let target: ActorRef = params.target;`). Assignment compiles to
   `STORE_LOCAL` -- the VM's `deepCopyValue` handles `snapshotNative` transparently;
   the compiler does not need to emit special code for this.

**Acceptance criteria:**

- Test: `buildAmbientFromRegistry` generates correct plain interface for a
  user-creatable struct with two fields
- Test: `buildAmbientFromRegistry` generates branded interface for a native-backed
  struct (one with `fieldGetter`)
- Test: `const a: ActorRef = { id: 1, ... }` -> TS type error (brand prevents
  structural match)
- Test: `let target: ActorRef = params.target;` -> compiles successfully to
  `LOAD_LOCAL` / `STORE_LOCAL`

**Key risks:**

- **`ITypeRegistry` changes touch `packages/core`.** Adding `entries()` is a small
  interface change but it affects the core package. Verify that the method can be
  added without breaking the Luau/roblox-ts build.
- **Brand vs opaque type strategy.** The `__brand: unique symbol` pattern is
  well-established in TypeScript for nominal typing, but alternatives exist (e.g.,
  generating the interface as a class declaration, or using `declare const` with a
  branded type alias). The brand approach is preferred because it has no runtime cost
  and prevents accidental structural matches without requiring class machinery.
- **fieldSetter writability.** If a native-backed struct has `fieldSetter` for some
  fields, those fields are writable at runtime. For v1, treating all native-backed
  fields as readonly simplifies the ambient generation. A later phase can refine
  this with per-field writability metadata if needed.

---

### Phase 11b: Object/struct literal compilation

**Objective:** Compile object literal expressions to `STRUCT_NEW` / `STRUCT_SET`
bytecode for user-creatable struct types.

**Prerequisites:** Phase 11a (ambient generation provides struct type declarations
so the TS checker can resolve contextual types for object literals).

**Packages/files touched:**

- `packages/typescript/src/compiler/ir.ts` -- add `IrStructNew`, `IrStructSet` nodes
- `packages/typescript/src/compiler/lowering.ts` -- handle
  `ts.ObjectLiteralExpression`: emit `STRUCT_NEW(typeId)` then for each property
  `PUSH_CONST(fieldName)`, evaluate value, `STRUCT_SET`. Reject object literals
  whose contextual type resolves to a native-backed struct (the brand prevents this
  at the TS type level; the lowering should emit a diagnostic if it reaches this path
  anyway).
- `packages/typescript/src/compiler/emit.ts` -- emit `STRUCT_NEW`, `STRUCT_SET` opcodes

**Concrete deliverables:**

1. `{ x: 1, y: 2 }` compiles to the correct struct construction bytecode when the
   target type is a known user-creatable struct.
2. The lowering infers the struct `TypeId` from the TS checker's contextual type
   (e.g., return type annotation, variable type annotation, or assignment target type).

**Acceptance criteria:**

- Test: `const pos: Vector2 = { x: 1, y: 2 }` -> `STRUCT_NEW(vector2TypeId)` +
  field assignments
- Test: struct as return value -> correct bytecode
- Test: unknown struct type -> compile error

**Key risks:**

- **Type inference for untyped object literals.** If a user writes `const x = { a: 1 }`
  without a type annotation, the compiler cannot determine which struct type to use.
  May need to require explicit type annotations on object literals (consistent with
  the spec's emphasis on typed code), or support structural matching against known
  struct types.
- **Nested struct literals.** `{ pos: { x: 1, y: 2 } }` requires recursive struct
  construction. The inner struct must be constructed before the outer one sets the
  field.

---

### Phase 12: Array/list literals

**Objective:** Compile array literal expressions to `LIST_NEW` / `LIST_PUSH` bytecode.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- handle `ts.ArrayLiteralExpression`
- `packages/typescript/src/compiler/ir.ts` -- add `IrListNew`, `IrListPush` nodes
- `packages/typescript/src/compiler/emit.ts` -- emit `LIST_NEW`, `LIST_PUSH` opcodes

**Concrete deliverables:**

1. `[1, 2, 3]` compiles to `LIST_NEW(typeId)` + three `LIST_PUSH` instructions.
2. The lowering infers the list element `TypeId` from the TS checker's
   contextual/inferred type.
3. Empty array `[]` compiles to `LIST_NEW(typeId)` alone.

**Acceptance criteria:**

- Test: `[1, 2, 3]` -> list with 3 elements, VM reads correct values
- Test: empty array `[]` -> empty list
- Test: array as return value -> correct bytecode
- Test: nested arrays `[[1], [2]]` -> correct nested list construction

**Key risks:**

- **Element type inference.** `[1, 2, 3]` has element type `number`, but the VM's
  `LIST_NEW` requires a `TypeId`. The lowering needs to map the TS element type to
  a VM `TypeId` via `tsTypeToTypeId`. For v1, only primitive-typed arrays may be
  sufficient.
- **Mixed-type arrays.** TypeScript allows `[1, "a", true]` with type
  `(number | string | boolean)[]`. The VM may not support mixed-type lists.
  Reject or handle with a union type.
- (Added 2026-03-21, Phase 11b post-mortem) **`BytecodeEmitter.listNew` has the same
  operand issue as `structNew` had.** The emitter puts `typeId` into `ins.a` but the
  VM's `execListNew` ignores all operands entirely -- it creates a list with hardcoded
  `"list:<unknown>"` typeId. The emitter and/or VM will need to be fixed to propagate
  the typeId, following the same pattern as the `structNew` fix (constant pool index
  in `ins.b` for the typeId string). Alternatively, accept `"list:<unknown>"` for v1
  if typeId is not needed at runtime.
- (Added 2026-03-21, Phase 11b post-mortem) **Contextual type resolution pattern.**
  Phase 11b established `checker.getContextualType()` for struct literal type
  resolution. The same approach works for array literals -- variable type annotations
  and return type annotations provide contextual types. For untyped arrays like
  `[1, 2, 3]`, the inferred element type from the TS checker can be used instead.

---

### Phase 12.1: Mixed-type lists (core `Any` type + `AnyList`)

**Objective:** Introduce a `NativeType.Any` primitive type and a self-describing
`AnyCodec` so that the type system can represent heterogeneous containers. Register an
`AnyList` list type in core whose `elementTypeId` is the new `Any` type. Update the
TypeScript compiler to resolve mixed-type array literals (e.g., `[1, "a", true]`) to
`AnyList`, and lay the groundwork for `typeof` runtime type checks on `Any`-typed
values.

#### Background

Phase 12 established homogeneous list compilation. The core type system currently
requires every `ListTypeShape` to carry a single `elementTypeId`, and the `ListCodec`
delegates to that element type's codec for serialization. This means a list of
`number | string` has no registered type and compilation fails. The VM itself imposes
no element-type constraint -- `LIST_PUSH` accepts any `Value` -- so the limitation is
entirely in the type registry and codec layers.

This phase adds the missing type-system and codec infrastructure so that
heterogeneous lists work end-to-end: registration, serialization, ambient type
generation, and compiler lowering.

#### Design decisions

- **New `NativeType.Any = 9` enum member.** A fresh discriminant is used rather than
  overloading `NativeType.Unknown` (`-1`), which is a sentinel for error/uninitialized
  states and has different semantics.
- **`AnyCodec`** is a tagged codec. It writes a `NativeType` discriminant (one byte)
  before each value, then delegates to the codec for that type. On decode, it reads
  the tag, resolves the corresponding codec, and decodes. **v1 supports only the
  primitive value types:** `Nil`, `Boolean`, `Number`, `String`. Enum, List, Map, and
  Struct support can be added later by extending the tag-dispatch table.
- **`AnyList` is registered in core** (inside `registerCoreTypes()`) so it is
  universally available without app-specific setup. Its `ListTypeShape.elementTypeId`
  points to `CoreTypeIds.Any`.
- **No VM opcode changes.** `LIST_PUSH`, `LIST_GET`, `LIST_SET`, `LIST_LEN` already
  operate on `List<Value>` without element-type checks. The only layers that change
  are the type registry, codec, ambient generation, and the TypeScript compiler.
- **`typeof` for type narrowing** is the plan of record for user code that reads
  elements from an `AnyList`. It is not in scope for this phase but is noted here
  as a planned follow-up. Without it, elements retrieved from an `AnyList` will
  have type `number | string | boolean | null` and users will need type assertions
  or conditional checks that the TS checker understands (e.g., `if (typeof x ===
"number")`). Phase 15 or a later phase should add `typeof` lowering to make
  this feel natural.

**Packages/files touched:**

- `packages/core/src/brain/interfaces/type-system.ts` -- add `Any = 9` to `NativeType`
  enum; update `nativeTypeToString` to return `"any"` for it
- `packages/core/src/brain/interfaces/core-types.ts` -- add `Any` to `CoreTypeNames`
  and `CoreTypeIds`
- `packages/core/src/brain/runtime/type-system.ts` -- add `AnyCodec` class; add
  `addAnyType(name)` method to `TypeRegistry`; add `AnyList` registration inside
  `registerCoreTypes()`
- `packages/core/src/brain/interfaces/type-system.ts` -- add `addAnyType(name): TypeId`
  to `ITypeRegistry`
- `packages/typescript/src/compiler/ambient.ts` -- handle `NativeType.Any` in
  `typeDefToTs()` (emit the union `number | string | boolean | null`); generate
  `type AnyList = ReadonlyArray<number | string | boolean | null>` for the
  `AnyList` type def
- `packages/typescript/src/compiler/lowering.ts` -- update `tsTypeToTypeId()` to
  return `CoreTypeIds.Any` when the TS type is a union of multiple non-null primitive
  types (e.g., `number | string`); update `resolveListTypeId()` fallback: when the
  element type is a multi-member union, resolve to the `AnyList` type
- `packages/typescript/src/compiler/codegen.spec.ts` -- tests

**Concrete deliverables:**

1. `NativeType.Any` exists with value `9`.
   `CoreTypeNames.Any = "any"` and `CoreTypeIds.Any = "any:<any>"`.

2. `AnyCodec` implements `TypeCodec`:
   - `encode(w, value)`: writes the value's `NativeType` tag as a `U8`, then
     delegates to the matching primitive codec (`NilCodec`, `BooleanCodec`,
     `NumberCodec`, `StringCodec`). Throws for unsupported types in v1.
   - `decode(r)`: reads a `U8` tag, dispatches to the matching codec's `decode`.
   - `stringify(value)`: dispatches to the matching codec's `stringify`.
     The codec must be self-contained (no registry dependency at encode/decode time)
     because it needs to work in the Luau transpiled runtime too.

3. `ITypeRegistry.addAnyType(name)` registers a `TypeDef` with
   `coreType: NativeType.Any` and an `AnyCodec` instance.

4. `registerCoreTypes()` calls `typeRegistry.addAnyType(CoreTypeNames.Any)` to
   register the `Any` type, then calls
   `typeRegistry.addListType("AnyList", { elementTypeId: CoreTypeIds.Any })` to
   register the `AnyList` type.

5. `buildAmbientDeclarations()` emits:

   ```
   export type AnyList = ReadonlyArray<number | string | boolean | null>;
   ```

   with a corresponding `MindcraftTypeMap` entry.

6. `tsTypeToTypeId()` returns `CoreTypeIds.Any` when the TS type is a union of
   2+ non-null/undefined types that map to different `NativeType` categories
   (e.g., `number | string` -> `Any`).

7. `resolveListTypeId()` falls back to the `AnyList` type when element-type
   matching produces `CoreTypeIds.Any`. Specifically: after the alias-symbol-first
   lookup fails, the function calls `tsTypeToTypeId(elementType)`. If that returns
   `CoreTypeIds.Any`, scan the registry for a list type whose `elementTypeId` is
   `CoreTypeIds.Any` (i.e., the `AnyList`).

8. Mixed-type array literals compile and execute:
   ```ts
   export default Sensor({
     name: "mixed",
     output: "boolean" as const,
     exec(ctx) {
       const arr: AnyList = [1, "hello", true, null];
       return arr.length > 0;
     },
   });
   ```

**Acceptance criteria:**

- Test: `NativeType.Any` has value `9` and `nativeTypeToString(NativeType.Any)`
  returns `"any"`
- Test: `AnyCodec` round-trips `nil`, `boolean`, `number`, and `string` values
  through encode/decode
- Test: `AnyCodec.stringify` produces correct output for each supported type
- Test: `AnyCodec.encode` throws for unsupported types (e.g., a `StructValue`)
- Test: `registerCoreTypes()` registers `Any` and `AnyList` types (verify via
  `registry.get(CoreTypeIds.Any)` and `registry.resolveByName("AnyList")`)
- Test: `buildAmbientDeclarations()` output includes `AnyList` type alias with
  the correct union element type
- Test: `[1, "hello", true]` compiles to `LIST_NEW(anyListTypeId)` + 3x `LIST_PUSH`
  and executes in the VM, producing a list with 3 elements
- Test: `[1, 2, 3]` (homogeneous) still resolves to `NumberList`, not `AnyList`
  (regression check)
- Test: `tsTypeToTypeId` returns `CoreTypeIds.Any` for `number | string` union type
- Test: empty mixed-type array `[]` with `AnyList` annotation compiles correctly

**Key risks:**

- **`AnyCodec` tag dispatch must be self-contained.** The codec cannot depend on
  `ITypeRegistry` or `getBrainServices()` at encode/decode time because: (a) the
  Luau transpiled runtime may not have the same service wiring, and (b) codecs
  should be pure data transformers. The v1 codec hardcodes dispatchers for Nil,
  Boolean, Number, and String. Extending to Enum/Struct/List/Map later will require
  embedding sub-codecs or a registry reference -- cross that bridge then.
- **Luau transpile compatibility.** The new `NativeType.Any` enum member and
  `AnyCodec` class must transpile correctly to Luau. Verify that the Luau build
  (`npm run build:rbx`) succeeds after changes. The codec uses only primitive
  stream operations (`writeU8`/`readU8`, `writeBool`/`readBool`, etc.) which are
  already supported in the Luau stream implementation.
- **Ambient type union completeness.** The ambient `AnyList` type is emitted as
  `ReadonlyArray<number | string | boolean | null>`. If `AnyCodec` is later
  extended to support Enum, Struct, etc., the ambient type must be updated to
  include those in the union. This coupling should be documented.
- **`deepCopyValue` for `AnyList`.** The current `deepCopyValue` only deep-copies
  `StructValue` instances; all other types (including `ListValue`) are returned
  by reference. This means `AnyList` values share the underlying `List<Value>`
  on assignment. This is the existing behavior for all list types and is not a
  new concern, but worth noting since mixed-type lists may be more commonly
  assigned across variables.
- **Operator overloads on `Any`-typed values.** If a user retrieves an element
  from an `AnyList` and tries to do arithmetic (`elem + 1`), the compiler needs
  to resolve the operator. Since the TS type will be
  `number | string | boolean | null`, the checker will flag errors for operations
  not valid on all union members. This is correct behavior -- users must narrow
  first. No additional work needed here.
- **Core build order.** `packages/core` must be built before `packages/typescript`.
  Since `registerCoreTypes()` is in core, the `AnyList` type will exist before
  the compiler runs. The compiler's test suite creates its own type registry, so
  tests need to register `Any` and `AnyList` manually in the test setup.

**See also:** [core-type-system-evolution.md](core-type-system-evolution.md) -- a
broader plan for core type system changes (nullable types, generic type constructors,
union types, first-class functions, structural subtyping) that build on Phase 12.1's
`Any` type. These are planned for implementation after the TypeScript compiler phases
are complete.

---

### Phase 12b: Map literals

(Updated 2026-03-23: revised to use generic type constructors from core type system
revision (Phase 2))

**Objective:** Compile object literal expressions to `MAP_NEW` / `MAP_SET` bytecode when
the contextual type resolves to a Map type (`Record<string, T>`) rather than a Struct.

Phase 11b handles object literals whose contextual type is a struct. This phase handles
the other case: object literals whose contextual type is a map. They use the same TS
syntax (`{ key: value }`) but produce different opcodes.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- extend `lowerObjectLiteral` to
  detect map-typed contextual types and emit `IrMapNew` / `IrMapSet` instead of
  `IrStructNew` / `IrStructSet`; add `resolveMapTypeId()` helper following the same
  pattern as `resolveListTypeId()` -- alias-symbol-first lookup, then fall back to
  `registry.instantiate("Map", [valueTypeId])` using the generic `MapConstructor`
  from core type system revision (Phase 2)
- `packages/typescript/src/compiler/ir.ts` -- add `IrMapNew` (with `typeId`),
  `IrMapSet` nodes
- `packages/typescript/src/compiler/emit.ts` -- emit `MAP_NEW`, `MAP_SET` opcodes

**Concrete deliverables:**

1. `const m: Record<string, number> = { foo: 1, bar: 2 }` compiles to
   `MAP_NEW(typeId)` + two `MAP_SET` instructions (key as `PushConst(string)`,
   value as `PushConst(number)`).
2. Empty map `const m: SomeMapType = {}` compiles to `MAP_NEW(typeId)` alone.
3. Map as return value or function argument compiles correctly via contextual type.
4. The lowering distinguishes map vs struct by checking whether the contextual type
   resolves to a `MapTypeDef` (via `NativeType.Map` in the registry) before falling
   through to the existing struct path.
5. `resolveMapTypeId()` follows the alias-symbol-first pattern from
   `resolveListTypeId()`: check alias symbol name against the registry first,
   fall back to `registry.instantiate("Map", [valueTypeId])` using `MapConstructor`
   (no scanning needed -- the generic constructor creates the type on demand).

**Acceptance criteria:**

- Test: `{ foo: 1, bar: 2 }` with map-typed annotation -> `MAP_NEW` + 2x `MAP_SET`
- Test: empty map `{}` with map-typed annotation -> `MAP_NEW` only
- Test: map as return value -> correct bytecode
- Test: nested struct-in-map (map values are struct-typed) -> correct nested emission
- Test: object literal with struct contextual type still compiles to `STRUCT_NEW`
  (regression check)

**Key risks:**

- **`MAP_NEW` typeId operand.** The VM's `execMapNew` currently ignores all operands
  and creates maps with hardcoded `"map:<unknown>"` typeId (same issue as `LIST_NEW`
  had in Phase 12). The emitter puts `typeId` into `ins.a` but the VM does not read
  it. Either fix the VM to read the typeId from the constant pool (following the
  `structNew` fix pattern -- constant pool index in `ins.b`), or accept
  `"map:<unknown>"` for v1.
- **Ambiguity between struct and map.** An object literal `{ x: 1, y: 2 }` could be
  either a struct or a map depending on the contextual type. The lowering must check
  map first or struct first consistently. Since struct types have known field names and
  map types accept arbitrary keys, checking struct first (existing code) and falling
  through to map is the natural order.
- **Map keys are always strings.** `MapTypeShape` has `valueTypeId` but no
  `keyTypeId` -- keys are implicitly strings. The lowering should verify that object
  literal keys are string-compatible (identifiers and string literals both work).
- (Added 2026-03-23) **`MapConstructor` available.** `registry.instantiate("Map",
[valueTypeId])` creates map types on demand. Unlike the pre-Phase-2 approach for
  lists (scanning all registered types), maps can be auto-instantiated. The
  `resolveMapTypeId()` helper should use this after alias-symbol lookup fails.

---

### Phase 12c: Enum value literals

(Updated 2026-03-23: simplified since `tsTypeToTypeId()` now resolves named types
including enums via symbol name lookup on the registry -- done in core type system
Phase 2.)

**Objective:** Compile string literal expressions to `EnumValue` constants when the
contextual type resolves to a Mindcraft enum type.

Mindcraft enums are surfaced in ambient declarations as string union types (e.g.,
`type Direction = "north" | "south" | "east" | "west"`). When a user writes `"north"`
and the contextual type is a Mindcraft enum, the compiler must produce an `EnumValue`
constant (`{ t: NativeType.Enum, typeId, v: "north" }`) rather than a plain
`StringValue`. The `ConstantPool` already supports `EnumValue` deduplication.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- extend string literal handling
  to detect enum-typed contextual types and emit `PushConst(EnumValue)` instead of
  `PushConst(StringValue)`. `tsTypeToTypeId()` already resolves named types
  (including enums) via symbol name lookup on the registry, so enum type resolution
  is available. The remaining work is detecting the contextual type via
  `checker.getContextualType()` and checking whether the resolved TypeDef has
  `coreType: NativeType.Enum`.
- `packages/typescript/src/compiler/ambient.ts` -- no changes needed (enum types
  are already generated as string unions with `MindcraftTypeMap` entries)

**Concrete deliverables:**

1. `const d: Direction = "north"` compiles to `PushConst(EnumValue("north", directionTypeId))`.
2. Passing an enum value as a function argument compiles correctly via contextual type
   (e.g., `setDirection("north")` where the parameter type is `Direction`).
3. Returning an enum value from a sensor compiles correctly.
4. The lowering detects enum types by resolving the contextual type's symbol name
   against the type registry via the existing `tsTypeToTypeId()` path and checking
   for `NativeType.Enum` on the resulting TypeDef.
5. Invalid enum values (string literals not in the enum's symbol list) are caught
   by TypeScript's own type checking (the string union type rejects unknown values),
   so no additional validation is needed in the lowering.

**Acceptance criteria:**

- Test: `"north"` with enum-typed annotation -> `PushConst` with `EnumValue`
  (not `StringValue`)
- Test: enum value as function argument -> correct `EnumValue` constant
- Test: enum value as return value -> correct `EnumValue` constant
- Test: plain string literal without enum context -> still produces `StringValue`
  (regression check)
- Test: `tsTypeToTypeId` returns correct `TypeId` for enum types (already works for
  named types -- this test verifies it for enum-typed expressions specifically)

**Key risks:**

- **Contextual type detection for string literals.** A string literal like `"north"`
  has TS type `"north"` (a string literal type). The lowering must use
  `checker.getContextualType()` to determine if the expected type is an enum, not
  just inspect the literal's own type. Without contextual type, the literal compiles
  as a plain string -- this is correct for non-enum contexts.
- **String union vs enum ambiguity.** TypeScript string unions and Mindcraft enum
  types look identical in the ambient declarations. The lowering must resolve the
  union type's alias symbol name against the type registry to determine if it is a
  Mindcraft enum. If the alias symbol is not found in the registry, it is a plain
  string union and the literal should compile as a `StringValue`.
- **Enum comparisons.** After this phase, enum values on the stack are `EnumValue`
  typed. Comparison operators (`===`, `!==`) between enum values may need enum-aware
  operator overloads (comparing `typeId` + `v`). Check whether the existing `EqualTo`
  operator handles `EnumValue` correctly, or if new overloads are needed. This may
  need to be deferred to a follow-up if the operator infrastructure does not support
  enum comparisons yet.

---

### Phase 13: Property access chains + host calls

(Updated 2026-03-24: Phase 13 complete. GET_FIELD for struct property access
accepted. The ctx compile-time phantom approach was replaced by ctx-as-native-struct
(implemented out of band). Context, SelfContext, and EngineContext are now
native-backed structs. Struct method dispatch (`lowerStructMethodCall()`) handles
`ctx.self.getVariable()`, `ctx.engine.*()`, and any other struct with declared
methods. All phantom code has been removed. See
[ctx-as-native-struct.md](ctx-as-native-struct.md) and Phase Log entry below.)

(Updated 2026-03-24: `lowerPropertyAccess()` handles `.length` on list-typed
expressions (core type system detour). `tsTypeToTypeId()` resolves struct types
via symbol name lookup (core type system Phase 2). `IrListLen` IR node exists.
GET_FIELD for struct fields is implemented. Struct method dispatch via
`lowerStructMethodCall()` handles `ctx.engine.*` and `ctx.self.*` method calls.
ctx is now a real parameter at local slot 0 via ctx-as-native-struct.)

**Objective:** Compile property access chains (e.g., `ctx.self.position.x`) to `GET_FIELD`
instructions, and context method calls (e.g., `ctx.engine.queryNearby(pos, range)`)
to `HOST_CALL_ARGS` instructions. This is the gateway to the full `Context` API.

**Prerequisite:** Phase 11a's ambient-from-registry work must be complete so the compiler
knows field layouts of struct types. Method resolution uses `StructMethodDecl` on type
definitions and the `"TypeName.methodName"` convention in the FunctionRegistry.
(Updated 2026-03-24: method resolution via struct method dispatch is implemented.)

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- extend `lowerPropertyAccess`
  beyond the current `params.xyz` and `.length` special cases; add
  `lowerStructMethodCall` for struct method dispatch (handles `ctx.self.*()`,
  `ctx.engine.*()`, and any struct with declared methods). The `.length` case
  already emits `IrListLen` (done in core type system detour). The `params.xyz`
  case already short-circuits to `LoadLocal`. The new work is: (a) `GET_FIELD` for
  struct-typed property access, (b) struct method call dispatch via
  `lowerStructMethodCall()`
  (Updated 2026-03-24: method dispatch uses the general-purpose
  `lowerStructMethodCall()` mechanism, not a ctx-specific path.)
- `packages/typescript/src/compiler/ir.ts` -- add `IrGetField` node (field name
  operand). Note: `IrListLen`, `IrListGet`, `IrListSet` already exist from the
  core type system detour
- `packages/typescript/src/compiler/emit.ts` -- emit `GET_FIELD` opcode
- `packages/typescript/src/compiler/types.ts` -- no changes needed;
  `resolveHostFn` was removed in Phase 10. Method-to-host-function resolution
  uses the `"TypeName.methodName"` convention in FunctionRegistry

**Concrete deliverables:**

1. `obj.field` compiles to `lowerExpression(obj)` + `GET_FIELD("field")` for known
   struct-typed expressions. This works uniformly for both user-creatable and
   native-backed struct types -- the VM dispatches to `fieldGetter` when present;
   the compiler does not need to distinguish. `tsTypeToTypeId()` already resolves
   struct types via symbol name lookup (core type system Phase 2), so the lowering
   can identify struct-typed expressions to emit `GET_FIELD`.
2. `ctx.engine.methodName(args)` compiles to pushing the struct, then args, then
   `HOST_CALL_ARGS("EngineContext.methodName", argc+1)` via `lowerStructMethodCall()`.
   The struct value is the first argument. The function is resolved via
   `getBrainServices().functions.get("EngineContext.methodName")`.
   (Updated 2026-03-24: method dispatch uses the general-purpose struct method call
   mechanism, not a ctx-specific path.)
3. `ctx.self.getVariable("x")` and `ctx.self.setVariable("x", v)` compile to
   `HOST_CALL_ARGS("SelfContext.getVariable", 2)` and
   `HOST_CALL_ARGS("SelfContext.setVariable", 3)` respectively, with the SelfContext
   struct as the first argument.
   (Updated 2026-03-24: uses struct method dispatch, same as EngineContext methods.)
4. `ctx.time`, `ctx.dt`, `ctx.tick` compile to `LoadLocal(0); GetField("time")` etc.
   The ctx parameter occupies local slot 0 as a real `StructValue`.
   (Updated 2026-03-24: ctx is a real value, not a compile-time phantom.)
5. The current `lowerPropertyAccess` special cases for `params.xyz` (-> `LoadLocal`)
   and `.length` on list-typed expressions (-> `IrListLen`) are preserved.

**Acceptance criteria:**

- Test: `ctx.self.getVariable("x")` -> correct `HOST_CALL_ARGS` emission
- Test: struct property chain `pos.x` -> `GET_FIELD("x")`
- Test: native-backed struct field `target.position` -> `GET_FIELD("position")`
  (same bytecode as user-creatable struct; VM handles dispatch)
- Test: `ctx.engine.queryNearby(pos, 5)` -> `HOST_CALL_ARGS` with 3 args (struct + 2)
  (Updated 2026-03-24: argc includes the struct value as the first argument.)
- Test: unknown method `ctx.engine.nonExistent()` -> compile error
- Test: `params.speed` still resolves to `LoadLocal` (regression check)
- Test: `items.length` still resolves to `IrListLen` (regression check)

**Key risks:**

(Updated 2026-03-24: All three risks below are resolved. ctx is now a real parameter
at local slot 0; struct method dispatch uses `lowerStructMethodCall()` which checks
the receiver's struct type for matching methods; property access vs method call is
handled by the call expression check in `lowerCallExpression()` before
`lowerPropertyAccess()` runs.)

- **`ctx` parameter identity.** RESOLVED. ctx occupies local slot 0. The lowering
  does not need special ctx tracking -- it is a regular struct-typed parameter.
  `lowerPropertyAccess()` resolves the struct type via `resolveStructType()` and
  emits `GET_FIELD`. `lowerStructMethodCall()` checks the `methods` list on the
  struct type definition.
- **Property access vs method call ambiguity.** RESOLVED. `lowerCallExpression()`
  checks for `PropertyAccessExpression` callees and dispatches to
  `lowerStructMethodCall()` before falling through to `lowerPropertyAccess()`.
- **Call site IDs.** `HOST_CALL_ARGS` hardcodes `callSiteId: 0`. Real call site ID
  allocation is deferred to a later async-related phase.

---

### Phase 14: `for...of` loop

(Updated 2026-03-23: significantly simplified. `IrListLen`, `IrListGet` IR nodes
already exist and are emitter-verified from the core type system detour (list/array
method support). Element access lowering (`arr[i]`) is already working. `allocLocal()`
for hidden temporaries is available on `ScopeStack`. `tsTypeToTypeId()` resolves named
types including list types via `resolveListTypeId()`. The remaining work is the
`for...of` desugaring itself -- all underlying infrastructure is in place.)

**Objective:** Compile `for...of` loops over list-typed values.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- handle `ts.ForOfStatement`,
  emit iterator pattern using the existing `IrListLen`, `IrListGet` IR nodes and
  `allocLocal()` for hidden temporaries. The desugaring below uses only
  infrastructure that is already built and verified.

**Concrete deliverables:**

1. `for (const item of items) { ... }` desugars to:
   ```
   StoreLocal(listLocal)        // items (via allocLocal)
   PushConst(0)
   StoreLocal(indexLocal)       // i = 0 (via allocLocal)
   Label(loopStart)
   LoadLocal(indexLocal)
   LoadLocal(listLocal)
   IrListLen                    // items.length (already exists)
   HostCallArgs(LessThan)       // i < items.length
   JumpIfFalse(loopEnd)
   LoadLocal(listLocal)
   LoadLocal(indexLocal)
   IrListGet                    // items[i] (already exists)
   StoreLocal(itemLocal)        // const item = items[i]
   <body>
   Label(continueTarget)
   LoadLocal(indexLocal)
   PushConst(1)
   HostCallArgs(Add)            // i + 1
   StoreLocal(indexLocal)
   Jump(loopStart)
   Label(loopEnd)
   ```
2. `break` and `continue` within `for...of` work via the existing loop stack.

**Acceptance criteria:**

- Test: `for (const x of [1, 2, 3]) { sum += x; }` -> sum is 6
- Test: `for...of` with `break` -> exits early
- Test: `for...of` with `continue` -> skips iteration
- Test: `for...of` over empty list -> body never executes

**Key risks:**

- **List type detection.** The iterable expression must resolve to a list-typed
  value. `resolveListTypeId()` already handles this via `instantiate("List", [elemTypeId])`.
  The lowering must verify the expression type is list-typed before emitting the
  iterator pattern; non-list types should produce a compile error.
- **Hidden locals.** The desugaring introduces hidden local variables (index counter,
  list reference). These are allocated via `allocLocal()` on `ScopeStack` (available
  since the core type system detour) and are not visible to the user as named
  variables.

---

### Phase 15: Ternary operator + nullish coalescing

(Updated 2026-03-24: implemented. The spec's suggested `??` pattern using
`PushConst(NIL_VALUE)` + `HostCallArgs(EqualTo, nil)` was incorrect -- the nil-nil
EqualTo overload always returns true regardless of runtime value. The correct
approach uses `TypeCheck(NativeType.Nil)` for runtime nil detection. See Phase Log.)

(Updated 2026-03-23: nullable type support is now fully implemented in core type
system Phase 1. `expandTypeIdMembers()` replaces the old `unwrapNullableTypeId()`.
The `??` operator can leverage the existing nil-equality operator overloads and the
DUP-before-conditional-jump pattern from Phase 9.)

**Objective:** Compile conditional expressions (`? :`) and nullish coalescing (`??`).

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- handle
  `ts.ConditionalExpression` and nullish coalescing (`??`)

**Prerequisites from earlier phases:** Nullable type support is fully implemented
(core type system Phase 1: `NullableCodec`, `addNullableType()`, `TypeDef.nullable`,
`expandTypeIdMembers()`). The nil operator overloads for `==`/`!=` are registered.
`??` emission can test the LHS against nil using the nil-equality check pattern.
(Updated 2026-03-21) The DUP-before-conditional-jump pattern is confirmed working
in Phase 9 (`&&`/`||`). The `??` pattern should follow the same structure but use
nil-specific checks instead of truthiness.

**Concrete deliverables:**

1. `cond ? a : b` compiles to: evaluate cond, `JumpIfFalse(elseLabel)`, evaluate a,
   `Jump(endLabel)`, `Label(elseLabel)`, evaluate b, `Label(endLabel)`.
2. `x ?? fallback` compiles to: evaluate x, `Dup`, check nil (via EqualTo nil
   operator or JumpIfTrue for non-nil), short-circuit or evaluate fallback.

**Acceptance criteria:**

- Test: `true ? 1 : 2` -> 1
- Test: `false ? 1 : 2` -> 2
- Test: `null ?? 42` -> 42
- Test: `5 ?? 42` -> 5
- Test: nested ternary `a ? b ? 1 : 2 : 3` -> correct evaluation

**Key risks:**

- **`??` vs `||` semantics.** `??` only triggers on `null`/`undefined` (nil), not on
  `0` or `""`. If using `JumpIfFalse`, the semantics are wrong (it would trigger on
  `0` and `""`). Must use nil-specific check, not truthiness. Consider emitting:
  `Dup`, `PushConst(NIL_VALUE)`, `HostCallArgs(EqualTo, nil)`, `JumpIfFalse(keep)`,
  `Pop` (discard nil), evaluate fallback, `Jump(end)`, `Label(keep)`, `Label(end)`.
  The nullable type infrastructure (core type system Phase 1) ensures the type system
  correctly tracks nullable types through the `??` expression -- the LHS type is
  `T | null` and the result type is `T`.

---

### Phase 16: Destructuring

(Updated 2026-03-23: `IrListGet` already exists and is emitter-verified from the
core type system detour. Array destructuring can use it directly. Object destructuring
depends on Phase 13's `IrGetField` / `GET_FIELD`. Nullable type support from core
type system Phase 1 is available for default value nil-checks.)

**Objective:** Support simple object and array destructuring in variable declarations.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- handle `ts.ObjectBindingPattern`
  and `ts.ArrayBindingPattern` in variable declarations. Array destructuring uses
  the existing `IrListGet` node. Object destructuring uses `IrGetField` from Phase 13.

**Concrete deliverables:**

1. `const { x, y } = pos;` desugars to: evaluate `pos`, then for each binding
   `Dup`, `GET_FIELD("x")`, `StoreLocal(x_idx)`, etc. Final `Pop` to discard the
   source object. (Depends on Phase 13's `IrGetField`.)
2. `const [a, b] = arr;` desugars to: evaluate `arr`, then `Dup`,
   `PushConst(0)`, `IrListGet`, `StoreLocal(a_idx)`, `Dup`, `PushConst(1)`,
   `IrListGet`, `StoreLocal(b_idx)`, `Pop`. (`IrListGet` already exists from the
   core type system detour.)
3. Nested destructuring is rejected for v1 (validation error).
4. Rest patterns (`...rest`) are rejected for v1.

**Acceptance criteria:**

- Test: `const { x, y } = { x: 1, y: 2 }` -> `x === 1`, `y === 2`
- Test: `const [a, b] = [10, 20]` -> `a === 10`, `b === 20`
- Test: nested destructuring -> validation error
- Test: destructuring with default value `const { x = 5 } = obj` -> uses default
  when field is nil

**Key risks:**

- **Default values in destructuring.** `const { x = 5 } = obj` requires nil-checking
  the destructured value and substituting the default. This adds complexity. Could
  defer defaults to a later phase and implement only simple destructuring first.
  (Updated 2026-03-24) Phase 15 showed that `TypeCheck(NativeType.Nil)` is the
  correct runtime nil-detection primitive -- use it for default value nil-checks
  rather than EqualTo operator overloads.
- **Destructuring patterns in parameters.** `function f({ x, y }: Point)` would
  require handling binding patterns in function parameter positions. Scope to
  variable declarations only for v1.

---

### Phase 17: ~~Arrow functions as helpers~~ SUPERSEDED

(Updated 2026-03-23: this phase is entirely superseded by core type system Phases 5
and 6 (function references + closures). Arrow functions and function expressions --
including those that capture outer scope variables -- are fully compiled as closure
function entries with `MAKE_CLOSURE` / `LOAD_CAPTURE` opcodes. The original Phase 17
plan only handled the non-closure case and rejected closures with a diagnostic. The
core type system work went further and implemented full closure support with
capture-by-value semantics.

What was delivered by the core type system work:

- Arrow functions with expression and block bodies compile to `FunctionBytecode` entries
- Capture analysis identifies free variables and threads them as captures
- `MAKE_CLOSURE(funcId, captureCount)` creates a `FunctionValue` with bound captures
- `LOAD_CAPTURE(captureIndex)` loads captured values inside the closure body
- `CALL_INDIRECT` dispatches calls through `FunctionValue` references
- Function table registration handles arrow functions in variable initializers
- The linker remaps `FunctionValue` constants and `MAKE_CLOSURE` function IDs

No implementation work remains for this phase. All acceptance criteria from the
original plan are satisfied or exceeded by the closure implementation.)

---

### Phase 18: Async host call emission

(Updated 2026-03-23: no structural changes needed. The core type system added
`FunctionTypeShape` and `getOrCreateFunctionType()` (Phase 7) which can express
async function signatures at the type level, but async host call detection should
still use `getBrainServices().functions.get()` metadata rather than type-level
function signatures. `resolveHostFn` was already noted as removed in Phase 10.)

**Objective:** Detect calls to async host functions and emit `HOST_CALL_ARGS_ASYNC`
instead of `HOST_CALL_ARGS`.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- extend host call lowering to
  check if the target function is async and emit `IrHostCallArgsAsync`
- `packages/typescript/src/compiler/ir.ts` -- add `IrHostCallArgsAsync` node
- `packages/typescript/src/compiler/emit.ts` -- emit `HOST_CALL_ARGS_ASYNC` opcode
  via `emitter.hostCallArgsAsync()`
- `packages/typescript/src/compiler/types.ts` -- no changes needed;
  `resolveHostFn` was removed in Phase 10. Async detection should use
  `getBrainServices().functions.get()` metadata directly

**Prerequisites:** Phase 13 (property access chains + host calls) must be complete
so that `ctx.engine.*` method calls compile. Phase 18 extends the mechanism to
distinguish sync vs async host functions. The ctx-as-native-struct refactor is
complete -- struct method dispatch via `lowerStructMethodCall()` is the mechanism
that emits `HOST_CALL_ARGS`. The async detection should extend this to emit
`HOST_CALL_ARGS_ASYNC` when the registered function is async.
(Updated 2026-03-24: ctx-as-native-struct is now implemented. Struct method
dispatch is the current mechanism for context method calls.)

**Concrete deliverables:**

1. The lowering detects async host functions via
   `getBrainServices().functions.get(fnName)` metadata (e.g., an `isAsync` field on
   the function entry). `resolveHostFn` was removed in Phase 10.
2. When the function entry indicates async, the lowering emits `IrHostCallArgsAsync`
   instead of `IrHostCallArgs`.
3. `emitFunction` emits `HOST_CALL_ARGS_ASYNC` for async IR nodes using
   `emitter.hostCallArgsAsync(fnId, argc, callSiteId)` (already available in core's
   `BytecodeEmitter`).

**Acceptance criteria:**

- Test: calling a sync host function -> `HOST_CALL_ARGS` in bytecode
- Test: calling an async host function -> `HOST_CALL_ARGS_ASYNC` in bytecode
- Test: async function entry metadata is detected correctly through the pipeline

**Key risks:**

- **Function registry metadata.** `resolveHostFn` was removed in Phase 10.
  Async detection depends on the function registry entry having the right metadata.
  Verify that `BrainFunctionEntry` (or equivalent) exposes an `isAsync` flag.
- **Call site ID allocation.** `HOST_CALL_ARGS_ASYNC` requires a meaningful
  `callSiteId` (not hardcoded 0) for per-callsite state management. May need to
  defer proper call site ID allocation to Phase 20 or handle it here.

---

### Phase 19: `await` emission

(Updated 2026-03-23: no structural changes needed from the core type system work.
The `AWAIT` opcode and fiber suspension model are unchanged. Note that `await` on
a user-defined async function (not just host calls) is now theoretically possible
since closures and `CALL_INDIRECT` exist, but this is out of scope -- user-authored
async functions are not supported in v1. Only `await` on async host calls is planned.)

**Objective:** Compile `await` expressions to the `AWAIT` opcode.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- handle `ts.AwaitExpression`:
  lower the operand (which should be a `HOST_CALL_ARGS_ASYNC`), then emit `IrAwait`
- `packages/typescript/src/compiler/ir.ts` -- add `IrAwait` node
- `packages/typescript/src/compiler/emit.ts` -- emit `AWAIT` opcode via
  `emitter.await()` (already available in core's `BytecodeEmitter`)

**Prerequisites:** Phase 18 (async host call emission) must be complete so that the
operand of `await` produces a handle on the stack.

**Concrete deliverables:**

1. `await ctx.engine.moveToward(target, speed)` compiles to
   `HOST_CALL_ARGS_ASYNC(fnId, 2, callSiteId)` + `AWAIT`.
2. The result of `await` is the resolved handle value, left on the stack.
3. `await` on a non-async call produces a compile error.
4. Multiple `await` expressions in a single function body each emit their own
   `AWAIT` instruction.

**Acceptance criteria:**

- Test: single `await` in function body -> `HOST_CALL_ARGS_ASYNC` + `AWAIT` in bytecode
- Test: `const result = await asyncCall()` -> result stored in local after `AWAIT`
- Test: two consecutive `await` calls -> two `AWAIT` instructions
- Test: `await` on sync function call -> compile error

**Key risks:**

- **`await` validation.** Must ensure the operand of `await` is a call expression
  targeting an async host function. The TS checker flags `await` on non-Promise types,
  but the lowering should also validate against the known async host function set.
- **No state machine needed.** The VM fiber model preserves full execution state across
  `AWAIT` (stack, frames, locals, PC). No CPS or generator transformation is required.
  This is a significant simplification, but verify it works correctly with local
  variables and nested scopes across suspension points.

---

### Phase 20: Async `onExecute` compilation

(Updated 2026-03-23: no structural changes needed from the core type system work.
The fiber suspension/resumption model and exec wrapper are independent of the type
system additions. Local variables across `await` points work via the existing
frame/locals model, which is unaffected by the type system changes.)

**Objective:** Compile `async onExecute(ctx, params)` functions with one or more
`await` points. Verify that the fiber correctly suspends and resumes across ticks.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- handle `async` modifier on
  `onExecute` (the `descriptor.execIsAsync` flag is already extracted)
- Integration tests exercising async execution

**Prerequisites:** Phases 10a and 10b must be complete. Phase 8 (exec wrapper) must
handle async fiber lifecycle (handle pending, fiber suspension, resumption, completion).

(Added 2026-03-21, from Phase 8 post-mortem) **Async dispatch strategy.** Phase 8's
exec wrapper uses `vm.spawnFiber()` + `vm.runFiber()` for inline synchronous execution.
This will not work for async tiles -- `vm.runFiber()` returns when the fiber hits AWAIT,
but the handle remains pending until the fiber resumes and completes in a later tick.
Phase 20 must implement a different dispatch path: either integrate with the scheduler
(`scheduler.spawn()` or equivalent), use a polling/callback pattern to detect fiber
completion, or extend the exec wrapper to detect `VmStatus.WAITING` and defer handle
resolution. The exec wrapper already receives `scheduler` as a parameter.

**Concrete deliverables:**

1. An async actuator like the following compiles and executes:
   ```typescript
   export default Actuator({
     name: "patrol",
     async onExecute(ctx: Context, params: { speed: number }): Promise<void> {
       await ctx.engine.moveToward(target, params.speed);
       await ctx.engine.moveToward(origin, params.speed);
     },
   });
   ```
2. The function body compiles linearly (no state machine transformation) with
   `HOST_CALL_ARGS_ASYNC` + `AWAIT` at each suspension point.
3. Local variables survive across `await` points (verified by test).
4. Callsite-persistent variables are accessible before and after `await`.

**Acceptance criteria:**

- Test: async actuator with one `await` -> fiber suspends, handle resolves on
  completion
- Test: local variable assigned before `await`, read after -> correct value
- Test: callsite var modified before `await`, read after -> correct value
- Test: async sensor returning a value after `await` -> handle resolves with
  return value

**Key risks:**

- **Fiber suspension/resumption test infrastructure.** Integration tests need a way
  to simulate async handle resolution (mock a host function that returns a pending
  handle, advance the scheduler, resolve the handle, verify the fiber resumes).
  This test infrastructure may need to be built alongside the tests.
- **Void return for async actuators.** Async actuators return `Promise<void>`. The
  compiled bytecode must push `NIL_VALUE` before `RET` (matching the existing
  NIL_VALUE fallthrough pattern from Phase 5).

---

### Phase 21: Async end-to-end integration

(Updated 2026-03-23: no structural changes needed. The core type system work does not
affect the async integration test strategy. Note: the recompile-and-update pathway
mentioned below may benefit from the expanded type system -- if a tile is updated and
its function signatures change, the linker must re-resolve function type IDs. This is
a minor concern for this phase.)

**Objective:** Full integration test: compile an async actuator from source, link it
into a `BrainProgram`, register it via the registration bridge (Phase 8), invoke it
from a brain rule with a WHEN condition, and verify the full lifecycle:
spawn -> suspend -> resume -> complete -> handle resolve.

**Packages/files touched:**

- Integration test file(s) in `packages/typescript/src/runtime/`
- May require test utilities for mock async host functions

**Concrete deliverables:**

1. End-to-end test: brain rule with WHEN condition using a sync sensor -> DO action
   using an async actuator -> actuator suspends at `await` -> handle resolves on next
   tick -> rule completes
2. Test verifies: correct fiber states (READY -> RUNNING -> WAITING -> RUNNING ->
   COMPLETED), handle lifecycle (PENDING -> RESOLVED), callsite var persistence
   across suspension

**Acceptance criteria:**

- Test: async actuator invoked from brain rule -> completes after handle resolution
- Test: sync sensor + async actuator in same rule -> correct interleaving
- Test: cancellation (page deactivation) during suspended async fiber -> fiber
  transitions to CANCELLED

(Added 2026-03-21, from Phase 8 post-mortem) **Recompile-and-update pathway.** The
registration bridge (`registerUserTile`) currently handles first-registration only.
`FunctionRegistry.register()` and `TileCatalog.registerTileDef()` both throw on
duplicate names. A stateless recompile-and-update pathway should be established in
this phase (or an earlier one) so the caller does not need to track whether a prior
registration exists. The bridge should detect whether the tile is already registered
and update the existing `BrainFunctionEntry.fn` closure rather than re-registering.
Include tests for the update path.

**Key risks:**

- **Brain compilation integration.** The brain compiler emits `HOST_CALL_ASYNC` for
  tiles registered as async. Need to verify that the brain-level HOST_CALL_ASYNC
  dispatches correctly to the user tile's exec wrapper (Phase 8), which spawns a
  child fiber.
- **Scheduler tick semantics.** Multiple fibers (brain rule fiber + user code fiber)
  interleave within the scheduler. Need to verify budget accounting treats user fibers
  the same as built-in fibers.

---

### Phase 22: Debug metadata types

(Updated 2026-03-23: the expanded IR node set from the core type system work
(IrListGet, IrListSet, IrListLen, IrSwap, IrTypeCheck, IrPushFunctionRef,
IrCallIndirect, IrMakeClosure, IrLoadCapture, IrStructAssignCheck) does not affect
the debug metadata type definitions -- these are bytecode-level concerns, and the
debug metadata operates at the source-span and scope level. However, closure functions
generate synthetic names like `<closure#N>` which should be reflected in
`DebugFunctionInfo.name` when populating metadata in Phase 25.)

**Objective:** Define the `DebugMetadata` type hierarchy in
`@mindcraft-lang/typescript` (mirroring the structures defined in the
[debugger spec, section 6](vscode-authoring-debugging.md#6-debug-metadata)) and add
the `debugMetadata` field to `UserAuthoredProgram`.

**Packages/files touched:**

- `packages/typescript/src/compiler/types.ts` -- add `DebugMetadata`,
  `DebugFileInfo`, `DebugFunctionInfo`, `Span`, `ScopeInfo`, `LocalInfo`,
  `CallSiteInfo`, `SuspendSiteInfo` interfaces
- `packages/typescript/src/compiler/types.ts` -- add optional `debugMetadata` field
  to `UserAuthoredProgram`

**Concrete deliverables:**

1. All debug metadata interfaces defined per the debugger spec.
2. `UserAuthoredProgram.debugMetadata?: DebugMetadata` field added.
3. No functional changes -- metadata population is Phases 23-25.

**Acceptance criteria:**

- Types compile without errors
- Existing tests continue to pass (field is optional)

**Key risks:**

- Low risk. Type-only changes.

---

### Phase 23: Source span tracking

(Updated 2026-03-23: the expanded IR node set from the core type system work adds
new nodes that need source span annotations: `IrListGet`, `IrListSet`, `IrListLen`,
`IrSwap`, `IrTypeCheck`, `IrPushFunctionRef`, `IrCallIndirect`, `IrMakeClosure`,
`IrLoadCapture`, `IrStructAssignCheck`. All of these follow the same IR node base
pattern and will naturally carry `sourceSpan` when the optional field is added.
No structural changes to the span tracking approach are needed.)

**Objective:** Track source spans during lowering and build `pcToSpanIndex` during
emission so every bytecode instruction maps back to a source location.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- annotate IR nodes with source
  position info (TS AST node start/end positions)
- `packages/typescript/src/compiler/ir.ts` -- add optional `sourceSpan` field to
  IR node base
- `packages/typescript/src/compiler/emit.ts` -- build `pcToSpanIndex` array and
  `spans` list as instructions are emitted; set `isStatementBoundary` per the rules
  in the spec (expression statements, conditions, variable declarations with init,
  return statements, break/continue, await/resume)

**Concrete deliverables:**

1. Every IR node carries an optional `sourceSpan` with `{ start, end, line, column }`
   from the TS AST node.
2. The emit pass builds `spans: Span[]` and `pcToSpanIndex: number[]` for each
   function.
3. Statement boundary rules are applied per the debugger spec's table.
4. `DebugFunctionInfo.spans` and `DebugFunctionInfo.pcToSpanIndex` are populated.

**Acceptance criteria:**

- Test: compiled function's `pcToSpanIndex` has an entry for every PC
- Test: statement boundaries are set for expression statements, `if` conditions,
  loop conditions, `return`, `break`/`continue`
- Test: sub-expression PCs have `isStatementBoundary: false`
- Test: generated functions (init, wrapper) have `isGenerated: true`

**Key risks:**

- **IR node annotation overhead.** Adding source spans to every IR node increases
  memory during compilation. Acceptable since compilation is not
  performance-critical.
- **Statement boundary completeness.** Missing a boundary type means the debugger
  cannot pause at that location. Must verify against the spec's table exhaustively.

---

### Phase 24: Scope and variable metadata

(Updated 2026-03-23: closure functions introduce a new scope consideration. Captured
variables (`LOAD_CAPTURE`) have a different storage kind than locals or parameters --
the debug metadata's `LocalInfo.storageKind` should include a `"capture"` option for
variables loaded from a closure's capture list. Additionally, hidden temporaries
allocated via `allocLocal()` (used by list method inlining and for...of desugaring)
should be excluded from debug metadata or marked as compiler-generated.)

**Objective:** Emit `ScopeInfo` and `LocalInfo` metadata describing the scope tree
and variable lifetimes for debugger inspection.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- track scope enter/exit PCs,
  record variable declaration PCs and lifetimes
- `packages/typescript/src/compiler/scope.ts` -- extend `ScopeStack` to record
  scope metadata (kind, parent, start/end PC)

**Concrete deliverables:**

1. Each function's `DebugFunctionInfo.scopes` contains a tree of `ScopeInfo` entries
   (function scope at root, block scopes nested).
2. Each `LocalInfo` records name, slot index, storage kind (`"local"` or
   `"parameter"`), scope ID, and lifetime PC range.
3. Module-level scope for callsite-persistent variables is represented as a
   `"module"` scope.

**Acceptance criteria:**

- Test: function with nested blocks -> correct scope tree
- Test: variable declared in a block -> `lifetimeStartPc`/`lifetimeEndPc` match
  the block's PC range
- Test: parameters have `storageKind: "parameter"`
- Test: callsite vars appear in a `"module"` scope

**Key risks:**

- **PC range tracking.** Scope start/end PCs must be precisely tracked during emission,
  not just during lowering. The emit pass assigns final PCs; the lowering pass only
  knows IR indices. Need a mapping from IR index to emitted PC.

---

### Phase 25: DebugMetadata assembly

(Updated 2026-03-23: closure functions (from core type system Phase 6) generate
additional `FunctionBytecode` entries with synthetic names. The debug metadata assembly
must account for these: (a) closure functions should have `isGenerated: false` since
they correspond to user-written arrow function expressions, (b) `debugFunctionId`
for closures should use a deterministic key like `filePath + "/" + parentFuncName +
"/<closure#N>"`, (c) the linker remaps `MAKE_CLOSURE` function IDs, so
`compiledFuncId` values in debug metadata must be remapped in the same pass.)

**Objective:** Assemble the complete `DebugMetadata` structure from the per-function
metadata collected in Phases 11b-11c and attach it to `UserAuthoredProgram`.

**Packages/files touched:**

- `packages/typescript/src/compiler/compile.ts` -- collect per-function debug info
  from lowering and emission, assemble `DebugMetadata`, set on
  `UserAuthoredProgram.debugMetadata`
- `packages/typescript/src/compiler/emit.ts` -- return debug spans and metadata
  alongside bytecode

**Concrete deliverables:**

1. `DebugMetadata` is fully populated: `files` (single file for v1), `functions`
   (one `DebugFunctionInfo` per `FunctionBytecode`).
2. Generated functions (module init, `onPageEntered` wrapper) have `isGenerated: true`.
3. `callSites` and `suspendSites` are populated (suspend sites only for async
   functions, Phase 10+).
4. The `programRevisionId` on `UserAuthoredProgram` acts as a revision key for
   the debug metadata.

**Acceptance criteria:**

- Test: compiled program's `debugMetadata` has correct file count (1) and function
  count
- Test: `DebugFunctionInfo.compiledFuncId` matches the index in `Program.functions`
- Test: generated functions have `isGenerated: true`
- Test: user-authored functions have `isGenerated: false`

**Key risks:**

- **Metadata correctness across recompilation.** The `debugFunctionId` (stable
  identity) must be deterministic across recompilations of the same source. Use
  `filePath + "/" + functionName` as the format. The `compiledFuncId` (index into
  `Program.functions`) may change on recompilation -- that is expected.
- **Linker remapping of debug metadata.** After linking, `compiledFuncId` values in
  the debug metadata need to be remapped (offset by function base). This may be a
  concern for Phase 7's linker -- either handle it in a sub-phase or as part of 11d.

---

## Suggested First Vertical Slice

The smallest meaningful end-to-end compile target is a **sync sensor with one numeric
parameter, one comparison, and a return**:

```typescript
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "is-close",
  output: "boolean",
  params: {
    distance: { type: "number", default: 5 },
  },
  exec(ctx: Context, params: { distance: number }): boolean {
    return params.distance < 10;
  },
});
```

This forces:

- Virtual file host + TS type checking (Phase 1)
- AST validation + descriptor extraction (Phase 2)
- Parameter access lowering (`params.distance` -> `LoadLocal` or `GetField`)
- Number literal (`10` -> `PushConst`)
- Binary comparison (`<` -> operator HOST_CALL)
- Return statement -> `RET`
- Program assembly -> `UserAuthoredProgram`
- Bytecode verification

It does **not** require: control flow, helper functions, callsite vars,
`onPageEntered`, async, linking, or the exec wrapper. Those are deliberately left out
so the slice stays narrow and provable.

The end-to-end test for this slice:
`compile("...source...") -> program -> new VM(program) -> runFiber(...) -> assert result === TRUE_VALUE`.

This slice spans Phases 1-3 and should be the target of the first runnable demo.
Everything after it is incremental.

---

## Phase Log

Completed phases are recorded here with dates, actual outcomes, and deviations.

### Phase 0 -- 2026-03-20

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                                               | Actual  | Notes                                                                                                                                        |
| --------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`: `typescript` to prod deps, `tsx` devDep, test scripts | Done    | --                                                                                                                                           |
| `tsconfig.json`: add path aliases                                     | Skipped | Already had `@mindcraft-lang/core` path alias. `@mindcraft-lang/core/brain` resolves via the workspace `file:` dep without a separate alias. |
| `src/index.ts`: re-export proving core seam                           | Skipped | Seam proof lives in `core-imports.spec.ts` instead. No reason to add a re-export to the public API.                                          |
| `src/compiler/compile.ts`: stub API                                   | Done    | `CompileDiagnostic`, `CompileResult`, `compileUserTile()`                                                                                    |
| `src/compiler/compile.spec.ts`: one test                              | Done    | --                                                                                                                                           |
| Core types importable                                                 | Done    | Required adding `BytecodeEmitter` and `ConstantPool` exports to `packages/core/src/brain/compiler/index.ts`.                                 |
| `biome.json`                                                          | Added   | Not in planned file list but implied by acceptance criteria. Extends root config.                                                            |

**Extra file:** `src/compiler/core-imports.spec.ts` -- dedicated test for core brain
imports (`Op`, `BytecodeEmitter`, `ConstantPool`, type-only imports for `Program`,
`FunctionBytecode`, `Value`).

**Discoveries:**

1. `BytecodeEmitter` and `ConstantPool` were not exported from `@mindcraft-lang/core/brain`.
   The Current State section was inaccurate -- said "ConstantPool is exported" but it
   was only defined, not re-exported from the barrel. Fixed in this phase.
2. The `Op` enum uses `RET`, not `RETURN`. Future code must use `Op.RET`.
3. The existing `tsconfig.json` paths entry for `@mindcraft-lang/core` already worked.
   Subpath imports (`/brain`) resolve through the workspace `file:` dependency and
   the core package's `exports` map -- no additional tsconfig paths needed.
4. Test runner pattern: `tsx --tsconfig tsconfig.json --test $(find src -name '*.spec.ts')`.
   The `pretest` script runs `npm run build` (full tsc) since the typescript package has
   no platform-specific build steps unlike core's `build:node`.

### Phase 1 -- 2026-03-20

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                                       | Actual | Notes                                                                                                                                         |
| ------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/compiler/virtual-host.ts`: `createVirtualCompilerHost()` | Done   | Includes `resolveModuleNameLiterals` for `"mindcraft"` import resolution.                                                                     |
| `src/compiler/ambient.ts`: hardcoded `mindcraft.d.ts`         | Done   | Ambient module declaration (`declare module "mindcraft"`) with `Context`, `Sensor`, `Actuator`, `ParamDef`, `SensorConfig`, `ActuatorConfig`. |
| `src/compiler/compile.ts`: wire up type checking              | Done   | Uses `ts.createProgram` + `ts.getPreEmitDiagnostics`. Filters diagnostics to user code only.                                                  |
| `src/compiler/compile.spec.ts`: 3 required tests              | Done   | 5 tests total (3 required + line/column info + empty source).                                                                                 |
| Lib `.d.ts` bundled at build time                             | Done   | `scripts/bundle-lib-dts.js` generates `src/compiler/lib-dts.generated.ts`. `prebuild` npm script runs it before `tsc`.                        |

**Additional work (review iteration):**

| Item                         | Notes                                                                                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lazy-loading / chunking      | Lib `.d.ts` content loaded via dynamic `import()` in `initCompiler()`. Vite automatically splits the ~230KB into a separate chunk. `compileUserTile()` stays sync; requires `initCompiler()` to have been called first. |
| `package.json` `exports` map | Added `"."` entry with `types` + `import` conditions for proper bundler resolution.                                                                                                                                     |
| `src/index.ts` re-exports    | Now re-exports `compileUserTile`, `initCompiler`, `CompileDiagnostic`, `CompileResult` from the compiler module.                                                                                                        |
| `apps/sim` integration       | Added `@mindcraft-lang/typescript` as `file:` dep. `bootstrap.ts` calls `initCompiler()` to preload in the background. Vite prod build confirms separate chunk (`lib-dts.generated-*.js`, 231KB).                       |
| Biome fix in generator       | `scripts/bundle-lib-dts.js` now escapes only `${` (not all `$`) in template literals, eliminating `noUselessEscapeInString` warnings.                                                                                   |

**Extra files:**

- `scripts/bundle-lib-dts.js` -- build script that reads `lib.es5.d.ts`,
  `lib.decorators.d.ts`, `lib.decorators.legacy.d.ts` from
  `node_modules/typescript/lib/` and generates a source module with string constants.
- `src/compiler/lib-dts.generated.ts` -- generated file (not committed), contains
  ~5000 lines of embedded lib type definitions.

**Discoveries:**

1. TypeScript 5.7's `lib.es5.d.ts` has `/// <reference lib="decorators" />` and
   `/// <reference lib="decorators.legacy" />` directives. All three files
   (`lib.es5.d.ts`, `lib.decorators.d.ts`, `lib.decorators.legacy.d.ts`) must be
   bundled for type checking to work without errors.
2. The virtual host needs `resolveModuleNameLiterals` for resolving `import ... from
"mindcraft"` to the ambient `.d.ts` file. TypeScript's built-in module resolution
   does not find virtual files on its own.
3. The `"mindcraft"` ambient types use `declare module "mindcraft" { ... }` pattern.
   The `.d.ts` file must be included in `rootNames` passed to `ts.createProgram`
   for the ambient module declaration to be visible.
4. `getDefaultLibFileName` returns a virtual path (`/lib/lib.es5.d.ts`). TypeScript
   resolves `/// <reference lib="..." />` directives relative to this path's directory.
5. Compiler options for the virtual program: `target: ES5`, `module: ES2015`,
   `strict: true`, `noEmit: true`. These are sufficient for Phase 1 type checking.
6. Diagnostics are filtered to `d.file?.fileName === "/user-code.ts"` to avoid
   surfacing internal lib/ambient diagnostics to the user.
7. The generated `lib-dts.generated.ts` file uses template literal strings. Content
   is escaped for backticks, `${` sequences, and backslash characters. Only `${`
   needs escaping (not bare `$`), otherwise Biome reports `noUselessEscapeInString`.
8. The lib `.d.ts` module (~230KB) should be loaded lazily via dynamic `import()` so
   bundlers like Vite automatically split it into a separate chunk. The async
   `initCompiler()` function handles this. Webapps should call it at startup so the
   chunk loads in the background before the user's first compile.
9. The `exports` map in `package.json` is needed for bundlers to resolve the package
   entry point correctly. Use `"types"` + `"import"` conditions under `"."`.

### Phase 2 -- 2026-03-20

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                             | Actual  | Notes                                                                                                                                                                                                         |
| --------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/compiler/validator.ts`: AST validation walker  | Done    | Rejects classes, enums, `var`, `for...in`, `with`, `switch`, generators/`yield`, computed property names, `debugger`, labeled statements, `delete`, regex, dynamic `import()`, decorators, forbidden globals. |
| `src/compiler/descriptor.ts`: descriptor extraction | Done    | Extracts `kind`, `name`, `outputType`, `params`, `onExecuteNode`, `onPageEnteredNode` from the default export object literal.                                                                                 |
| `src/compiler/types.ts`: shared types               | Done    | `CompileDiagnostic` relocated from `compile.ts`. `ExtractedDescriptor`, `ExtractedParam` defined.                                                                                                             |
| Pipeline: parse -> check -> validate -> extract     | Done    | `compileUserTile()` returns `CompileResult` with optional `descriptor`. Stages short-circuit on first failure.                                                                                                |
| `onPageEntered` as named export                     | Changed | Moved inside the `Sensor()`/`Actuator()` descriptor object. See design change below.                                                                                                                          |
| `exec` method name                                  | Changed | Renamed to `onExecute` for consistency with `onPageEntered`. See design change below.                                                                                                                         |

**Design changes from spec:**

1. **`exec` renamed to `onExecute`.** All lifecycle/entry-point methods now share a
   consistent `on*` naming convention: `onExecute`, `onPageEntered`.
2. **`onPageEntered` moved inside the descriptor.** Instead of a separate named export
   (`export function onPageEntered`), it is now an optional method on the
   `Sensor()`/`Actuator()` config object. This keeps all tile behavior in a single
   cohesive unit, simplifies extraction (no separate file-level scan), and gives
   automatic type checking via the `SensorConfig`/`ActuatorConfig` interfaces.
3. **`Promise<T>` ambient declaration.** TypeScript's type checker requires a `Promise`
   constructor declaration for `async` functions even with `target: ES5` and
   `noEmit: true`. Instead of bundling `lib.es2015.promise.d.ts` (which has
   `/// <reference no-default-lib="true"/>` that suppresses `lib.es5.d.ts`), a minimal
   `Promise<T>` interface + constructor was added to `ambient.ts`.

**Test counts:** 24 total (5 type-checking, 7 validation, 9 extraction, 3 core imports).

**Discoveries:**

1. `exec` -> `onExecute` is a better naming convention. The spec used `exec` but
   `onExecute` aligns with `onPageEntered` and any future `on*` lifecycle hooks.
2. `onPageEntered` belongs inside the descriptor object, not as a separate file-level
   export. This is simpler for users, simpler for extraction, and gives TypeScript
   type checking for free via the config interfaces.
3. TypeScript's ES5 target fails on `async` functions unless a `Promise` type is
   globally available. The `lib.es2015.promise.d.ts` file cannot simply be added
   to rootNames because it has `/// <reference no-default-lib="true"/>` which
   suppresses `lib.es5.d.ts`. A minimal ambient declaration is the cleanest fix.
4. `CompileDiagnostic` was relocated from `compile.ts` to `types.ts` to avoid
   duplication. `compile.ts` re-exports it for API compatibility.
5. The validator checks 13 distinct construct categories. It uses a `switch` on
   `SyntaxKind` plus targeted checks for `VariableDeclarationList` flags, call
   expressions with `import` keyword, and forbidden global identifiers.
6. Descriptor extraction handles both property assignment syntax
   (`onExecute: function(...)`) and method declaration syntax (`onExecute(...)`).
7. The `params` representation as `ExtractedParam[]` was a placeholder at time of
   Phase 2 completion. Resolved 2026-03-20: `ExtractedParam[]` maps mechanically
   to a `BrainActionCallDef` via `buildCallDef()`. Named params create per-tile
   parameter tileIds; anonymous params reuse shared `anon.<type>` tile defs
   (auto-registered if missing). See the Phase 3 updated risks and the spec's
   updated Section A and Section C.
8. The `ExtractedDescriptor.onPageEnteredNode` type changed from
   `ts.FunctionDeclaration` to `ts.MethodDeclaration | ts.FunctionExpression |
ts.ArrowFunction` since it now comes from an object literal method rather than
   a file-level function declaration.

### Phase 2.5 -- 2026-03-20

**Status:** Complete. Back-propagated the resolved callDef design into Phase 0-2 code.

**Objective:** The callDef/callSpec/param design was resolved during the Phase 2
post-mortem but the implementation code predated it. This phase updated the existing
Phase 0-2 types, ambient declarations, descriptor extraction, and tests to align
with the design as documented in the spec.

**Changes:**

| File                           | Change                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `src/compiler/types.ts`        | Added `anonymous: boolean` field to `ExtractedParam`.                                                                    |
| `src/compiler/ambient.ts`      | Added `anonymous?: boolean` to `ParamDef`. Made `params` optional on `SensorConfig` and `ActuatorConfig`.                |
| `src/compiler/descriptor.ts`   | Extracts `anonymous` flag from param definitions (boolean literal, defaults to `false`).                                 |
| `src/index.ts`                 | Added `callDef: BrainActionCallDef` and `outputType?: TypeId` to `UserAuthoredProgram`, importing types from core/brain. |
| `src/compiler/compile.spec.ts` | Updated existing param assertions to verify `anonymous: false`. Added tests for anonymous params and omitted `params`.   |

**Test counts:** 26 total (5 type-checking, 7 validation, 11 extraction, 3 core imports).

**No new discoveries.** All changes were mechanical alignment with the already-resolved
design. No spec amendments needed.

### Phase 3 -- 2026-03-20

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                                          | Actual  | Notes                                                                                                                                              |
| ---------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/compiler/ir.ts`: IR node types                              | Done    | `IrPushConst`, `IrLoadLocal`, `IrStoreLocal`, `IrReturn`, `IrPop`, `IrHostCallArgs`, `IrMapGet`.                                                   |
| `src/compiler/lowering.ts`: TS AST -> IR                         | Done    | Handles param preamble (MapValue extraction), binary expressions, literals, return, property access (`params.xyz`).                                |
| `src/compiler/emit.ts`: IR -> FunctionBytecode                   | Done    | Uses `compiler.BytecodeEmitter` + `compiler.ConstantPool` from core (namespace import).                                                            |
| `src/compiler/call-def-builder.ts`: params -> BrainActionCallDef | Done    | Named params -> `user.<tileName>.<paramName>`, anonymous -> `anon.<type>`, optional wrapped.                                                       |
| `src/compiler/compile.ts`: pipeline wiring                       | Done    | `compileUserTile(source, options?)` produces `UserAuthoredProgram`. (Phase 10 removed resolver callbacks; compiler always runs full pipeline.)     |
| `src/compiler/types.ts`: `UserAuthoredProgram`, `CompileOptions` | Done    | `CompileOptions` has `ambientSource`. (Post-Phase 10 cleanup removed `resolveTypeId` -- type resolution now uses `ITypeRegistry.resolveByName()`.) |
| End-to-end VM execution tests                                    | Done    | 10 tests: true/false comparison, number/bool/string literals, arithmetic, metadata, type resolution error, app-defined type, ambient rejection.    |
| `buildCallDef` tests                                             | Done    | 5 tests: empty, required, optional, anonymous, mixed.                                                                                              |
| `descriptor.ts`: extract `anonymous` flag                        | Skipped | Already done in Phase 2.5.                                                                                                                         |
| `ambient.ts`: make params optional, add anonymous                | Skipped | Already done in Phase 2.5.                                                                                                                         |

**Design changes from spec:**

1. **`exec` -> `onExecute` in all test sources.** The spec's example used `exec` but
   Phase 2 renamed it to `onExecute`. All Phase 3 tests use the updated name.
2. **`mapOutputType` replaced by `resolveTypeId` in `CompileOptions`.** The original
   Phase 3 plan did not mention type resolution as a configurable concern. During
   implementation, `mapOutputType` was identified as a hardcoded bottleneck that
   cannot handle app-defined types. It was replaced with an injected
   `resolveTypeId(shortName) -> TypeId | undefined` function in `CompileOptions`,
   with a built-in `coreTypeResolver` fallback for the three primitive types. Unknown
   output types now produce a `CompileDiagnostic` instead of silently passing through.
   (Post-Phase 10 cleanup later removed `resolveTypeId` from `CompileOptions` --
   type resolution now uses `ITypeRegistry.resolveByName()` via `getBrainServices()`.)
3. **`ambientSource` in `CompileOptions`.** The original plan used a hardcoded
   `AMBIENT_MINDCRAFT_DTS` string. The ambient is now generated by
   `buildAmbientSource(appTypeEntries?)` which accepts additional type map entries.
   `SensorConfig.output` and `ParamDef.type` are constrained to
   `MindcraftType = keyof MindcraftTypeMap` -- a string literal union that
   TypeScript validates at authoring time. Apps extend the union by passing entries
   to `buildAmbientSource`.
4. **`buildAmbientSource` exported from package API.** Added to `src/index.ts` so
   consuming apps can generate ambient sources with their custom types.

**Extra files:** None.

**Test counts:** 41 total (10 codegen/VM, 5 buildCallDef, 5 type-checking, 7
validation, 11 extraction, 3 core imports).

**Discoveries:**

1. `BytecodeEmitter` and `ConstantPool` are under the `compiler` namespace export
   from `@mindcraft-lang/core/brain`. Must use `import { compiler } from "..."` then
   `compiler.BytecodeEmitter`, not direct named imports. This was documented in the
   Phase 0 log but the import pattern was not explicit enough.
2. The operator function naming convention is
   `$$op_<opId>_<lhsTypeId>_<rhsTypeId>_to_<resultTypeId>` (e.g.,
   `$$op_lt_number:<number>_number:<number>_to_boolean:<boolean>`). The lowering
   resolves operand types via the TS checker's `ts.Type` flags, not from
   `ExtractedParam.type`.
3. The `onExecute` function takes 1 parameter (a `MapValue` of args keyed by slotId)
   if the descriptor has params, else 0 parameters. The preamble unpacks each param
   into a local: `LOAD_LOCAL 0`, `PUSH_CONST slotId`, `MAP_GET`, `STORE_LOCAL N`.
4. **App-type shape visibility is a deferred concern.** The current
   `buildAmbientSource` can declare type names in the `MindcraftTypeMap` but not their
   structural shapes. For Phase 3 this is fine -- user code only returns primitives.
   **This becomes a hard blocker for Phase 9c (struct literals) and 9e (property
   access chains)** where the compiler must know field layouts to emit `STRUCT_NEW`,
   `STRUCT_SET`, and `GET_FIELD` instructions. The ambient generation must be extended
   to accept full interface declarations before those phases. See the prerequisite
   note added to Phase 9+.
5. `ParamDef.type` strings flow through `call-def-builder.ts` for tileId construction
   but are not validated against the type registry at compile time. The registration
   bridge (not yet built) resolves them to `TypeId`s. For now, invalid param type
   strings are caught only if the TS checker rejects the `MindcraftType` union.
6. `null` literal is not yet supported in lowering (produces "Unsupported expression:
   NullKeyword"). This is fine for Phase 3 scope; resolved in Phase 6.5.

### Phase 4 -- 2026-03-20

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                                            | Actual | Notes                                                                                                                                                        |
| ------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/compiler/lowering.ts`: visitors for `IfStatement`, etc.       | Done   | Refactored from per-function params to unified `LowerContext`. Handles `if`/`else`, `while`, `for`, `break`, `continue`, `Block`, `VariableDeclarationList`. |
| `src/compiler/ir.ts`: `Jump`, `JumpIfFalse`, `JumpIfTrue`, `Label` | Done   | Also added `IrDup` (needed for assignment expressions to leave value on stack).                                                                              |
| `src/compiler/scope.ts`: scope stack                               | Done   | New file. `ScopeStack` with `pushScope`/`popScope`/`declareLocal`/`resolveLocal`.                                                                            |
| Tests                                                              | Done   | 11 new end-to-end tests in `codegen.spec.ts`.                                                                                                                |

**Additional work beyond plan:**

| Item                     | Notes                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assignment expressions   | `=`, `+=`, `-=`, `*=`, `/=` lowering. Not in Phase 4 plan but required by test patterns like `count = count + 1` and `i = i + 1` in loops.                                |
| Prefix/postfix `++`/`--` | Both `i++` and `++i` supported. Required for idiomatic `for (let i = 0; i < n; i++)` loops (acceptance criterion).                                                        |
| Identifier resolution    | `lowerExpression` now resolves bare identifiers via `ScopeStack.resolveLocal()`, not just property-access syntax. Required for local variable reads.                      |
| Trailing `RET`           | Every lowered function body now ends with an unconditional `RET` instruction. Prevents `BytecodeVerifier` errors when jump labels target end-of-function.                 |
| `IrDup` IR node          | Needed for assignment expressions (the assigned value must remain on the stack as the expression result). Not in the plan but necessary for correct expression semantics. |
| `else if` chains         | Naturally falls out of recursive `lowerStatement` on `stmt.elseStatement`. Added a dedicated test with 3 branches.                                                        |

**Test counts:** 52 total (11 Phase 4 control flow, 10 Phase 3 codegen/VM, 5
buildCallDef, 5 type-checking, 7 validation, 11 extraction, 3 core imports).

**Discoveries:**

1. **Trailing `RET` is required.** When an `if`/`else` is the last statement in a
   function and both branches end with `return`, the `Jump(endLabel)` at the end of
   the then-branch targets the instruction after the last emitted instruction. The
   `BytecodeVerifier` rejects this as out-of-bounds. Appending a trailing `RET` at
   the end of every function body fixes this safely (if the function already returned,
   the trailing `RET` is unreachable but harmless).
2. **`LowerContext` is a better architecture than parameter threading.** Phase 3 passed
   `(scope, checker, ir, diags)` as separate function parameters. Phase 4 unified
   these into a `LowerContext` object that also carries the loop stack and label
   counter. This makes adding new lowering context (e.g., function table in Phase 5)
   much cleaner.
3. **Variable slot reuse is deferred.** `ScopeStack` allocates monotonically increasing
   local indices. Slots from popped scopes are not recycled. This wastes a few locals
   in deeply nested code but keeps the implementation simple. Can revisit as an
   optimization if `numLocals` becomes a concern for the VM.
4. **Assignment as expression.** TypeScript assignments are expressions (they have a
   value). The lowering emits `DUP` before `STORE_LOCAL` so the assigned value
   remains on the stack. When an assignment is used as a statement (via
   `ExpressionStatement`), the enclosing `POP` discards this value.
5. **`for` loop `continue` targets the incrementor, not the condition.** The
   `continueLabel` in a `for` loop points to the incrementor expression, not the
   loop-start condition check. This ensures `i++` runs before the next iteration's
   condition test, matching JavaScript semantics.
6. **`null` literal still unsupported.** Carried forward from Phase 3. Resolved in
   Phase 6.5.

### Phase 5 -- 2026-03-21

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                                                | Actual  | Notes                                                                                                                                                                                           |
| ---------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lowering.ts`: handle `FunctionDeclaration`, function calls via `CALL` | Done    | `lowerHelperFunction()` compiles file-level function declarations. `lowerCallExpression()` emits `IrCall` for user-defined functions. `LowerContext` gained `functionTable` and `callsiteVars`. |
| `compile.ts`: two-pass function ID assignment                          | Changed | Single-pass in `lowerProgram()` -- functions are assigned IDs as discovered. See design change below.                                                                                           |
| `emit.ts`: emit multiple `FunctionBytecode` entries                    | Done    | `compile.ts` loops over `programResult.functions` and calls `emitFunction()` for each.                                                                                                          |
| `scope.ts`: distinguish module-level vs function-level scope           | Changed | `scope.ts` unchanged. Module-vs-function distinction handled in `lowering.ts` via `resolveVarTarget()`: locals resolve via `ScopeStack`, callsite vars via `LowerContext.callsiteVars` map.     |
| Module init function generation                                        | Done    | `generateModuleInit()` emits `STORE_CALLSITE_VAR` for each top-level initializer. Appended as final function entry when callsite vars exist.                                                    |

**Design changes from plan:**

1. **Single-pass instead of two-pass function ID assignment.** The plan called for a
   two-pass pattern (first assign IDs, then compile). The implementation uses a
   single-pass: `lowerProgram()` first scans all top-level `FunctionDeclaration` nodes
   to populate the function table (name -> funcId mapping), then compiles all function
   bodies. This achieves the same result -- all function IDs are known before any body
   is compiled -- without a separate compilation pass.
2. **`scope.ts` not modified.** The plan listed `scope.ts` as a touched file for
   distinguishing module-level scope from function-level scope. Instead, the
   distinction is handled entirely in `lowering.ts` via the `resolveVarTarget()`
   function, which checks `ScopeStack` first (function locals), then
   `LowerContext.callsiteVars` (module-level persistent state). Each function body
   gets its own fresh `ScopeStack`, while `callsiteVars` is shared across all
   functions in the `LowerContext`. This keeps `ScopeStack` as a simple
   single-concern class.
3. **Function ID ordering.** The implemented ordering is: 0 = `onExecute`, 1..N =
   helper functions (in declaration order), N+1 = module init (if needed). This
   differs from `BrainCompiler`'s pattern but is correct for user-authored programs
   where `onExecute` is always the entry point.

**Additional work beyond plan:**

| Item                                | Notes                                                                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `IrCall` IR node                    | New IR node with `funcIndex` and `argc` fields. Not explicitly listed in the plan's file list but required for the `CALL` instruction emission.                         |
| `IrLoadCallsiteVar` IR node         | New IR node with `index` field. Required for `LOAD_CALLSITE_VAR` emission.                                                                                              |
| `IrStoreCallsiteVar` IR node        | New IR node with `index` field. Required for `STORE_CALLSITE_VAR` emission.                                                                                             |
| `initFuncId` on UserAuthoredProgram | Added to `types.ts`. Required so the exec wrapper knows which function to call for module initialization.                                                               |
| NIL_VALUE fallthrough safety        | All function bodies push `NIL_VALUE` before trailing `Return` nodes. The VM's `RET` pops a return value; functions without explicit `return` need a value on the stack. |
| `resolveVarTarget` abstraction      | Returns `{ kind: "local"                                                                                                                                                | "callsiteVar", index }`for unified store/load emission. Simplifies assignment and`++`/`--` lowering for both variable kinds. |
| `emitLoad` / `emitStore` helpers    | Abstract `IrLoadLocal` vs `IrLoadCallsiteVar` (and store equivalents) based on `resolveVarTarget` result.                                                               |

**Test counts:** 63 total (11 Phase 5, 11 Phase 4 control flow, 10 Phase 3 codegen/VM,
5 buildCallDef, 5 type-checking, 7 validation, 11 extraction, 3 core imports).

**Discoveries:**

1. **NIL_VALUE fallthrough is required for all generated functions.** The VM's `RET`
   instruction unconditionally pops a return value from the stack. If a function body
   falls through without an explicit `return` statement (common for void helpers and
   module init), the stack is empty and `RET` causes a stack underflow. The fix is to
   push `NIL_VALUE` before every trailing `Return` IR node. This applies to
   `onExecute`, helper functions, and module init. Phase 6 (`onPageEntered` wrapper)
   must also follow this pattern.
2. **`LowerContext` extensions worked cleanly.** Phase 4's `LowerContext` design paid
   off -- adding `functionTable` and `callsiteVars` fields was straightforward with no
   refactoring of existing code. Future phases adding more context (e.g., lifecycle
   function IDs) can follow the same pattern.
3. **Module-level vs function-level scope via `resolveVarTarget()`.** Rather than
   modifying `ScopeStack` to understand two kinds of variables, a separate resolution
   function checks locals first, then callsite vars. This keeps `ScopeStack` focused on
   block-scoping within a single function. Helper functions get their own `ScopeStack`
   (with params as initial locals) but share the same `callsiteVars` map.
4. **Function parameters are locals 0..N-1.** For helper functions, the `ScopeStack` is
   initialized with `numParams` as the initial next-local index, and each parameter
   name is declared at indices 0 through N-1. This matches the VM's calling convention
   where `CALL` pushes arguments into the callee's locals.
5. **`null` literal still unsupported.** Carried forward from Phase 4. Resolved in
   Phase 6.5.

### Phase 6 -- 2026-03-21

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                                        | Actual | Notes                                                                                                                             |
| -------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `lowering.ts`: compile `onPageEnteredNode`, generate wrapper   | Done   | `lowerOnPageEnteredBody()` compiles user body; `generateOnPageEnteredWrapper()` generates CALL-init, CALL-user, NIL, RET wrapper. |
| `compile.ts`: set `lifecycleFuncIds.onPageEntered`             | Done   | Set to `programResult.onPageEnteredWrapperId`.                                                                                    |
| `onPageEntered` compiles as a separate `FunctionBytecode`      | Done   | User body compiled with 0 params, shared `callsiteVars`, own `ScopeStack`.                                                        |
| Generated wrapper calls module init, then user `onPageEntered` | Done   | Both calls are optional -- wrapper emits CALL+POP only if initFuncId / userOnPageEnteredFuncId exist.                             |
| `lifecycleFuncIds.onPageEntered` points to wrapper             | Done   | Always set (wrapper is always generated).                                                                                         |
| If no user `onPageEntered`, wrapper still runs module init     | Done   | Tested explicitly.                                                                                                                |

**Design notes:**

1. **Wrapper is always generated.** Even when there are no callsite vars and no user
   `onPageEntered`, the wrapper is emitted (pushes NIL, returns). This keeps
   `lifecycleFuncIds.onPageEntered` unconditionally set, simplifying the registration
   bridge -- it can always register the hook without conditional logic.
2. **Function ID ordering.** 0=onExecute, 1..M=helpers, M+1=user onPageEntered (if
   present), next=module init (if callsite vars exist), last=onPageEntered wrapper.
   The wrapper is always the final function entry.
3. **No changes to `types.ts` or `ir.ts`.** The `lifecycleFuncIds.onPageEntered` field
   already existed on `UserAuthoredProgram` (added in Phase 5 as `onPageEntered?:
number`). `IrCall`, `IrPushConst`, and `IrReturn` IR nodes were sufficient for both
   the user body and the generated wrapper.
4. **`onPageEntered` extracted from descriptor, not file-level.** As noted in the
   Phase 6 risk section (added 2026-03-21), `onPageEntered` is a method on the
   `Sensor()`/`Actuator()` config object, not a file-level named export. The
   implementation uses `descriptor.onPageEnteredNode` directly.

**Updated prior tests:** Two existing tests (`program metadata is correct` in Phase 3
and `program has correct function count with helpers` in Phase 5) had their function
count assertions incremented by 1 to account for the always-present wrapper.

**Test counts:** 68 total (5 Phase 6, 11 Phase 5, 11 Phase 4 control flow, 10 Phase 3
codegen/VM, 5 buildCallDef, 5 type-checking, 7 validation, 11 extraction, 3 core
imports).

**Discoveries:**

1. **Always-generated wrapper simplifies downstream integration.** By unconditionally
   generating the wrapper (even when it's a no-op NIL+RET), the linker and
   registration bridge (Phases 7-8) can always read
   `lifecycleFuncIds.onPageEntered` without null checks. The cost is one trivial
   function entry per program.
2. **No `LowerContext` changes needed.** The user `onPageEntered` body reuses the
   same lowering infrastructure as helper functions (own `ScopeStack`, shared
   `callsiteVars` and `functionTable`). No new fields on `LowerContext`.
3. **Generated wrapper uses IR directly, not lowering.** The wrapper is so simple
   (CALL+POP, CALL+POP, NIL, RET) that it constructs `IrNode[]` manually rather
   than going through `lowerStatements`. This avoids needing a synthetic AST.
4. **`null` literal still unsupported.** Carried forward from Phase 5.

### Phase 6.5 -- 2026-03-21

**Status:** Complete. All acceptance criteria met.

**Objective:** Add `null` and `undefined` literal support and nil operator
overloads. The `NullKeyword` syntax kind was previously rejected with "Unsupported
expression: NullKeyword" (noted in Phase 3, carried forward through Phase 6).
This phase maps both `null` and `undefined` to `NIL_VALUE`, registers nil operator
overloads in core, and extends `tsTypeToTypeId` to handle `TypeFlags.Null`,
`TypeFlags.Undefined`, and nullable union types so that `x === null` and
`x === undefined` comparisons compile and execute correctly.

**Deliverables:**

| Planned                               | Actual | Notes                                                                                                                                        |
| ------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `lowering.ts`: handle `NullKeyword`   | Done   | Two-line addition: `NullKeyword` -> `PushConst(NIL_VALUE)`, parallel to `true`/`false`.                                                      |
| `lowering.ts`: handle `undefined`     | Done   | `lowerIdentifier` intercepts the identifier `"undefined"` and emits `PushConst(NIL_VALUE)` before variable lookup.                           |
| Tests for null in variable assignment | Done   | Assigns `null` to a local then uses `=== null` comparison; verifies correct execution.                                                       |
| Tests for null as return value        | Done   | Helper function returning `null`; caller compares `=== null`.                                                                                |
| Tests for null in callsite var init   | Done   | Top-level `let cached: number \| null = null;` initializer compiled via module init with null comparison.                                    |
| `lowering.ts`: `tsTypeToTypeId` null  | Done   | Maps `TypeFlags.Null` and `TypeFlags.Undefined` -> `CoreTypeIds.Nil`. Strips both from union types.                                          |
| Core nil operator overloads           | Done   | `operators.ts`: `nil == nil`, `nil != nil`, `!nil`, plus cross-type `==`/`!=` for nil with number/boolean/string (check runtime NativeType). |
| Core nil overload tests               | Done   | `brain.spec.ts`: 11 new tests covering same-type, cross-type, and WHEN condition integration.                                                |
| Tile suggestion regression fix        | Done   | `tile-suggestions.ts`: skip Nil-typed RHS in `incompleteExprExpectedType` to avoid false ambiguity.                                          |
| TypeScript null comparison tests      | Done   | `codegen.spec.ts`: 2 new tests (`number !== null`, `null === null`); 3 existing tests updated to use `=== null`.                             |
| TypeScript undefined tests            | Done   | `codegen.spec.ts`: 3 new tests (`undefined` -> NIL_VALUE, `undefined === null`, `number !== undefined`).                                     |

**No new files.** No changes to `ir.ts`, `emit.ts`, `scope.ts`, or `types.ts`.

**Test counts:**

- `packages/typescript`: 76 total (8 Phase 6.5, 5 Phase 6, 11 Phase 5, 11 Phase 4
  control flow, 10 Phase 3 codegen/VM, 5 buildCallDef, 5 type-checking, 7 validation,
  11 extraction, 3 core imports).
- `packages/core`: 429 total (11 nil overload tests added to `brain.spec.ts`).

**Discoveries:**

1. **Cross-type nil overloads must check runtime NativeType.** The operator overload
   system dispatches statically by `TypeId` at compile time. For a variable of static
   type `number` that actually holds `NIL_VALUE` at runtime (from a `number | null`
   union), a constant `false` result for `number == nil` would be wrong. The fix is
   to check `args.v.get(N).t === NativeType.Nil` at runtime. This is the correct
   pattern for any cross-type nil comparison.
2. **Union types in `tsTypeToTypeId` are common for nullable parameters.** `number |
null` has `TypeFlags.Union` with a `.types` array. The implementation strips null
   constituents and recurses on the single remaining type. Multi-type unions (e.g.,
   `number | string | null`) are not yet handled -- acceptable for now but Phase 9+
   may need expansion.
3. **Nil overloads cause tile-suggestion ambiguity.** Adding `NotEqualTo(String, Nil)`
   alongside `NotEqualTo(String, String)` caused `incompleteExprExpectedType` to see
   two RHS types and mark the expected type as ambiguous. The fix is to skip
   `CoreTypeIds.Nil` RHS in the ambiguity check -- nil is not a tile-selectable type
   and should never influence expected-type inference.
4. **Null comparisons resolved.** Discovery #1 from the initial Phase 6.5 log
   ("null comparisons not yet supported") is fully resolved. No need to defer to
   Phase 9a.
5. **`undefined` is an identifier, not a keyword.** In TypeScript's AST, `undefined`
   is an `Identifier` node (not `UndefinedKeyword`). It must be intercepted in
   `lowerIdentifier` before variable lookup, unlike `null` which is a
   `SyntaxKind.NullKeyword`. Both map to the same `NIL_VALUE` at runtime.
6. **`null` and `undefined` are fully interchangeable at the VM level.** Both produce
   `NIL_VALUE` (`NativeType.Nil`). This matches Luau (Roblox target) which has only
   `nil`, and aligns with TypeScript's nullish semantics (`??`, `==`).

### Phase 7 -- 2026-03-21

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                                                  | Actual | Notes                                                                                                    |
| ------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------- |
| `src/linker/linker.ts`: `linkUserPrograms(brainProgram, userPrograms[])` | Done   | Appends user functions, remaps `CALL` and `PUSH_CONST` operands, merges constants, returns `LinkResult`. |
| `src/linker/linker.spec.ts`: tests                                       | Done   | 7 tests covering all acceptance criteria plus additional scenarios.                                      |
| Returns linked entry funcId for each user program                        | Done   | Via `UserTileLinkInfo.linkedEntryFuncId`.                                                                |
| Test: linked program callable by funcId                                  | Done   | Compiles sensor, links into empty brain program, executes via VM.                                        |
| Test: constant pool indices correct after merging                        | Done   | Verifies brain constants preserved at original indices, user constants appended.                         |
| Test: `CALL` to user helper resolves correctly                           | Done   | Verifies `CALL` instructions in linked bytecode have funcIds >= brain function offset.                   |

**Additional work beyond plan:**

| Item                                  | Notes                                                                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `linkedOnPageEnteredFuncId`           | Added to `UserTileLinkInfo`. Remaps `lifecycleFuncIds.onPageEntered` by the function offset. Tested explicitly.                   |
| `LinkResult` interface                | New interface returned by `linkUserPrograms`, containing `linkedProgram` and `userLinks[]`.                                       |
| Multiple user program test            | Links two independent user programs into one brain program, verifies both execute correctly with independent offsets.             |
| Brain function preservation test      | Verifies the brain program's original stub function (PUSH_CONST + RET) still executes correctly after linking user programs.      |
| Linked helper function execution test | End-to-end: compiles a sensor with a `triple()` helper, links into a brain program with a stub, executes via VM, verifies result. |
| `src/index.ts` re-exports             | Added `linkUserPrograms` and `LinkResult` exports.                                                                                |

**No changes to `packages/core`.** The linker operates entirely on the `List<FunctionBytecode>`
and `List<Value>` data structures already exported from core. No new core APIs were needed.

**No spec amendments needed.** The `user-authored-sensors-actuators.md` linking section
accurately described the algorithm. The implementation matches the spec's steps 4-6.

**Test counts:** 83 total (7 linker, 8 null/nil, 5 onPageEntered/lifecycle, 11 helper
functions/callsite state, 11 control flow, 10 codegen/VM, 5 buildCallDef, 5
type-checking, 7 validation, 11 extraction, 3 core imports).

**Discoveries:**

1. **Constants are appended, not deduplicated.** The linker appends user constants
   to the brain's constant pool without deduplication. This is correct and simple:
   each user program was compiled with its own `ConstantPool` which already
   deduplicates internally. Cross-program dedup would save a few entries but adds
   complexity (value equality checks for all `Value` types) with no meaningful
   benefit at current scale.
2. **Brain program instructions are not remapped.** Only user program instructions
   need remapping. The brain program's existing functions reference function IDs and
   constant indices that are still valid in the linked program (they occupy the same
   positions). This is a key simplification -- the linker only touches user bytecode.
3. **`linkedOnPageEnteredFuncId` is essential for Phase 8.** The exec wrapper / tile
   registration bridge needs both `linkedEntryFuncId` (for `onExecute` dispatch) and
   `linkedOnPageEnteredFuncId` (for lifecycle hook registration). Returning both from
   the linker avoids the registration bridge needing to know about function offsets.
4. **The linker is ~40 lines of logic.** The spec estimated ~50 lines; the actual
   implementation is slightly smaller. The `remapInstructions` helper is clean and
   handles only the two opcodes that reference pool/function indices (`PUSH_CONST`
   and `CALL`). No other opcodes use indices into these arrays.
5. **`initFuncId` remapping is deferred to the registration bridge.** The
   `UserAuthoredProgram.initFuncId` is a program-local function index. The linker
   remaps `lifecycleFuncIds.onPageEntered` (which wraps the init call) but does not
   separately remap `initFuncId`. The exec wrapper in Phase 8 should use the
   `onPageEntered` wrapper (which already calls init) rather than calling
   `initFuncId` directly. This is consistent with the Phase 6 design where the
   wrapper is the single entry point for lifecycle setup.
   (Updated 2026-03-21: Superseded by Phase 8. The linker now remaps `initFuncId`
   into `linkedInitFuncId` on `UserTileLinkInfo`. First-allocation init calls
   `linkedInitFuncId` (module init only), not the full `onPageEntered` wrapper.
   This matches native built-in tile behavior.)

### Phase 8 -- 2026-03-21

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                                    | Actual  | Notes                                                                                                                                  |
| ---------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/runtime/authored-function.ts`: `createUserTileExec()` | Done    | Returns `HostAsyncFn` with `exec` and `onPageEntered` methods. Uses `vm.spawnFiber` + `vm.runFiber` for sync dispatch.                 |
| `src/runtime/registration-bridge.ts`: `registerUserTile()` | Done    | Three-step flow: ensure param tile defs, register function, add sensor/actuator tile def.                                              |
| `src/runtime/authored-function.spec.ts`: integration tests | Done    | 5 authored-function tests + 3 registration-bridge tests.                                                                               |
| `src/index.ts`: new exports                                | Done    | `createUserTileExec`, `registerUserTile` exported. (`RegistrationServices` removed in post-Phase 10 cleanup.)                          |
| Handle resolution for sync sensors                         | Done    | `exec` wrapper resolves handle immediately after fiber completes.                                                                      |
| Callsite vars allocation and module init                   | Changed | First invocation runs `linkedInitFuncId` (module init only), not the full `onPageEntered` wrapper. See design decision #7.             |
| `onPageEntered` dispatch                                   | Done    | Spawns fiber for `linkedOnPageEnteredFuncId` wrapper, which runs module init + user body.                                              |
| Registration bridge: param tile defs                       | Done    | Named params -> `user.<tileName>.<paramName>`, anonymous -> `anon.<type>`. Checks `tiles.has()` before registering.                    |
| Registration bridge: function registration                 | Done    | `functions.register(pgmId, true, hostFn, callDef)` -- always async. pgmId uses `user.sensor.<name>` / `user.actuator.<name>` (see #8). |
| Registration bridge: tile catalog entry                    | Done    | `BrainTileSensorDef` or `BrainTileActuatorDef` with `user.sensor.<name>` / `user.actuator.<name>` ID.                                  |

**Design decisions:**

1. **Sync inline execution via `vm.spawnFiber` + `vm.runFiber`.** Rather than using
   `scheduler.spawn()` (which enqueues for later tick execution), the exec wrapper
   creates fibers directly via `vm.spawnFiber()` and runs them immediately with
   `vm.runFiber()`. This allows sync user tiles to complete and resolve their handle
   within the same HOST_CALL_ARGS_ASYNC instruction, avoiding scheduler queue
   complexity. The brain fiber sees the handle already resolved when it hits AWAIT.
   The spec says "there is no special-case inline or reentrant execution path" --
   the implementation explicitly uses an inline path for sync tiles. Async tiles
   (Phase 20+) will need a different dispatch strategy.

2. **Shallow-copy execution context for user fibers.** `vm.spawnFiber()` mutates
   `executionContext.fiberId`. To avoid clobbering the brain fiber's context, the
   wrapper creates a shallow copy (`{ ...ctx }`) for each spawned fiber. The
   `callSiteState` Dict is shared by reference (correct -- callsite state persists
   across both contexts).

3. **Negative instance-scoped fiber IDs.** Each `createUserTileExec` closure has
   its own `nextFiberId` counter starting at -1 and decrementing. Negative IDs
   avoid collisions with the scheduler's positive ID space (`nextFiberId = 1`,
   incrementing). The counter is instance-scoped (not module-level) so multiple
   exec wrappers do not share mutable state. These fibers are ephemeral -- not
   added to the scheduler's tracking.

4. **`params: ExtractedParam[]` added to `UserAuthoredProgram`.** The registration
   bridge needs param type strings (e.g., `"number"`) to resolve TypeIds for
   `BrainTileParameterDef` construction. Rather than parsing this from the
   `callDef.argSlots` tile IDs (fragile), the original `ExtractedParam[]` array
   is stored on `UserAuthoredProgram`. This is a `packages/typescript` type change
   only -- no core modifications.

5. **`RegistrationServices` removed (post-Phase 10 cleanup).** Originally the bridge
   took an injected services object with `functions`, `tiles`, and `resolveTypeId`.
   After `ITypeRegistry.resolveByName()` was added to core and `resolveTypeId` was
   removed from `CompileOptions`, the remaining fields (`functions`, `tiles`) were
   just `getBrainServices()` accessors. The interface was removed;
   `registerUserTile(linkInfo, hostFn)` now calls `getBrainServices()` directly.

6. **Always async registration.** Per the spec's unified invocation model, user tiles
   are registered as `isAsync: true`. The brain dispatches them via
   `HOST_CALL_ARGS_ASYNC`, which creates a pending handle. The exec wrapper resolves
   the handle synchronously for sync tiles; async tiles (Phase 18+) will resolve
   later.

7. **First-allocation init uses `linkedInitFuncId`, not `linkedOnPageEnteredFuncId`.**
   The original plan called the full `onPageEntered` wrapper on first allocation.
   Review identified this as incorrect: native built-in tiles initialize callsite
   state in `exec` on first access, and `onPageEntered` runs only on actual page
   entry. Calling the wrapper on first allocation would run the user's
   `onPageEntered` body at construction time (wrong lifecycle event) and could
   double-fire if the brain also calls `onPageEntered` during the same page entry.
   Fix: `UserTileLinkInfo` gained `linkedInitFuncId?: number`, the linker now remaps
   `initFuncId`, and `getOrCreateCallsiteVars` calls `linkedInitFuncId` (module init
   only). Phase 7's discovery #5 ("initFuncId remapping deferred") is superseded.

8. **Registration IDs use `user.sensor.<name>` / `user.actuator.<name>`.** The spec's
   tileId naming table shows `user.<name>` (e.g., `user.chase`). The implementation
   uses `user.sensor.<name>` / `user.actuator.<name>` to avoid name collisions if a
   sensor and actuator share the same user-given name. The spec table should be
   updated.

**No changes to `packages/core`.** All new code is in `packages/typescript/src/runtime/`.
The exec wrapper and registration bridge use only public APIs from
`@mindcraft-lang/core/brain`.

**Test counts:** 91 total (5 authored-function, 3 registration-bridge, 7 linker, 8
null/nil, 5 onPageEntered/lifecycle, 11 helper functions/callsite state, 11 control
flow, 10 codegen/VM, 5 buildCallDef, 5 type-checking, 7 validation, 11 extraction,
3 core imports).

**Discoveries:**

1. **`vm.runFiber` can be called recursively.** The exec wrapper runs inside
   `HOST_CALL_ARGS_ASYNC` dispatch (itself inside `vm.runFiber` for the brain fiber).
   Calling `vm.runFiber` again for the user fiber is safe -- each call operates on a
   different fiber object, and the VM's shared state (program, handles, function
   registry) is read-only during dispatch. This recursive pattern enables sync user
   tiles to complete within the brain fiber's dispatch loop.

2. **Fiber `instrBudget` must be set before `vm.runFiber`.** The scheduler normally
   sets `fiber.instrBudget` in `tick()`. Since the exec wrapper bypasses the
   scheduler, it sets `instrBudget = 10000` directly. This is sufficient for sync
   tiles; a future optimization could derive the budget from the remaining brain
   fiber budget.

3. **Module init on first allocation is separate from `onPageEntered`.** On first
   callsite invocation, the wrapper spawns a fiber for `linkedInitFuncId` to set
   initial callsite var values. The full `onPageEntered` wrapper (which calls init
   then user body) runs only on actual page entry events. This matches native
   built-in tile behavior.

4. **`onPageEntered` is called per-callsite by the brain runtime.** The brain's
   `enterPage()` iterates `pageMetadata.hostCallSites` and calls
   `entry.fn.onPageEntered(ctx)` with `ctx.currentCallSiteId` set to the call site
   ID. This means our wrapper's `onPageEntered` correctly retrieves the right
   callsiteVars via `getCallSiteState()`.

5. **Tile namespace import pattern.** Concrete tile def classes (`BrainTileSensorDef`,
   `BrainTileActuatorDef`, `BrainTileParameterDef`) are under the `tiles` namespace
   export from `@mindcraft-lang/core/brain` (not at the top level). Import as
   `import { tiles as tileDefs } from "@mindcraft-lang/core/brain"` and reference
   as `tileDefs.BrainTileSensorDef`.

6. **Anonymous param tile defs use `anon.<type>` IDs and are shared.** The
   `tiles.has()` check before registration prevents duplicate registration when
   multiple tiles share the same anonymous param type (e.g., two sensors both using
   `anon.number`). Named params use `user.<tileName>.<paramName>` which is always
   unique.

7. **Recompile-and-update pathway needed.** `FunctionRegistry.register()` and
   `TileCatalog.registerTileDef()` both throw on duplicate names. The current bridge
   handles first-registration only. A stateless recompile-and-update pathway should
   be established so the caller does not need to track whether a prior registration
   exists. The bridge should detect whether the tile is already registered and update
   the existing `BrainFunctionEntry.fn` closure rather than re-registering. This
   should be done in the appropriate future phase and include tests for the update
   path.

### Phase 9 -- 2026-03-21

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                    | Actual | Notes                                                                                                                                   |
| ------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------- |
| `lowering.ts`: `&&` short-circuit lowering | Done   | `lowerShortCircuit()`: LHS, DUP, JumpIfFalse(end), Pop, RHS, Label(end). Requires DUP because the VM's JmpIfFalse pops its operand.     |
| `lowering.ts`: `                           |        | ` short-circuit lowering                                                                                                                | Done | Same `lowerShortCircuit()`: LHS, DUP, JumpIfTrue(end), Pop, RHS, Label(end). Symmetric with `&&`. |
| `lowering.ts`: `!` unary NOT               | Done   | In `lowerPrefixUnary`: evaluates operand, resolves operand type via checker, emits `HostCallArgs(Not)` with the type-specific overload. |
| Tests for all acceptance criteria          | Done   | 6 tests covering all 6 acceptance criteria.                                                                                             |

**Design changes from spec:**

1. **DUP required before conditional jump.** The spec's deliverable descriptions
   (#1 and #2) list the pattern as "evaluate LHS, JumpIfFalse(end), Pop, evaluate
   RHS, Label(end)" without mentioning DUP. The VM's `JmpIfFalse`/`JmpIfTrue`
   instructions **pop** their operand from the stack. For JS value-preserving
   semantics (the LHS value must remain on the stack when short-circuiting), a DUP
   is required before the conditional jump: LHS, DUP, JumpIfFalse(end), Pop, RHS,
   Label(end). The DUP creates a copy for the conditional jump to consume; the
   original remains for the short-circuit result. When not short-circuiting, Pop
   discards the original and RHS becomes the result.

2. **`!` resolves operand type dynamically.** The spec says "HostCallArgs for the
   boolean NOT operator (CoreOpId.Not)". The implementation resolves the operand's
   actual type via the TS checker and looks up the matching `Not` overload for that
   type (boolean, nil, etc.), rather than hardcoding `CoreTypeIds.Boolean`. This is
   correct because `!nil -> true` uses a different overload than `!boolean`.

**No new files.** No changes to `ir.ts`, `emit.ts`, `scope.ts`, or `types.ts`.
Existing IR nodes (`IrDup`, `IrJumpIfFalse`, `IrJumpIfTrue`, `IrPop`, `IrLabel`,
`IrHostCallArgs`) were sufficient.

**No changes to `packages/core`.** The boolean `Not` overload and nil `Not` overload
were already registered (Phases 0 and 6.5 respectively). The VM's `isTruthy`
function already implements JS-compatible truthiness semantics.

**No spec amendments needed.** `user-authored-sensors-actuators.md` does not cover
logical operator compilation details.

**Test counts:** 97 total (6 Phase 9, 5 authored-function, 3 registration-bridge,
7 linker, 8 null/nil, 5 onPageEntered/lifecycle, 11 helper functions/callsite state,
11 control flow, 10 codegen/VM, 5 buildCallDef, 5 type-checking, 7 validation,
11 extraction, 3 core imports).

**Discoveries:**

1. **VM's `isTruthy` already matches JS semantics.** The key risk ("If the VM only
   checks boolean values, a truthiness coercion HOST_CALL may be needed") did not
   materialize. The VM's `isTruthy` function handles all value types: `0`, `""`,
   `false`, and `NIL_VALUE` are falsy; everything else (including empty structs and
   non-zero numbers) is truthy. No coercion HOST_CALL was needed.

2. **DUP-before-conditional-jump is the standard short-circuit pattern.** The VM
   unconditionally pops the conditional value from the stack in `JmpIfFalse` /
   `JmpIfTrue`. Any future short-circuit emission (e.g., `??` nullish coalescing
   if supported) must follow the same DUP + conditional-jump + Pop pattern.

3. **No new IR nodes needed.** The existing IR vocabulary was sufficient for all
   three operators. `&&`/`||` use `IrDup`, `IrJumpIfFalse`/`IrJumpIfTrue`, `IrPop`,
   and `IrLabel`. `!` uses `IrHostCallArgs`. This confirms the IR design has good
   coverage for expression-level control flow.

4. **Operand type resolution for `!` is necessary.** The `Not` operator has
   type-specific overloads (boolean -> boolean, nil -> boolean). Hardcoding
   `CoreTypeIds.Boolean` would fail for `!null` / `!undefined` expressions where
   the operand has nil type. The implementation resolves the operand type via the
   TS checker's `getTypeAtLocation()` and `tsTypeToTypeId()`, then looks up the
   correct overload. Phase 10+ operators that have type-specific overloads should
   follow the same pattern.

### Phase 10 -- 2026-03-21

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                              | Actual | Notes                                                                                                                                     |
| ---------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `lowering.ts`: `"a" + "b"` via string `Add` overload | Done   | Existing `lowerBinaryExpression` path resolves `Add(String, String)` -- no lowering changes needed for this case.                         |
| `lowering.ts`: template literal desugaring           | Done   | `lowerTemplateLiteral()` function. Accumulator pattern: emit head, then for each span lower expression + convert-to-string + concatenate. |
| `lowering.ts`: `NoSubstitutionTemplateLiteral`       | Done   | Treated as a string literal: `PushConst(mkStringValue(expr.text))`.                                                                       |
| Tagged template rejection                            | N/A    | Already rejected by the validator (confirmed, no changes needed).                                                                         |
| Test: `"a" + "b"` -> `"ab"`                          | Done   |                                                                                                                                           |
| Test: `` `count: ${n}` `` -> `"count: 42"`           | Done   |                                                                                                                                           |
| Test: `` `${a}-${b}` `` multiple spans               | Done   |                                                                                                                                           |
| Test: empty template literal -> `""`                 | Done   |                                                                                                                                           |

**Additional work beyond plan:**

| Item                                             | Notes                                                                                                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `emitToStringIfNeeded` with implicit coercion    | Template literal expressions of non-string type are automatically converted via `$$conv_<fromType>_to_<toType>` host functions. Number and boolean covered. |
| `conversionFnName` moved to core                 | `packages/core/src/brain/runtime/conversion.ts` exports `conversionFnName(from, to)` -- canonical name generation for conversion host functions.            |
| Diagnostic: unknown type in string interpolation | `emitToStringIfNeeded` emits `"Cannot convert expression to string: unable to determine type"` when `tsTypeToTypeId()` returns `undefined`.                 |
| Diagnostic: missing conversion function          | `emitToStringIfNeeded` emits `"No conversion from ${typeId} to string"` when no conversion host function is registered for the type.                        |
| Tests for diagnostics                            | 2 additional tests: `any`-typed expression interpolation diagnostic, `null` interpolation diagnostic.                                                       |
| **Resolver callback elimination (refactoring)**  | Removed `resolveHostFn` and `resolveOperator` from `CompileOptions`. The compiler now uses `getBrainServices()` directly for operator and function lookup.  |

**Design changes from spec:**

1. **Implicit coercion via conversion functions.** The spec's key risk ("String +
   non-string coercion") was resolved by using core's conversion registry.
   `emitToStringIfNeeded` checks the expression's TS type, and if not String, emits a
   `HostCallArgs` with a conversion function named `$$conv_<from>_to_<to>`. Core
   already registers `Number -> String` and `Boolean -> String` conversions. The
   `conversionFnName` helper was moved to core (`runtime/conversion.ts`) so both
   the compiler and core can use the same naming convention.

2. **Accumulator pattern instead of flat chain.** The spec described template literal
   lowering as `PushConst(head), expr, Add, PushConst(tail), Add` for each span.
   The implementation uses an accumulator pattern: the head is pushed only if
   non-empty, each span expression is pushed and converted to string, then
   concatenated with the accumulator only if one exists. This correctly handles edge
   cases like empty heads, single-expression templates, and empty templates.

3. **`resolveHostFn` and `resolveOperator` removed from `CompileOptions`.** During
   review, the callback injection pattern was replaced with direct
   `getBrainServices()` usage. `emit.ts` now calls
   `getBrainServices().functions.get(fnName)?.id` directly in the `HostCallArgs` case.
   `lowering.ts` has a module-level `resolveOperator()` function that calls
   `getBrainServices().operatorOverloads.resolve()`. `CompileOptions` now only has
   `ambientSource`; `resolveTypeId` was also removed in a post-Phase 10 cleanup
   (type resolution now uses `ITypeRegistry.resolveByName()`). The early-return
   guard `if (!options?.resolveHostFn)` in `compile.ts` was removed -- the compiler
   now always runs the full pipeline (lower + emit) regardless of options.

**Files changed:**

- `packages/typescript/src/compiler/lowering.ts` -- `lowerTemplateLiteral()`,
  `emitToStringIfNeeded()`, module-level `resolveOperator()`, `NoSubstitutionTemplateLiteral`
  handling, `resolveOperator` removed from `LowerContext` and `lowerProgram` signature
- `packages/typescript/src/compiler/emit.ts` -- `resolveHostFn` parameter removed from
  `emitFunction`, uses `getBrainServices().functions.get()` directly
- `packages/typescript/src/compiler/types.ts` -- `resolveHostFn` and `resolveOperator`
  removed from `CompileOptions`
- `packages/typescript/src/compiler/compile.ts` -- removed early-return guard, removed
  resolver args from `lowerProgram` and `emitFunction` calls
- `packages/core/src/brain/runtime/conversion.ts` -- `conversionFnName(from, to)` added
- `packages/typescript/src/compiler/codegen.spec.ts` -- 6 new tests (4 string, 2
  diagnostics), removed all `resolveHostFn`/`resolveOperator` from test options
- `packages/typescript/src/linker/linker.spec.ts` -- removed resolver options
- `packages/typescript/src/runtime/authored-function.spec.ts` -- simplified
  `compileAndLink` to `compileUserTile(source)`
- `packages/typescript/src/compiler/compile.spec.ts` -- added
  `registerCoreBrainComponents` calls in `before` hooks

**No spec amendments needed.** `user-authored-sensors-actuators.md` does not describe
the string operation or callback injection details.

**Test counts:** 103 total (6 Phase 10, 6 Phase 9, 5 authored-function, 3
registration-bridge, 7 linker, 8 null/nil, 5 onPageEntered/lifecycle, 11 helper
functions/callsite state, 11 control flow, 10 codegen/VM, 5 buildCallDef, 5
type-checking, 7 validation, 11 extraction, 3 core imports).

**Discoveries:**

1. **Conversion functions follow a canonical naming convention.** The name
   `$$conv_<fromTypeId>_to_<toTypeId>` is used by both the compiler (to emit the
   right `HostCallArgs`) and core (to register conversion functions). Moving
   `conversionFnName` to core ensures a single source of truth. Future type
   conversions (e.g., struct-to-string) only need to register a host function with
   this name.

2. **`getBrainServices()` is the canonical source for all runtime lookups.** The
   resolver callback pattern (`resolveHostFn`, `resolveOperator`) was an unnecessary
   indirection. The compiler runs in a context where `getBrainServices()` is always
   initialized (tests call `registerCoreBrainComponents` in `before` hooks). Direct
   calls to `getBrainServices().functions.get()` and
   `getBrainServices().operatorOverloads.resolve()` are simpler and eliminate
   callback threading through the lowering context.

3. **`CompileOptions` has no remaining callbacks.** After Phase 10 removed
   `resolveHostFn` and `resolveOperator`, a post-Phase 10 cleanup also removed
   `resolveTypeId` by adding `resolveByName(name: string): TypeId | undefined` to
   `ITypeRegistry` in core. The compiler now calls
   `getBrainServices().types.resolveByName()` directly. `CompileOptions` retains
   only `ambientSource?: string`. The `RegistrationServices` interface was also
   removed -- `registerUserTile(linkInfo, hostFn)` uses `getBrainServices()` directly.

4. **The compiler now always runs the full pipeline.** Removing the `resolveHostFn`
   guard means `compileUserTile` always lowers and emits bytecode. Previously,
   calling without `resolveHostFn` would return early after descriptor extraction.
   All callers now get a `UserAuthoredProgram` with compiled bytecode. Tests that
   only needed descriptors still work because descriptor extraction precedes lowering.

5. **Empty template head optimization.** When the template head is empty (e.g.,
   `` `${x}` ``), the accumulator pattern skips the initial `PushConst("")` and
   `Add`. The first span's expression becomes the accumulator directly. This avoids
   an unnecessary concatenation with an empty string.

6. **Diagnostic coverage for conversions is important.** Without explicit diagnostics,
   a missing conversion function (e.g., nil-to-string) would only fail at emit time
   with a generic "Cannot resolve host function" error, giving the user no indication
   that the issue is a type conversion. The `emitToStringIfNeeded` diagnostics catch
   this earlier with type-specific messages.

7. **Future phases referencing `resolveHostFn` need updating.** Phase 13 (property
   access chains + host calls) and Phase 18 (async host call emission) describe
   extending `CompileOptions.resolveHostFn`. These phases should instead use
   `getBrainServices().functions.get()` directly, with async detection via the
   function registry entry's metadata rather than a callback return type.
   (Updated 2026-03-23: Phase 13 and Phase 18 have been updated to use
   `getBrainServices().functions.get()` directly. No remaining phases reference
   `resolveHostFn` as something to extend.)

### Phase 11a -- 2026-03-21

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                                        | Actual | Notes                                                                                                            |
| -------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| `ITypeRegistry.entries()` exposes registered types             | Done   | Returns `Iterable<[TypeId, TypeDef]>`. Implementation: `this.defs.entries().toArray()`.                          |
| `buildAmbientFromRegistry(registry)` generates ambient `.d.ts` | Done   | Renamed to `buildAmbientDeclarations()` (no params -- uses `getBrainServices()` internally).                     |
| Plain interface for user-creatable struct                      | Done   | `interface Vector2 { x: number; y: number; }` with `MindcraftTypeMap` entry.                                     |
| Branded interface for native-backed struct                     | Done   | `readonly __brand: unique symbol` + all fields `readonly`. Quoted field names for identifiers with spaces.       |
| Branded struct prevents object literal assignment (TS error)   | Done   | Test confirms TS type error when assigning `{ id: 1, ... }` to `ActorRef`.                                       |
| Native-backed struct usable as param/variable type             | Done   | `let t: ActorRef = params.target;` compiles to `LOAD_LOCAL`/`STORE_LOCAL`.                                       |
| Replaces manual `buildAmbientSource(appTypeEntries?)` API      | Done   | `buildAmbientSource` and `AMBIENT_MINDCRAFT_DTS` removed. `compile.ts` defaults to `buildAmbientDeclarations()`. |

**Additional work beyond plan:**

| Item                               | Notes                                                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strongly-typed primitive support   | `NativeType.Number`, `.Boolean`, `.String` types generate `MindcraftTypeMap` entries (e.g., `health: number;`).                                             |
| Enum type support                  | `NativeType.Enum` generates string union types (e.g., `type Direction = "north" \| "south";`) and `MindcraftTypeMap` entries.                               |
| List type support                  | `NativeType.List` generates `ReadonlyArray` aliases (e.g., `type NumberList = ReadonlyArray<number>;`) and `MindcraftTypeMap` entries.                      |
| Map type support                   | `NativeType.Map` generates `Record` aliases (e.g., `type StringMap = Record<string, string>;`) and `MindcraftTypeMap` entries.                              |
| Core type deduplication            | `CORE_TYPE_NAMES` set (`boolean`, `number`, `string`, `void`, `nil`, `unknown`) prevents duplicate `MindcraftTypeMap` entries.                              |
| Cross-struct field type resolution | `typeDefToTs()` and `typeIdToTs()` recursively resolve field types, so `Entity.pos: Position` generates correctly.                                          |
| `buildAmbientSource` removal       | Old manual-injection API fully removed from `ambient.ts`, `compile.ts`, `index.ts`, `codegen.spec.ts`. `CompileOptions.ambientSource` kept as escape hatch. |

**Design changes from spec:**

1. **No `registry` parameter.** The spec called for `buildAmbientFromRegistry(registry)`.
   The implementation takes no parameters and calls `getBrainServices().types` internally,
   consistent with the pattern established in Phase 10 (direct `getBrainServices()` usage
   throughout the compiler).

2. **Renamed to `buildAmbientDeclarations`.** The spec name `buildAmbientFromRegistry`
   was an implementation detail. The final name focuses on what it produces rather than
   how it produces it.

3. **All type kinds handled, not just structs.** The spec focused on struct types. The
   implementation also handles strongly-typed primitives, enums, lists, and maps to
   ensure all registered types are reflected in the ambient declarations.

4. **`buildAmbientSource` fully removed.** The spec described the new function as
   "replaces the manual `buildAmbientSource(appTypeEntries?)` API" but did not
   explicitly call for removal. The old API was removed since `buildAmbientDeclarations()`
   supersedes it completely. `CompileOptions.ambientSource` remains as an escape hatch
   for tests.

**Files changed:**

- `packages/core/src/brain/interfaces/type-system.ts` -- added `entries()` to
  `ITypeRegistry` interface
- `packages/core/src/brain/runtime/type-system.ts` -- implemented `entries()` as
  `this.defs.entries().toArray()`
- `packages/typescript/src/compiler/ambient.ts` -- added `buildAmbientDeclarations()`,
  `typeDefToTs()`, `typeIdToTs()`, `isNativeBacked()`, `generateStructInterface()`,
  `generateEnumType()`, `CORE_TYPE_NAMES` set, `needsQuoting()`. Removed
  `buildAmbientSource()` and `AMBIENT_MINDCRAFT_DTS`.
- `packages/typescript/src/compiler/ambient.spec.ts` -- new file with 9 tests:
  plain struct, branded struct, brand prevents assignment, param compile,
  cross-struct references, strongly-typed number, enum union, list alias,
  core type deduplication
- `packages/typescript/src/compiler/compile.ts` -- import changed from
  `AMBIENT_MINDCRAFT_DTS`/`buildAmbientSource` to `buildAmbientDeclarations`;
  default ambient source now calls `buildAmbientDeclarations()`
- `packages/typescript/src/compiler/codegen.spec.ts` -- updated 3 tests to use
  `buildAmbientDeclarations()` instead of `buildAmbientSource()`; "without ambient
  injection" test repurposed to verify registry-driven resolution works automatically
- `packages/typescript/src/index.ts` -- export changed from `buildAmbientSource` to
  `buildAmbientDeclarations`

**Test counts:** 112 total (9 ambient, 6 string/template, 6 Phase 9 registration, 5
authored-function, 3 registration-bridge, 7 linker, 8 null/nil, 5 onPageEntered/lifecycle,
11 helper functions/callsite state, 11 control flow, 10 codegen/VM, 5 buildCallDef,
5 type-checking, 7 validation, 11 extraction, 3 core imports).

**Discoveries:**

1. **`ITypeRegistry.entries()` returns an array, not a lazy iterable.** The `Dict`
   platform type's `entries()` returns a Luau-compatible iterator. Calling `.toArray()`
   materializes it into a standard JS iterable. This is fine for ambient generation
   (called once at compile time, not performance-critical) but is worth noting for
   any future hot-path usage.

2. **`CORE_TYPE_NAMES` deduplication is essential.** Without the skip set, registering
   a type like `number:<number>` would generate a duplicate `number: number;` entry
   in `MindcraftTypeMap`, conflicting with the hardcoded entry in `AMBIENT_MODULE_START`.
   The implementation skips types whose `def.name` matches a core type name.

3. **Field name quoting uses `needsQuoting()`.** Struct field names containing spaces
   or special characters (e.g., `"energy pct"`) are detected via a regex test and
   wrapped in quotes in the generated interface. This ensures valid TypeScript output
   for human-friendly field names used in the mindcraft type system.

4. **`CompileOptions.ambientSource` remains useful as a test escape hatch.** Even
   though `buildAmbientDeclarations()` is now the default, several tests inject
   custom ambient strings to test specific type error scenarios (e.g., adding an
   unregistered type to `MindcraftTypeMap` to verify the "Unknown output type"
   diagnostic). Removing the option entirely would make these tests harder to write.

5. **Native-backed struct brand pattern works well.** The `readonly __brand: unique symbol`
   approach prevents object literal assignment while allowing the type to be used in
   variable declarations, parameter types, and return types. This is the standard
   TypeScript pattern for nominal typing and requires no runtime overhead.

### Phase 11b -- 2026-03-21

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                            | Actual | Notes                                                                                                                                                                                                                         |
| -------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ir.ts`: add `IrStructNew`, `IrStructSet` nodes    | Done   | `IrStructNew` carries `typeId: string`; `IrStructSet` is parameterless (field name and value are on the stack)                                                                                                                |
| `lowering.ts`: handle `ts.ObjectLiteralExpression` | Done   | `lowerObjectLiteral()` resolves contextual type via `checker.getContextualType()`, maps to `StructTypeDef` via registry, rejects native-backed structs, emits `StructNew` + per-field `PushConst(name)` + value + `StructSet` |
| `emit.ts`: emit `STRUCT_NEW`, `STRUCT_SET` opcodes | Done   | `StructNew` adds typeId string to constant pool, calls `emitter.structNew(constIdx)`; `StructSet` calls `emitter.structSet()`                                                                                                 |

**Additional work not in the planned scope:**

1. **Emitter bug fix in `packages/core`.** The `BytecodeEmitter.structNew(typeId)` method
   was emitting `{ op: STRUCT_NEW, a: typeId }`, but the VM's `execStructNew` reads
   `ins.a` as `numFields` and `ins.b` as the constant pool index for the typeId string.
   Fixed `structNew()` to emit `{ op: STRUCT_NEW, a: 0, b: typeIdConstIdx }`. Updated
   both `emitter.ts` and the `IBytecodeSink` interface in `interfaces/emitter.ts`.
   This was a latent bug -- `structNew` had never been called before this phase.

**Acceptance criteria results:**

- [x] `const pos: Vector2 = { x: 10, y: 20 }` -> `STRUCT_NEW(vector2TypeId)` + field
      assignments -- test verifies correct field values via VM execution
- [x] Struct as return value (`return { x: 3, y: 7 }`) -> correct bytecode, contextual
      type inferred from return type annotation
- [x] Nested struct literal (`Entity` containing `Vector2` position) -> recursive
      struct construction verified via VM execution
- [x] Native-backed struct object literal -> compile error (diagnostic produced)
- [x] Untyped object literal (`const obj = { a: 1 }`) -> compile error (no contextual
      type)

**Files changed:**

- `packages/core/src/brain/compiler/emitter.ts` -- fixed `structNew()` operand mapping
  (a: 0, b: typeIdConstIdx)
- `packages/core/src/brain/interfaces/emitter.ts` -- updated `structNew()` param name
  and docs
- `packages/typescript/src/compiler/ir.ts` -- added `IrStructNew`, `IrStructSet` to
  `IrNode` union; added interface definitions
- `packages/typescript/src/compiler/lowering.ts` -- added `resolveStructType()`,
  `isNativeBackedStruct()`, `lowerObjectLiteral()`; added `ObjectLiteralExpression`
  case to `lowerExpression()`; added `NativeType` and `StructTypeDef` imports
- `packages/typescript/src/compiler/emit.ts` -- added `StructNew` and `StructSet` cases
  to the emit switch; added `mkStringValue` import
- `packages/typescript/src/compiler/codegen.spec.ts` -- added `struct literal compilation`
  describe block with 5 tests; added `isStructValue` and `StructValue` imports

**Test counts:** 117 total (previous 112 + 5 new struct literal tests).

**Discoveries:**

1. **`BytecodeEmitter.structNew` had wrong operand mapping.** The emitter put the
   typeId constant index into `ins.a` but the VM reads `ins.a` as `numFields` (always 0
   for the "create empty then set fields" pattern) and `ins.b` as the constant pool
   index for the typeId string. This was a latent bug since `structNew` was never called
   before. The spec in `brain-runtime.md` says `structNew(typeId: number)` which is
   ambiguous -- it does not clarify that the number is a constant pool index for a
   string, not a numeric typeId. The runtime spec could benefit from clarification.

2. **Contextual type resolution via `checker.getContextualType()` works well for typed
   contexts.** Variable declarations with explicit type annotations and return statements
   with return type annotations both provide contextual types that resolve to the
   correct struct TypeDef. Untyped declarations (no annotation) return `undefined`
   from `getContextualType()`, producing a clear diagnostic.

3. **Nested struct literals work naturally.** When the inner object literal `{ x: 5, y: 15 }`
   appears as a property value of an outer struct, `lowerExpression` recurses into
   `lowerObjectLiteral` for the inner literal. The inner struct's contextual type is
   resolved from the outer struct's field type definition in the `MindcraftTypeMap`.
   No special nesting logic was needed.

4. **Struct types must be imported from the `"mindcraft"` module.** Since ambient
   declarations are inside `declare module "mindcraft"`, user code must write
   `import { type Vector2 } from "mindcraft"` to use struct types as annotations.
   This is consistent with how `Context`, `Sensor`, and `Actuator` are used.

### Phase 12 -- 2026-03-21

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                           | Actual | Notes                                                                                                                     |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| `ir.ts`: add `IrListNew`, `IrListPush` nodes      | Done   | `IrListNew` carries `typeId: string`; `IrListPush` is parameterless (value is on the stack)                               |
| `lowering.ts`: handle `ts.ArrayLiteralExpression` | Done   | `lowerArrayLiteral()` resolves list type via `resolveListTypeId()`, emits `ListNew` + per-element expression + `ListPush` |
| `emit.ts`: emit `LIST_NEW`, `LIST_PUSH` opcodes   | Done   | `ListNew` adds typeId string to constant pool, calls `emitter.listNew(constIdx)`; `ListPush` calls `emitter.listPush()`   |

**Additional work not in the planned scope:**

1. **Emitter/VM fix in `packages/core`.** The `BytecodeEmitter.listNew(typeId)` method
   was emitting `{ op: LIST_NEW, a: typeId }`, but the VM's `execListNew` ignored all
   operands entirely and hardcoded `"list:<unknown>"` as the typeId. Fixed to match the
   `structNew` pattern from Phase 11b: `listNew(typeIdConstIdx)` emits
   `{ op: LIST_NEW, a: 0, b: typeIdConstIdx }`, and `execListNew` reads `ins.b` as
   constant pool index for the typeId string. Updated `emitter.ts`,
   `interfaces/emitter.ts`, and `vm.ts`. The call site in `vm.ts` dispatch was updated
   to pass `ins` to `execListNew`. This was a latent bug -- `listNew` had never been
   called before this phase.

2. **Two-tier type resolution in `resolveListTypeId`.** The function first tries alias
   symbol lookup (for named list types like `NumberList` which are type aliases for
   `ReadonlyArray<number>`), then falls back to element-type matching by scanning the
   registry for a list type whose `elementTypeId` matches. This handles both
   `const a: NumberList = [1]` (alias match) and contextual types from return
   annotations (element match).

**Acceptance criteria results:**

- [x] `[1, 2, 3]` -> list with 3 elements, VM reads correct values
- [x] Empty array `[]` -> empty list
- [x] Array as return value -> correct bytecode (contextual type from return annotation)
- [x] Nested arrays `[{x:1,y:2}, {x:3,y:4}]` -> correct nested list+struct construction
      (test uses `Vector2List` containing `Vector2` structs rather than nested number
      arrays, which better exercises the element type resolution)

**Design changes from spec:**

1. **Nested arrays test uses struct-typed elements.** The spec's acceptance criterion
   says `[[1], [2]]` (nested number arrays). The implementation tests
   `[{x:1,y:2}, {x:3,y:4}]` (list of struct elements) instead, which is a more
   realistic and harder test case -- it exercises the interaction between
   `resolveListTypeId` and `lowerObjectLiteral` for nested element compilation, and
   validates that contextual type propagation works for struct elements within a list.

**Files changed:**

- `packages/core/src/brain/compiler/emitter.ts` -- fixed `listNew()` operand mapping
  (a: 0, b: typeIdConstIdx)
- `packages/core/src/brain/interfaces/emitter.ts` -- updated `listNew()` param name
  and docs to `typeIdConstIdx`
- `packages/core/src/brain/runtime/vm.ts` -- `execListNew` now reads `ins.b` as
  constant pool index; call site passes `ins`
- `packages/typescript/src/compiler/ir.ts` -- added `IrListNew`, `IrListPush` to
  `IrNode` union; added interface definitions
- `packages/typescript/src/compiler/lowering.ts` -- added `resolveListTypeId()`,
  `lowerArrayLiteral()`; added `ArrayLiteralExpression` case to `lowerExpression()`;
  added `ListTypeDef` import
- `packages/typescript/src/compiler/emit.ts` -- added `ListNew` and `ListPush` cases
  to the emit switch
- `packages/typescript/src/compiler/codegen.spec.ts` -- added `array/list literal
compilation` describe block with 4 tests; added `isListValue` and `ListValue` imports

**Test counts:** 121 total (previous 117 + 4 new array/list tests).

**Discoveries:**

1. **`BytecodeEmitter.listNew` had the same operand bug as `structNew`.** Identical
   pattern to Phase 11b. The emitter put the constant pool index into `ins.a` but the
   VM either ignored `ins.a` (listNew case -- hardcoded typeId) or read it as a
   different field (structNew case -- `numFields`). Both were latent bugs since neither
   method had ever been called. The fix follows the same pattern: typeId string goes
   into the constant pool, the index goes into `ins.b`. The spec's
   `ListNew(typeId: number)` notation is ambiguous about whether the number is a
   constant pool index or a direct numeric typeId -- same ambiguity noted for
   `structNew` in Phase 11b.

2. **Alias symbol lookup is necessary for named list types.** `ReadonlyArray<Vector2>`
   has no `getSymbol()` that returns `"Vector2List"` -- the TS checker sees it as an
   instantiation of the generic `ReadonlyArray` interface. But `aliasSymbol` is
   populated when the type comes from a type alias (e.g., `type Vector2List =
ReadonlyArray<Vector2>`), and it correctly returns the alias name. Checking
   `aliasSymbol` first handles the named case; the fallback to element-type scanning
   handles direct `ReadonlyArray<number>` usage.

3. **Element type resolution for struct-typed arrays requires registry symbol lookup.**
   `tsTypeToTypeId` returns `undefined` for struct types because it only handles
   primitive types (`NumberLike`, `BooleanLike`, `StringLike`, `Null`, `Undefined`)
   and nullable unions. The `resolveListTypeId` alias-symbol-first strategy avoids
   this limitation -- `Vector2List` resolves directly by name without needing to
   resolve the element type to a TypeId. If element-type matching is needed for
   struct-typed arrays in the future, `tsTypeToTypeId` would need to be extended to
   handle struct types via `resolveByName`.

4. **Mixed-type arrays are implicitly rejected.** The spec listed mixed-type arrays
   (`[1, "a", true]`) as a risk. Since the lowering requires a registered list type
   matching the element type, and no `(number | string | boolean)[]` list type would
   typically be registered, mixed-type arrays produce a diagnostic naturally. No
   explicit rejection logic was needed.

5. **`for...of` will benefit from this phase's type resolution.** Phase 14 (`for...of`
   loop) iterates over list-typed values. The `resolveListTypeId` function and the
   list type infrastructure established here will be useful for resolving the iterable
   type in `for...of` desugaring.

### Phase 12.1 -- 2026-03-22

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                           | Actual     | Notes                                                                                                                                                                                 |
| ------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NativeType.Any = 9` enum member                  | Done       | --                                                                                                                                                                                    |
| `CoreTypeNames.Any`, `CoreTypeIds.Any`            | Done       | `CoreTypeIds.Any = "any:<any>"`                                                                                                                                                       |
| `AnyCodec` (tagged encode/decode, self-contained) | Done       | Uses `TypeUtils.isBoolean/isNumber/isString` for type discrimination (Roblox-safe, no `typeof`). `null` check removed -- Roblox doesn't support `null`, only `undefined` maps to nil. |
| `ITypeRegistry.addAnyType(name)`                  | Done       | --                                                                                                                                                                                    |
| `TypeRegistry.addAnyType(name)` implementation    | Done       | --                                                                                                                                                                                    |
| `registerCoreTypes()` registers `Any` + `AnyList` | Done       | --                                                                                                                                                                                    |
| `typeDefToTs()` handles `NativeType.Any`          | Done       | Emits `"number \| string \| boolean \| null"`                                                                                                                                         |
| `CORE_TYPE_NAMES` skip set updated                | Done       | Added `"any"` so the `Any` type itself is skipped (no ambient declaration emitted for it)                                                                                             |
| `AnyList` ambient type generation                 | Done       | Handled by existing List branch: `export type AnyList = ReadonlyArray<number \| string \| boolean \| null>`                                                                           |
| `tsTypeToTypeId()` union -> `Any`                 | Done       | Filters nullish members, resolves remaining; if 2+ distinct TypeIds, returns `CoreTypeIds.Any`                                                                                        |
| `resolveListTypeId()` fallback to `AnyList`       | Not needed | Existing element-type matching loop already finds `AnyList` when `tsTypeToTypeId` returns `CoreTypeIds.Any` -- no code change required                                                |
| Mixed-type array compiles and executes            | Done       | --                                                                                                                                                                                    |
| `codegen.spec.ts` tests                           | Done       | 4 new tests                                                                                                                                                                           |
| `type-system.spec.ts` tests (core)                | Done       | 12 new tests (new file created)                                                                                                                                                       |

**Acceptance criteria results:**

| Criterion                                                            | Result                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------- |
| `NativeType.Any` has value `9`, `nativeTypeToString` returns `"any"` | Pass                                                      |
| `AnyCodec` round-trips nil, boolean, number, string                  | Pass                                                      |
| `AnyCodec.stringify` correct for each type                           | Pass                                                      |
| `AnyCodec.encode` throws for unsupported types                       | Pass                                                      |
| `registerCoreTypes()` registers `Any` and `AnyList`                  | Pass                                                      |
| `buildAmbientDeclarations()` includes `AnyList` type alias           | Pass                                                      |
| `[1, "hello", true]` compiles + executes, produces 3-element list    | Pass                                                      |
| `[1, 2, 3]` still resolves to `NumberList` (regression)              | Pass                                                      |
| `tsTypeToTypeId` returns `CoreTypeIds.Any` for multi-type union      | Pass (tested indirectly via mixed-type array compilation) |
| Empty `AnyList`-annotated array compiles                             | Pass                                                      |

**Extra work:**

- Created `packages/core/src/brain/runtime/type-system.spec.ts` (new file, not in
  planned file list) with 12 tests covering `NativeType.Any` enum, `AnyCodec`
  encode/decode/stringify, unsupported-type rejection, and `registerCoreTypes`
  registration verification.

**Discoveries:**

1. **`resolveListTypeId()` required no changes.** The spec planned an explicit fallback
   for `CoreTypeIds.Any` in `resolveListTypeId()`, but the existing element-type
   matching loop (`scan registry for list type whose elementTypeId matches`) already
   finds the `AnyList` type when `tsTypeToTypeId` returns `CoreTypeIds.Any`. The
   difference vs Phase 12 is that `tsTypeToTypeId` now returns a value for union types
   instead of `undefined`.

2. **Roblox `null` constraint.** The `AnyCodec` originally had `value === null` checks,
   but `rbxtsc` rejects `null` (`"null is not supported! Use undefined instead.`).
   Only `value === undefined` is used for nil detection. This is consistent with other
   codecs in the file (none use `null`).

3. **`TypeUtils` required for type discrimination.** The codebase rules prohibit
   `typeof x === "string"` in shared code. `AnyCodec` uses `TypeUtils.isBoolean()`,
   `TypeUtils.isNumber()`, `TypeUtils.isString()` from `platform/types.ts` for
   self-contained type dispatch. This import was added to `type-system.ts`.

4. **`MemoryStream.resetRead()` not `resetReadPosition()`.** The method name for
   resetting the stream read cursor is `resetRead()`, per the platform stream API.

5. **Pre-existing test failure.** The `"actuator with async exec extracts async flag"`
   test in `compile.spec.ts` was already failing (120/121) before Phase 12.1 due to a
   `Promise<void>` type mismatch between the ambient `AMBIENT_HEADER`'s custom
   `Promise` interface and the lib's built-in Promise. Not caused by this phase.

**Test counts:**

- packages/core: 441 total (429 prev + 12 new), 0 failures
- packages/typescript: 125 total (121 prev + 4 new), 1 pre-existing failure

### Phase 12b -- 2026-03-23

**Status:** Complete. All acceptance criteria met.

**Planned vs actual deliverables:**

| Deliverable                        | Status | Notes                                                                                                               |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `IrMapNew`, `IrMapSet` IR nodes    | Done   | Added to `IrNode` union in `ir.ts`                                                                                  |
| `MapNew`, `MapSet` emit cases      | Done   | `emit.ts` -- `emitter.mapNew(typeIdIdx)` and `emitter.mapSet()`                                                     |
| `resolveMapTypeId()` helper        | Done   | Alias-symbol-first, then `getStringIndexType()` fallback to `registry.instantiate("Map", [valueTypeId])`            |
| `lowerObjectLiteral` map detection | Done   | Struct-first, then map, then diagnostic. Refactored into `lowerObjectLiteralAsStruct` and `lowerObjectLiteralAsMap` |
| VM `execMapNew` fix                | Done   | Reads typeId from constant pool via `ins.b` (matching `listNew`/`structNew` pattern)                                |
| Emitter `mapNew` fix               | Done   | Changed from `{ op: MAP_NEW, a: typeId }` to `{ op: MAP_NEW, a: 0, b: typeIdConstIdx }`                             |
| `codegen.spec.ts` tests            | Done   | 5 new tests                                                                                                         |

**Acceptance criteria results:**

| Criterion                                                            | Result |
| -------------------------------------------------------------------- | ------ |
| `{ foo: 1, bar: 2 }` with map annotation -> `MAP_NEW` + 2x `MAP_SET` | Pass   |
| Empty `{}` with map annotation -> `MAP_NEW` only                     | Pass   |
| Map as return value -> correct bytecode                              | Pass   |
| Nested struct-in-map -> correct nested emission                      | Pass   |
| Struct contextual type still -> `STRUCT_NEW` (regression)            | Pass   |

**Extra work (not in spec):**

- Fixed `BytecodeEmitter.mapNew()` operand encoding: was `{ a: typeId }` (raw number,
  ignored by VM), now `{ a: 0, b: typeIdConstIdx }` (constant pool index, matching
  `structNew`/`listNew`). This was listed as a risk in the spec.
- Fixed `execMapNew` in VM to read `ins.b` as constant pool index for typeId string
  (was hardcoding `"map:<unknown>"`).
- Refactored `lowerObjectLiteral` from a monolithic function into a dispatcher +
  two helper functions (`lowerObjectLiteralAsStruct`, `lowerObjectLiteralAsMap`).

**Discoveries:**

1. **`getStringIndexType()` for Record resolution.** When the contextual type is
   `Record<string, T>` (a TS mapped type), `type.getStringIndexType()` returns the
   value type `T`. This is the reliable way to extract the value type from a
   `Record`-like type without inspecting the mapped type structure directly.

2. **No ambient `Map` interface needed.** Unlike `Array<T>` (which needs a constrained
   ambient interface to hide unsupported JS methods), map types as `Record<string, T>`
   use TypeScript's built-in utility type. Property access syntax (`m.foo` /
   `m["foo"]`) works naturally. A dedicated `Map` interface would only be needed if
   we wanted to expose `.get()`/`.set()`/`.has()` method calls.

3. **Struct-first ordering is correct.** The spec noted ambiguity between struct and
   map for object literals. Struct-first works because struct types have specific
   known field names in the registry (resolved via `resolveStructType` symbol name
   lookup), while map types are generic containers. A named type registered as a
   struct will never accidentally resolve as a map.

**Test counts:**

- packages/core: 516 total, 0 failures
- packages/typescript: 169 total (164 prev + 5 new), 0 failures

### Phase 12c -- 2026-03-23

**Status:** Complete. All acceptance criteria met.

**Planned vs actual deliverables:**

| Deliverable                                        | Status | Notes                                                                                     |
| -------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `tryResolveEnumValue()` helper in lowering.ts      | Done   | Uses `getContextualType()` + registry `resolveByName()` + `coreType === NativeType.Enum`  |
| String literal enum detection in `lowerExpression` | Done   | `isStringLiteral` branch calls `tryResolveEnumValue`; falls back to `mkStringValue`       |
| Variable with enum annotation -> `EnumValue`       | Done   | `const d: Direction = "north"` -> `PushConst(EnumValue)`                                  |
| Function argument -> `EnumValue`                   | Done   | `identity("south")` with `Direction` param -> `PushConst(EnumValue)`                      |
| Return value -> `EnumValue`                        | Done   | `return "east"` with `Direction` return type -> `PushConst(EnumValue)`                    |
| Plain string regression check                      | Done   | `return "hello"` with `string` return type -> `StringValue` (unchanged)                   |
| ambient.ts changes                                 | None   | Not needed -- enum types already emitted as string unions with `MindcraftTypeMap` entries |

**Acceptance criteria results:**

| Criterion                                                            | Result |
| -------------------------------------------------------------------- | ------ |
| `"north"` with enum-typed annotation -> `PushConst` with `EnumValue` | Pass   |
| enum value as function argument -> correct `EnumValue` constant      | Pass   |
| enum value as return value -> correct `EnumValue` constant           | Pass   |
| plain string literal without enum context -> `StringValue`           | Pass   |

**Extra work (not in spec):**

- Registered `EqualTo` and `NotEqualTo` operator overloads for enum types in
  `TypeRegistry.addEnumType()` via a `registerEnumOperators()` private method.
  Each enum type automatically gets equality/inequality support when registered.
  Uses `hasBrainServices()` guard to avoid failures in standalone registry scenarios.
  File: `packages/core/src/brain/runtime/type-system.ts`.

**Discoveries:**

1. **No `mkEnumValue` factory in core.** Unlike `mkStringValue`/`mkNumberValue`,
   there is no factory function for `EnumValue`. The value is constructed inline
   as `{ t: NativeType.Enum, typeId, v: expr.text }`. This is fine -- the shape is
   simple and only used in one place.

2. **Enum operator overloads must be per-TypeId.** The operator resolution system
   uses exact TypeId matching (e.g., `"enum:Direction"` not `NativeType.Enum`).
   Overloads cannot be registered generically for "all enums" -- each enum type
   needs its own registration. `addEnumType()` is the right place for this since
   it runs once per enum type and ensures coverage for both core and app-registered
   enums.

3. **Contextual type via `aliasSymbol` is key.** Mindcraft enums are ambient
   `type Direction = "north" | "south"` -- a type alias. The contextual type's
   `getSymbol()` returns `undefined` for type aliases; `aliasSymbol` is the
   correct property. The `??` chain (`getSymbol() ?? aliasSymbol`) handles both
   cases.

4. **TS literal type narrowing affects enum comparison tests.** Comparing two
   different string literal constants (`"north" === "south"`) triggers a TS
   diagnostic ("types have no overlap") because TS narrows string literal types.
   Tests must use function parameters typed as the enum to avoid this.

**Test counts:**

- packages/core: 516 total, 0 failures (unchanged)
- packages/typescript: 176 total (169 prev + 7 new), 0 failures

---

### Phase 13 -- Property access chains + host calls (2026-03-23)

**Status:** Complete. GET_FIELD implementation accepted. The ctx compile-time phantom
approach was initially implemented but subsequently replaced by ctx-as-native-struct
(implemented out of band). All phantom code has been removed. See
[ctx-as-native-struct.md](ctx-as-native-struct.md).
(Updated 2026-03-24: ctx-as-native-struct is now fully implemented. The phase
log below records the original outcomes; the phantom approach described in
"Rejected approach" has since been replaced.)

**Planned vs actual deliverables:**

| Deliverable                                             | Status | Notes                                                                                                      |
| ------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| `IrGetField` IR node                                    | Done   | Added to `IrNode` union in `ir.ts` with `fieldName: string`                                                |
| `GetField` emission                                     | Done   | `emit.ts` -- push field name string constant, call `emitter.getField()`                                    |
| `obj.field` -> `GET_FIELD` for struct-typed expressions | Done   | `lowerPropertyAccess` resolves struct type via `resolveStructType()`, validates field name, emits GetField |
| `ctx.time` / `ctx.dt` / `ctx.tick` -> HOST_CALL_ARGS    | Done   | Initially phantom approach; replaced by ctx-as-native-struct (LoadLocal(0) + GetField)                     |
| `ctx.self.*()` method dispatch                          | Done   | Initially phantom approach; replaced by struct method dispatch via lowerStructMethodCall                   |
| `ctx.engine.*()` method dispatch                        | Done   | Initially phantom approach; replaced by struct method dispatch via lowerStructMethodCall                   |
| `params.xyz` regression preserved                       | Done   | Existing LoadLocal path unchanged                                                                          |
| `list.length` regression preserved                      | Done   | Existing IrListLen path unchanged                                                                          |

**Acceptance criteria results:**

| Criterion                                                        | Result |
| ---------------------------------------------------------------- | ------ |
| `ctx.self.getVariable("x")` -> `HOST_CALL_ARGS`                  | Pass   |
| struct property chain `pos.x` -> `GET_FIELD("x")`                | Pass   |
| chained struct `entity.position.x` -> two `GET_FIELD`s           | Pass   |
| native-backed struct field -> `GET_FIELD` (same bytecode)        | Pass   |
| `ctx.engine.queryNearby(pos, 5)` -> `HOST_CALL_ARGS` with 2 args | Pass   |
| `ctx.engine.nonExistent()` -> compile error                      | Pass   |
| `params.speed` -> `LoadLocal` (regression)                       | Pass   |
| `items.length` -> `IrListLen` (regression)                       | Pass   |

**Additional work (not in spec):**

- `tsconfig.spec.json` -- created to type-check test files. The base `tsconfig.json`
  excludes `**/*.spec.ts`, so `tsc --noEmit` never covered tests. Added
  `tsconfig.spec.json` extending the base with `noEmit: true` and
  `include: ["src/**/*.spec.ts"]`. Updated `typecheck` script to run both configs.
  Updated `test` script to use `tsconfig.spec.json`.

- Struct field name validation -- after `resolveStructType()` succeeds, the field
  name is validated against the struct's `fields` list before emitting GetField.
  Defense-in-depth; the TS checker catches unknown fields first via ambient
  declarations.

- ctx alias tracking -- `isCtxExpression()` recursively follows variable initializers
  (`const c = ctx; c.time` works). `lowerVariableDeclarationList` skips declarations
  that alias ctx (compile-time alias, no local slot). This was part of the phantom
  approach and has been removed in the ctx-as-native-struct refactor.
  (Updated 2026-03-24: all phantom code including ctx alias tracking has been removed.)

**Rejected approach -- ctx as compile-time phantom (subsequently replaced):**

The Phase 13 implementation initially used a compile-time phantom approach: `ctx` had no
runtime representation; the compiler tracked its TS symbol, intercepted property accesses,
and rewrote them to HOST_CALL_ARGS. This was rejected because:

- ctx cannot behave like a regular value (no storage, no aliasing without compiler tricks)
- ~80 lines of special-case code (ctxSymbol tracking, isCtxExpression, isCtxSelfAccess,
  isCtxEngineAccess, lowerCtxMethodCall, variable declaration skip)
- The ambient `Context` interface is hardcoded rather than generated from the type registry
- The original spec (user-authored-sensors-actuators.md section E, "Property access")
  describes `LoadLocal(ctx_index)` + `GetField("self")` -- i.e., ctx as a real value

**Replacement implemented: ctx-as-native-struct.**

(Updated 2026-03-24: The replacement is now fully implemented.) Context, SelfContext,
and EngineContext are registered as native-backed structs with fieldGetters in
`packages/core/src/brain/runtime/context-types.ts`. Struct method dispatch was added as
a general-purpose feature (`StructMethodDecl` on type definitions, `addStructMethods()`
on `ITypeRegistry`, `lowerStructMethodCall()` in the compiler). The ctx `StructValue`
is auto-injected by the VM via `FunctionBytecode.injectCtxTypeId` -- `spawnFiber`
creates the struct from `fiber.executionContext` and prepends it to the caller's args.
The previous manual wrapping via `mkNativeStructValue` in `authored-function.ts` has
been removed. The compiler sets `injectCtxTypeId: ContextTypeIds.Context` on the
`onExecute` and `onPageEntered-wrapper` `FunctionEntry` records; `emitFunction` and
the linker propagate the field to the emitted `FunctionBytecode`. All compile-time
phantom code has been removed. See [ctx-as-native-struct.md](ctx-as-native-struct.md).

**Discoveries:**

1. **The spec describes ctx as `LoadLocal` + `GetField`.** Section E of
   user-authored-sensors-actuators.md shows `LoadLocal(ctx_index)` then
   `GetField("self")` then `GetField("position")`. The phantom approach diverged
   from this spec. The refactor to native-backed struct has restored alignment.
   (Updated 2026-03-24: alignment restored.)

2. **Struct method calls are now a general-purpose feature.** `StructMethodDecl` on
   type definitions, `addStructMethods()` on `ITypeRegistry`, and
   `lowerStructMethodCall()` in the compiler handle method dispatch for any struct
   type with declared methods. The `"TypeName.methodName"` naming convention in the
   FunctionRegistry provides the resolution mechanism. This was identified as a
   gating feature in ctx-as-native-struct.md and has been implemented.
   (Updated 2026-03-24: struct method dispatch is implemented.)

3. **TS checker catches struct field errors before lowering.** The ambient declarations
   mirror the type registry, so unknown fields produce TS diagnostics before lowering
   runs. The lowering field validation is defense-in-depth only.

4. **GET_FIELD dispatch is uniform.** The VM's `execGetField` already dispatches to
   `typeDef.fieldGetter` when present, falling back to Dict lookup. The compiler
   emits identical bytecode for user-creatable and native-backed structs. This was
   validated by the NativeActor test.

5. **Tests were not type-checked.** `tsconfig.json` excludes `**/*.spec.ts`. Added
   `tsconfig.spec.json` and updated `typecheck` script to cover both configs.

**Test counts:**

- packages/core: 516 total, 0 failures (unchanged)
- packages/typescript: 190 total (176 prev + 14 new), 0 failures

### Phase 14 -- `for...of` loop (2026-03-24)

**Status:** Complete. All acceptance criteria met.

**Planned vs actual deliverables:**

| Deliverable                                           | Status | Notes                                                                           |
| ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `lowerForOfStatement()` in `lowering.ts`              | Done   | ~80 lines; desugars to index-based loop using existing IR infrastructure        |
| `ts.isForOfStatement` dispatch in `lowerStatement`    | Done   | Single branch addition                                                          |
| `break`/`continue` via existing loop stack            | Done   | Separate `continueTarget` label so `continue` jumps to increment, not condition |
| List type validation before emitting iterator pattern | Done   | `resolveListTypeId()` check; non-list types produce compile error               |
| Hidden temporaries via `allocLocal()`                 | Done   | `listLocal` and `indexLocal` allocated as hidden locals                         |

**Additional work (not in spec):**

- **Removed custom module-scoped `Array<T>` from ambient declarations** -- the
  custom `Array<T>` interface inside `declare module "mindcraft"` shadowed the
  global `Array<T>` from `lib.es5.d.ts`. TypeScript only recognizes the built-in
  `Array` as iterable at the ES5 target level, so `for...of` on our custom
  `Array<T>` produced TS error 2495 ("not an array type or string type"). Removing
  the custom interface lets TypeScript use its own `Array<T>`, which supports
  `for...of` natively. The tradeoff: the global `Array<T>` exposes methods the
  compiler doesn't yet lower (`splice`, `slice`, `reduce`, etc.), but the lowering
  validates method calls and produces clear diagnostics for unsupported methods.

**Acceptance criteria results:**

| Criterion                                             | Result |
| ----------------------------------------------------- | ------ |
| `for (const x of [1, 2, 3]) { sum += x; }` -> sum = 6 | Pass   |
| `for...of` with `break` -> exits early                | Pass   |
| `for...of` with `continue` -> skips iteration         | Pass   |
| `for...of` over empty list -> body never executes     | Pass   |
| Non-list types produce compile error                  | Pass   |

**Discoveries:**

1. **The custom module-scoped `Array<T>` must be removed.** TypeScript's ES5 target
   only recognizes the built-in global `Array` and `string` as valid `for...of`
   targets (diagnostic 2495). An alternative approach of adding `Symbol.iterator`
   declarations and `downlevelIteration: true` was tried but rejected because it
   caused the module-scoped `Array<T>` to conflict with global `Array<T>` for array
   literals (`Property '[Symbol.iterator]' is missing in type 'number[]' but
required in type 'Array<number>'`). The cleanest fix was removing the custom
   interface entirely and relying on the global one.

2. **Unsupported Array methods are now a separate concern.** With the global
   `Array<T>`, users can call methods like `splice()`, `reduce()`, `sort()` that
   the compiler doesn't lower. These should produce clear compile-time diagnostics.
   This is a follow-up task separate from `for...of` support.

**Test counts:**

- packages/core: 516 total, 0 failures (unchanged)
- packages/typescript: 202 total (198 prev + 4 new), 0 failures

### Array Method Lowering Detour (2026-03-24)

**Status:** Complete. All planned methods implemented; unsupported methods produce diagnostics.

**Context:** In Phase 14 the custom module-scoped `Array<T>` was removed, exposing
the full `lib.es5.d.ts` `Array<T>` interface. Users could call methods the compiler
didn't lower. This detour adds lowering for the most commonly used methods and
surfaces compile-time diagnostics for the rest.

**Planned vs actual deliverables:**

| Deliverable                   | Status   | Notes                                                              |
| ----------------------------- | -------- | ------------------------------------------------------------------ |
| `includes(item)`              | Done     | Loop-based equality search, returns true/false                     |
| `some(fn)`                    | Done     | Loop with early true return on first match, default false          |
| `every(fn)`                   | Done     | Loop with early false return on first mismatch, default true       |
| `find(fn)`                    | Done     | Loop with early return of matching element, default nil            |
| `concat(...args)`             | Done     | New list + push all from source + each arg via emitPushAllFromList |
| `join(sep?)`                  | Done     | Loop with number-to-string conversion + string concatenation       |
| `reverse()`                   | Done     | New list, iterate source backwards and push                        |
| `slice(start?, end?)`         | Done     | New list, push elements in [start, end) range                      |
| `pop`, `shift`, `splice`      | Deferred | Diagnostic: "requires VM-level list mutation ops"                  |
| Unsupported method diagnostic | Done     | All unrecognized array methods produce compile-time error          |

**Additional work (not in spec):**

- **`NonNullExpression` and `AsExpression` unwrapping in `lowerExpression`.** The
  `nums.pop()!` pattern wraps the call in `NonNullExpression`, which was falling
  through to the "Unsupported expression" catch-all. Both type-assertion expression
  kinds now unwrap to their inner expression.

- **Array interface augmentation in ambient.ts.** `find`, `findIndex`, and `includes`
  are ES2015/ES2016 methods not in `lib.es5.d.ts`. Added an `interface Array<T>`
  augmentation in the ambient header to expose these signatures to the type checker.

- **Silent failure fix in `emitPushAllFromList` and `emitToStringForJoinElement`.**
  Both had early-return paths that swallowed errors without pushing diagnostics.
  Fixed to report proper compile-time errors.

**Discoveries:**

1. **`lib.es5.d.ts` is incomplete for modern Array methods.** `find` (ES2015) and
   `includes` (ES2016) are defined in separate lib files (`lib.es2015.core.d.ts`,
   `lib.es2016.array.include.d.ts`). Rather than bundling additional lib files, the
   ambient header augments the global `Array<T>` interface with these signatures.

2. **Type-assertion expressions need explicit handling.** `NonNullExpression` (`x!`)
   and `AsExpression` (`x as T`) have no runtime effect but weren't recognized by
   `lowerExpression`, causing spurious "Unsupported expression" diagnostics. Both
   now unwrap transparently.

3. **The `join()` implementation assumes number elements.** `emitToStringForJoinElement`
   hardcodes `CoreTypeIds.Number -> CoreTypeIds.String` conversion. For string lists
   the conversion is a no-op (the function is not registered), which previously
   silently skipped conversion. Now it produces a diagnostic, but string lists would
   also trigger it incorrectly. A future improvement would resolve the element type
   from the list's `TypeDef` and select the appropriate conversion.

**Test counts:**

- packages/core: 516 total, 0 failures (unchanged)
- packages/typescript: 216 total (202 prev + 14 new), 0 failures

### VM List Mutation Ops Detour (2026-03-24)

**Status:** Complete. All priority methods implemented with VM opcodes and compiler lowering.

**Context:** The Array method lowering detour (above) deferred `pop`, `shift`,
`unshift`, and `splice` because they require in-place list mutation, which the VM
did not support. This detour adds 4 new VM opcodes and the corresponding compiler
IR nodes, emission, and lowering. `sort` was implemented in a subsequent detour;
`fill` and `copyWithin` remain deferred.

**Planned vs actual deliverables:**

| Deliverable                              | Status   | Notes                                                      |
| ---------------------------------------- | -------- | ---------------------------------------------------------- |
| `LIST_POP` opcode (Op 95)               | Done     | Pops last element, pushes removed value (or nil if empty)  |
| `LIST_SHIFT` opcode (Op 96)             | Done     | Shifts first element, pushes removed value (or nil)        |
| `LIST_REMOVE` opcode (Op 97)            | Done     | Removes at index, pushes removed value (or nil)            |
| `LIST_INSERT` opcode (Op 98)            | Done     | Inserts value at index, void (nothing pushed)              |
| Core emitter methods                     | Done     | `listPop()`, `listShift()`, `listRemove()`, `listInsert()` |
| IR nodes (`IrListPop`, etc.)            | Done     | 4 new IR node types added to union                         |
| TypeScript emit cases                    | Done     | Maps IR nodes to emitter methods                           |
| `lowerListPop`                           | Done     | Emits list + `ListPop`                                     |
| `lowerListShift`                         | Done     | Emits list + `ListShift`                                   |
| `lowerListUnshift`                       | Done     | Emits list + push 0 + arg + `ListInsert`, then len         |
| `lowerListSplice`                        | Done     | Loop-based removal + optional insertion items              |
| `fill`, `copyWithin`                     | Deferred | Still produce compile-time diagnostics                     |
| VM unit tests (vm.spec.ts)               | Done     | 6 tests for the 4 new opcodes                              |
| End-to-end tests (codegen.spec.ts)       | Done     | 5 tests: pop, pop-empty, shift, unshift, splice            |

**Design decisions:**

1. **Dedicated `LIST_POP` and `LIST_SHIFT` opcodes** rather than lowering everything
   to `LIST_REMOVE` with index 0 or len-1. This avoids pushing constant index values
   for the most common use cases.

2. **`LIST_INSERT` is void.** Unlike `LIST_PUSH` (which pushes the list back), insert
   pushes nothing. `unshift()` returns new length in JS, so the lowering emits a
   separate `ListLen` after the insert when the return value is needed. When used as
   an expression statement, the `Pop` after the expression discards the length.

3. **`splice()` uses loop-based `LIST_REMOVE`.** Rather than a single complex opcode,
   `splice(start, deleteCount)` emits a loop that calls `LIST_REMOVE` at the start
   index `deleteCount` times, collecting removed elements into a new result list.
   After removal, any insertion arguments emit `LIST_INSERT` at successive indices.

4. **Stack conventions.** `LIST_REMOVE` pops `[index, list]` (index on top).
   `LIST_INSERT` pops `[value, index, list]` (value on top). This matches the
   existing `LIST_GET` and `LIST_SET` operand ordering.

**Still deferred:**

- `fill()`, `copyWithin()` -- low priority, can be added as needed

**Test counts:**

- packages/core: 522 total (516 prev + 6 new), 0 failures
- packages/typescript: 221 total (216 prev + 5 new), 0 failures

### Phase 15 -- Ternary operator + nullish coalescing (2026-03-24)

**Status:** Complete. All acceptance criteria met.

**Planned vs actual deliverables:**

| Deliverable                                            | Status | Notes                                                                              |
| ------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------- |
| `lowerConditionalExpression()` in `lowering.ts`        | Done   | ~10 lines; straightforward JumpIfFalse/Jump/Label pattern                          |
| `ts.isConditionalExpression` dispatch in lowerExpr     | Done   | Single branch addition to the if-else chain                                        |
| `lowerNullishCoalescing()` in `lowering.ts`            | Done   | ~15 lines; Dup + TypeCheck(Nil) + JumpIfFalse pattern                              |
| `QuestionQuestionToken` dispatch in lowerBinaryExpr    | Done   | Added alongside existing `&&`/`||` checks                                          |

**Acceptance criteria results:**

| Criterion                                    | Result |
| -------------------------------------------- | ------ |
| `true ? 1 : 2` -> 1                         | Pass   |
| `false ? 1 : 2` -> 2                        | Pass   |
| `null ?? 42` -> 42                           | Pass   |
| `5 ?? 42` -> 5                               | Pass   |
| nested ternary `a ? (b ? 1 : 2) : 3` -> 2  | Pass   |

**Design decisions:**

1. **`IrTypeCheck(NativeType.Nil)` for `??` instead of EqualTo operator overloads.**
   The spec suggested using `PushConst(NIL_VALUE)` + `HostCallArgs(EqualTo, nil)`.
   This approach was tried first but failed: `EqualTo(Nil, Nil)` always returns
   `true` because it is designed for statically-known nil-nil comparison. When the
   LHS is a non-nil value at runtime (e.g., `5`), the operator lookup still resolves
   the `Nil,Nil` overload (since the static type is `number | null`) and returns
   `true`, incorrectly treating a non-nil value as nil. Using `TypeCheck` directly
   inspects the runtime native type tag, giving correct `??` semantics regardless
   of static type. This is the same mechanism used for `typeof` comparisons.

2. **Ternary uses the same pattern as `if`/`else` statements.** The conditional
   expression emits the exact same JumpIfFalse/Jump/Label structure already used
   by `if`/`else` in `lowerStatement`, just in expression position.

**Discoveries:**

1. **The spec's suggested `??` implementation pattern is incorrect.** The spec
   recommended nil-equality operator overloads, but these resolve based on static
   types. For nullable types (`T | null`), `resolveOperatorWithExpansion` would need
   to find a `Number,Nil` overload for `EqualTo`, and even having one would compare
   the runtime number value against nil conceptually wrong. `TypeCheck` is the
   correct primitive -- it does a runtime tag check without needing operator
   overloads.

2. **Tests beyond the acceptance criteria.** Added 3 additional tests: ternary with
   variable condition (params), `undefined ?? 42` -> 42, and `0 ?? 42` -> 0 (verifying
   `??` does not trigger on falsy values unlike `||`).

**Test counts:**

- packages/core: 522 total, 0 failures (unchanged)
- packages/typescript: 236 total (221 prev + 8 new + 7 from sort detour), 0 failures
