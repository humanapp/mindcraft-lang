# Program Tree-Shaking -- Phased Implementation Plan

Created: 2026-04-17
Audience: Copilot-style implementation agents
Status: Phase 4 complete

---

Implement a post-link tree-shaking pass that removes unreachable functions,
constants, and variable names from an `ExecutableBrainProgram`. This reduces
program size for resource-constrained embedded targets and counteracts the
code-size growth expected from an npm-like extension/library system.

---

## Workflow Convention

Each phase follows this loop:

1. **Kick off** -- "Implement Phase N." The implementer reads this doc and any
   relevant instruction files before writing code. After implementation, STOP
   and present the work for review. Do not write the Phase Log entry, amend
   this doc, or perform post-mortem updates during implementation.
2. **Review + refine** -- Followup prompts within the same conversation. A human
   reviewer is expected to inspect the work before the next phase begins.
3. **Declare done** -- "Phase N is complete." Only the user can declare the
   phase complete.
4. **Post-mortem** -- "Run post-mortem for Phase N." This step:
   - diffs planned deliverables vs actual work
   - records the result in the Phase Log, including any new risks discovered
   - propagates discoveries to later phases
   - updates upstream specs if needed
   - updates Status at the top of this doc
   - writes any needed repo memory notes
5. **Next phase** -- Start the next implementation request explicitly. Do not
   proceed automatically.

The planning doc is the source of truth across conversations.

---

## How To Use This Doc

### Phase granularity

- Implement **exactly one phase per user request** unless the user explicitly
  asks to combine phases.
- Do not pull work from a later phase into the current one just because the code
  is nearby.
- If the current phase reveals a design flaw in a later phase, note it in your
  final response, but do not edit this doc until the post-mortem step.
- Between phases, assume a human reviewer will inspect the work. Do not start
  the next phase until the user explicitly requests it.

### Priority order

When the current code conflicts with this plan, prefer:

1. this phased plan
2. the existing implementation

### Completion rule

After implementing a phase:

- run the required verification commands for each modified package
- summarize what changed and any unresolved risks
- stop and wait for review

Do not write the Phase Log during implementation, and do not continue to the
next phase without user approval.

---

## Required Reading For Every Phase

Before starting any phase, reread:

1. this document
2. `.github/instructions/global.instructions.md`
3. `.github/instructions/core.instructions.md`
4. `.github/instructions/brain.instructions.md`
5. `.github/instructions/vm.instructions.md` (if touching runtime code)

---

## Verification Commands

Run the commands for every package modified in the current phase.

### `packages/core`

```sh
cd packages/core && npm run check && npm run build && npm test
```

### `packages/ts-compiler`

```sh
cd packages/ts-compiler && npm run typecheck && npm run check && npm test
```

If a phase touches multiple packages, run all applicable command sets.

---

## Background

### Why tree-shaking is needed

The `ExecutableBrainProgram` produced by `linkBrainProgram()` can contain
unreachable bytecode functions. Dead code enters through three mechanisms:

1. **Unused module exports** -- The ts-compiler's `collectImports()` collects
   ALL exported symbols from every transitively imported module, regardless of
   whether the entry file uses them. Each gets compiled to bytecode.
2. **Unused class methods** -- Every method, getter, setter, and static of
   every exported class is compiled, even if only a subset is called.
3. **Cross-artifact duplication** -- Each user action that imports the same
   shared module gets its own independent copy of all that module's functions,
   constants, and variable names. No deduplication occurs at link time.

With the planned npm-like extension system, programs will import shared
libraries where a small fraction of exports are used. Dead function counts --
and their associated constants and variable names -- will grow substantially.

### Why static analysis is sound

Every function ID in the system originates from a statically enumerable source:

- `Op.CALL` and `Op.MAKE_CLOSURE` instruction operand `a`
- `FunctionValue.funcId` in the constant pool (including recursive captures)
- `PageMetadata.rootRuleFuncIds`
- `ExecutableAction.entryFuncId` and `activationFuncId`
- `Program.entryPoint`

There is no way to synthesize a funcId at runtime. `CALL_INDIRECT` requires a
`FunctionValue` on the stack, and the VM enforces the type tag. Every
`FunctionValue` is created either by `MAKE_CLOSURE` (funcId from instruction
operand) or from a constant pool entry. A conservative reachability walk is
therefore provably sound.

### Design decision: post-link pass

Tree-shaking is implemented as a single pass over the fully linked
`ExecutableBrainProgram`, not per-artifact before linking. This is simpler,
handles all dead code uniformly, and naturally pairs with cross-artifact
constant deduplication.

---

## Sequencing Constraints

1. **Do not begin Phase 2 until Phase 1 is complete.** Phase 2's constant and
   variable name shaking depends on the function reachability set from Phase 1.
2. **Do not begin Phase 3 until Phase 2 is complete.** Phase 3's constant
   deduplication operates on the already-shaken constant pool.
3. **Phase 4 (integration + testing) may begin after Phase 3.** It wires up the
   tree-shaker and adds end-to-end tests.

---

## Phase 1 -- Function Tree-Shaking

### Goal

Remove unreachable functions from an `ExecutableBrainProgram` and remap all
function references. This phase operates only on the `functions` pool; constants
and variable names are left as-is.

### Scope

- New file: `packages/core/src/brain/runtime/tree-shaker.ts`
- No changes to existing files in this phase

### Deliverables

#### 1.1 Reachability walker

Build a function `markReachableFunctions(program: ExecutableBrainProgram): Set<number>`
that returns the set of reachable function indices.

Root set:
- `program.entryPoint` (if defined)
- Every entry in every `page.rootRuleFuncIds` across `program.pages`
- Every `action.entryFuncId` for bytecode actions in `program.actions`
- Every `action.activationFuncId` for bytecode actions in `program.actions`

For each reachable function, scan its instruction list:
- `Op.CALL`: mark `ins.a` as reachable
- `Op.MAKE_CLOSURE`: mark `ins.a` as reachable

Also scan the constant pool for `FunctionValue` entries that are reachable.
A constant is "reachable from a function" if any instruction in that function
references it via `PUSH_CONST(a)`. For each reachable `FunctionValue` constant,
mark `value.funcId` as reachable and recursively scan its `captures` list for
nested `FunctionValue` entries.

Iterate to a fixed point (new functions discovered via constants may reference
further functions).

Note on `FunctionValue` constant reachability: in this phase, since constants
are not being shaken, treat ALL `FunctionValue` entries in the constant pool as
potentially reachable. This is conservative but avoids coupling to Phase 2's
constant shaking. Specifically: scan every constant in `program.constants` for
`FunctionValue` entries (recursively through captures), and mark their funcIds
as reachable if the function that pushes them (via `PUSH_CONST`) is itself
reachable. The simplest correct approach: after the initial root+instruction
scan, do a second pass over all constants -- for each `FunctionValue` constant
whose funcId is already marked reachable OR that appears in a `PUSH_CONST` in
a reachable function, transitively mark the funcId and any funcIds in captures.

#### 1.2 Function remap table

Build a remap table: `oldFuncId -> newFuncId`. Only reachable functions get new
sequential IDs (0, 1, 2, ...). Unreachable functions map to -1 (or are absent).

#### 1.3 Function pool compaction

Build a new `functions` list containing only reachable functions, in remap
order.

#### 1.4 Instruction remapping

For every instruction in every surviving function, remap operands:
- `Op.CALL`: `a = remap[a]`
- `Op.MAKE_CLOSURE`: `a = remap[a]`

No other instruction operands reference `functions[]`.

#### 1.5 Constant pool remapping

For every constant in `program.constants`, if it is a `FunctionValue`, remap
its `funcId`. Recursively remap `FunctionValue` entries in `captures` lists.

This does NOT remove constants -- it only updates funcId references within
existing constants.

#### 1.6 Metadata remapping

Remap all external references to function IDs:
- `program.entryPoint`
- Every value in `program.ruleIndex` (Dict values)
- Every entry in every `page.rootRuleFuncIds`
- Every `action.entryFuncId` and `action.activationFuncId` for bytecode actions

#### 1.7 Public API

Export a single function:

```typescript
export function treeshakeProgram(
  program: ExecutableBrainProgram
): ExecutableBrainProgram;
```

Returns a new program with unreachable functions removed and all references
remapped. If no functions are unreachable, may return the original program
unchanged (avoid unnecessary copying).

#### 1.8 Unit tests

Add `packages/core/src/brain/runtime/tree-shaker.spec.ts` with tests covering:

- A program with no dead functions returns unchanged
- A program with unreachable functions has them removed
- `CALL` operands are remapped correctly
- `MAKE_CLOSURE` operands are remapped correctly
- `FunctionValue` constants have funcIds remapped
- `FunctionValue` constants with captures have nested funcIds remapped
- `rootRuleFuncIds` are remapped
- `ruleIndex` values are remapped
- `entryPoint` is remapped
- Bytecode action `entryFuncId` and `activationFuncId` are remapped
- A function reachable only through a `FunctionValue` constant (not via
  direct `CALL`) is retained
- A function reachable only through a closure capture chain is retained

### Verification

```sh
cd packages/core && npm run check && npm run build && npm test
```

---

## Phase 2 -- Constant and Variable Name Shaking

### Goal

Remove unreachable constants and variable names from the program, and remap all
references.

### Scope

- Modify `packages/core/src/brain/runtime/tree-shaker.ts` (extend the existing
  tree-shaker)
- Modify `packages/core/src/brain/runtime/tree-shaker.spec.ts` (add tests)

### Precondition

Phase 1 is complete. The function pool is already compacted. Every surviving
function's instructions and every constant's `FunctionValue.funcId` are valid.

### Deliverables

#### 2.1 Constant reachability

After function shaking, scan all surviving functions' instructions to find
referenced constant indices:
- `Op.PUSH_CONST`: mark `constants[ins.a]` as reachable
- `Op.LIST_NEW`, `Op.MAP_NEW`, `Op.STRUCT_NEW`, `Op.STRUCT_COPY_EXCEPT`:
  mark `constants[ins.b]` as reachable (typeId string)
- `Op.INSTANCE_OF`: mark `constants[ins.a]` as reachable (typeId string)

For each reachable constant that is a `FunctionValue` with captures, recursively
scan captures for nested `FunctionValue` entries. Those nested values reference
other constants only indirectly (via funcId, already handled by Phase 1), but
the capture values themselves may be constants that need to be retained.

Note: `FunctionValue` constants that are reachable contain funcIds that were
already remapped in Phase 1. No additional function marking is needed here.

#### 2.2 Constant remap table

Build `oldConstIdx -> newConstIdx`. Only reachable constants get new sequential
indices. Constants not referenced by any surviving instruction are dropped.

#### 2.3 Constant pool compaction

Build a new `constants` list containing only reachable constants in remap order.

#### 2.4 Instruction remapping for constants

For every instruction in every surviving function, remap constant operands:
- `Op.PUSH_CONST`: `a = constRemap[a]`
- `Op.LIST_NEW`, `Op.MAP_NEW`, `Op.STRUCT_NEW`, `Op.STRUCT_COPY_EXCEPT`:
  `b = constRemap[b]`
- `Op.INSTANCE_OF`: `a = constRemap[a]`

#### 2.5 Variable name reachability

Scan all surviving functions' instructions:
- `Op.LOAD_VAR`, `Op.STORE_VAR`: mark `variableNames[ins.a]` as reachable

#### 2.6 Variable name remap table and compaction

Build `oldVarIdx -> newVarIdx`. Compact the `variableNames` list.

#### 2.7 Instruction remapping for variable names

For every instruction in every surviving function:
- `Op.LOAD_VAR`: `a = varRemap[a]`
- `Op.STORE_VAR`: `a = varRemap[a]`

#### 2.8 Integration into `treeshakeProgram()`

The public API remains the same `treeshakeProgram()` function. Internally, the
implementation now performs three pool compactions in sequence:

1. Function shaking (Phase 1)
2. Constant shaking (this phase)
3. Variable name shaking (this phase)

Each step produces a remap table; instruction rewriting can be combined into a
single pass over each function's code if desired for efficiency.

#### 2.9 Unit tests

Add tests covering:

- Constants only referenced by dead functions are removed
- Constants referenced by surviving functions are retained
- TypeId constants referenced via `LIST_NEW(b)` / `STRUCT_NEW(b)` etc. are
  retained
- `PUSH_CONST` operands are remapped
- `LIST_NEW` / `MAP_NEW` / `STRUCT_NEW` / `STRUCT_COPY_EXCEPT` `b` operands
  are remapped
- `INSTANCE_OF` `a` operands are remapped
- Variable names only referenced by dead functions are removed
- `LOAD_VAR` / `STORE_VAR` operands are remapped
- A program with no dead constants/variables returns a minimal copy

### Verification

```sh
cd packages/core && npm run check && npm run build && npm test
```

---

## Phase 3 -- Cross-Artifact Constant Deduplication

### Goal

Deduplicate constants in the constant pool after shaking. The linker's
`appendArtifactTables()` blindly appends each artifact's constants without
checking for duplicates. When multiple actions import the same module, common
primitives (numbers, strings, booleans, nil) and typeId strings are duplicated.

### Scope

- Modify `packages/core/src/brain/runtime/tree-shaker.ts`
- Modify `packages/core/src/brain/runtime/tree-shaker.spec.ts`

### Precondition

Phase 2 is complete. The constant pool contains only reachable constants but
may have duplicates.

### Deliverables

#### 3.1 Value equality function

Implement a constant equality check for deduplication-eligible values. Use the
same categorization as `ConstantPool.serializeValue()`:

- `Nil`, `Void`, `Unknown`: always deduplicate (singleton values)
- `Boolean`: deduplicate by `v` field
- `Number`: deduplicate by `v` field
- `String`: deduplicate by `v` field (this covers typeId strings)
- `Enum`: deduplicate by `typeId` + `v` fields
- `Function`: deduplicate by `funcId` + structural capture equality (recursive)
- `List`, `Map`, `Struct`, `Handle`, `Error`: do NOT deduplicate (complex
  mutable values with identity semantics -- same as `ConstantPool` behavior)

Implement this as a `constantKey(value: Value): string | undefined` function
that returns a deterministic string key for deduplicable values and `undefined`
for non-deduplicable ones. This parallels the existing `serializeValue()` in
`constant-pool.ts` but is independent code (the tree-shaker is in the runtime
package, not the compiler).

#### 3.2 Deduplication pass

After constant shaking (Phase 2) removes unreachable constants, run a
deduplication pass:

1. Walk the surviving constant pool. For each constant, compute its key.
2. If the key was seen before, map this constant's index to the earlier one.
3. If the key is new (or undefined/non-deduplicable), keep the constant and
   record its new index.
4. Build a `constDedup` remap table: `postShakeIdx -> deduplicatedIdx`.

#### 3.3 Apply dedup remap

Remap all constant-referencing instruction operands using `constDedup`, same
operands as Phase 2 step 2.4. Also remap any `FunctionValue.funcId` references
if needed (funcIds should already be stable from Phase 1, but `FunctionValue`
constants that are duplicates of each other need to collapse to one entry).

#### 3.4 Integration

The deduplication runs as a final sub-step inside `treeshakeProgram()`, after
constant shaking. The pipeline becomes:

1. Function shaking + remap
2. Constant shaking + remap
3. Variable name shaking + remap
4. Constant deduplication + remap

#### 3.5 Unit tests

Add tests covering:

- Duplicate number constants are collapsed to one
- Duplicate string constants (including typeId strings) are collapsed
- Duplicate boolean/nil/void constants are collapsed
- Duplicate `FunctionValue` constants (same funcId, no captures) are collapsed
- Non-deduplicable complex constants (lists, maps, structs) are preserved as
  separate entries even if structurally identical
- All instruction operands referencing a deduplicated constant point to the
  surviving entry
- A program with no duplicate constants is unchanged

### Verification

```sh
cd packages/core && npm run check && npm run build && npm test
```

---

## Phase 4 -- Integration and End-to-End Testing

### Goal

Wire `treeshakeProgram()` into the brain initialization path and add
end-to-end tests that verify tree-shaking produces correct, runnable programs.

### Scope

- Modify `packages/core/src/brain/runtime/brain.ts` (or the call site of
  `linkBrainProgram()`)
- Modify `packages/core/src/brain/runtime/tree-shaker.spec.ts` (add
  integration-level tests)
- Potentially modify `packages/ts-compiler` test files (if end-to-end tests
  through the ts-compiler pipeline are added)

### Deliverables

#### 4.1 Call site integration

After `linkBrainProgram()` returns an `ExecutableBrainProgram`, call
`treeshakeProgram()` on the result before storing it. Identify the correct
call site in the brain initialization flow (likely in `Brain.initialize()` or
wherever `linkBrainProgram` is called).

The tree-shaker should run unconditionally -- it is a no-op (returns the input
unchanged) when there is no dead code, so there is no need for a feature flag.

#### 4.2 Bytecode verifier validation

After tree-shaking, the program must still pass the `BytecodeVerifier`. Confirm
that the existing `verify()` call (if present) runs after tree-shaking, or add
an explicit `verify()` call in debug/test builds.

#### 4.3 End-to-end execution tests

Add tests that:

1. Compile a brain program with user-authored actions that import a shared
   module with unused exports
2. Link the program
3. Tree-shake the result
4. Verify the shaken program has fewer functions/constants than the linked one
5. Execute the shaken program through the VM and verify correct behavior
   (the program produces the same results as the unshaken version)

If the existing test infrastructure in `brain.spec.ts` or `vm.spec.ts` supports
constructing programs with action artifacts, use that. Otherwise, construct
synthetic programs directly.

#### 4.4 Regression safety

Add a test that tree-shaking a program with no dead code produces a
functionally identical program (same number of functions, constants, variable
names; same execution results).

### Verification

```sh
cd packages/core && npm run check && npm run build && npm test
```

---

## Phase Log

Filled in during post-mortem after each phase is declared complete.

### Phase 1

Completed: 2026-04-17

**Planned vs Actual:**
All deliverables (1.1-1.8) delivered as specified. No scope creep.

**Unplanned additions:**
- Debug logging via platform `logger.debug` listing shaken function names (user-requested)
- Export added to `runtime/index.ts` barrel (required for test import pattern)

**Files changed:**
- NEW: `packages/core/src/brain/runtime/tree-shaker.ts`
- NEW: `packages/core/src/brain/runtime/tree-shaker.spec.ts`
- MOD: `packages/core/src/brain/runtime/index.ts`

**Discoveries for later phases:**
- Tests must import from `@mindcraft-lang/core/brain/runtime` (built output),
  not relative source paths, to avoid circular dependency with `ValueDict extends Dict`.
- `ActionDescriptor` requires `callDef` and `isAsync` -- test stubs use
  `as never` cast on the whole descriptor object.
- Native `Set`/`Array` unavailable on Roblox -- used `UniqueSet`/`List` instead.

**Risks:** None discovered.

### Phase 2

Completed: 2026-04-17

**Planned vs Actual:**
All deliverables (2.1-2.9) delivered as specified.

**Unplanned additions:**
- `buildFuncRemapTable` generalized to `buildRemapTable`, reused for all three
  pool types (functions, constants, variable names).
- `remapFuncIdInInstruction` replaced with unified `remapInstruction` that
  applies function, constant, and variable name remaps in a single pass per
  instruction.
- Separate `logger.debug` lines for constants and variable names removed.
- Extra test "constants and variable names are shaken even when no functions
  are dead" added beyond spec coverage.
- Updated existing test "variable names are preserved" to assert shaking
  behavior.

**Files changed:**
- MOD: `packages/core/src/brain/runtime/tree-shaker.ts`
- MOD: `packages/core/src/brain/runtime/tree-shaker.spec.ts`

**Discoveries for later phases:**
- The spec's 2.1 note about recursively scanning `FunctionValue` captures for
  additional constants is unnecessary -- captures contain values (including
  `FunctionValue` with funcIds), not constant pool indices. The existing Phase 1
  funcId remapping already handles this. Phase 3's deduplication does not need
  to account for indirect constant references through captures either.

**Risks:** None discovered.

### Phase 3

Completed: 2026-04-17

**Planned vs Actual:**
All deliverables (3.1-3.5) delivered as specified.

**Unplanned additions:**
- `remapInstructionConsts()` -- a focused constant-only instruction remapper
  extracted for the dedup pass, separate from the unified `remapInstruction()`
  used by the shaking passes. This avoids needing dummy func/var remap tables.
- Dedup also runs on the early-return path (no dead code) so programs with
  only duplicate constants still benefit.
- Initial implementation used `List.join()` which does not exist on the
  platform `List` type. Fixed by building the key string with manual
  concatenation in a loop.

**Files changed:**
- MOD: `packages/core/src/brain/runtime/tree-shaker.ts`
- MOD: `packages/core/src/brain/runtime/tree-shaker.spec.ts`

**Discoveries for later phases:**
- `List` has no `.join()` method -- use manual string concatenation loops
  when building composite keys from list contents.
- `execution_subagent` may run commands beyond what was requested if the
  query is vague. For verification steps, use `run_in_terminal` directly
  or constrain the subagent to exact commands only.

**Risks:** None discovered.

### Phase 4

Completed: 2026-04-17

**Planned vs Actual:**
All deliverables (4.1-4.4) delivered as specified. Scope expanded to include
ts-compiler end-to-end tests (spec listed this as optional with "Potentially
modify `packages/ts-compiler` test files").

**Unplanned additions:**
- `packages/ts-compiler/src/compiler/tree-shaking.spec.ts` -- 6 end-to-end
  tests that compile multi-file TypeScript projects, wrap as
  `ExecutableBrainProgram`, tree-shake, and verify both size reduction and
  correct VM execution. Covers unused functions, dead-function constants,
  unused class methods, unused module exports, diamond imports, and the
  no-dead-code identity case.
- `wrapAsExecutable()` helper in ts-compiler tests -- wraps a
  `UserAuthoredProgram` into an `ExecutableBrainProgram` with a
  `BytecodeExecutableAction` so entry/activation funcIds are reachable roots.

**Files changed:**
- MOD: `packages/core/src/brain/runtime/brain.ts` (import + call site)
- MOD: `packages/core/src/brain/runtime/tree-shaker.spec.ts` (6 integration tests)
- NEW: `packages/ts-compiler/src/compiler/tree-shaking.spec.ts` (6 e2e tests)

**Discoveries:**
- `Op.CALL` uses `ins.b` for argc. The `BytecodeVerifier` checks
  `argc !== callee.numParams` and rejects mismatches. Integration tests
  that run through the VM must set `b` correctly on CALL instructions.
- Module-level `export const` values become callsite var initializers in the
  activation function. Since activation is a reachable root, those constants
  are not tree-shakeable at the per-artifact level -- only constants
  referenced exclusively by dead functions can be removed.
- Compiled user programs that use callsite vars require running the activation
  function and setting `fiber.callsiteVars` before execution, even after
  wrapping as `ExecutableBrainProgram`.
- Non-imported helper modules are excluded entirely by the ts-compiler's
  `collectImports()` -- they never appear in the compiled output, so there
  is nothing for the tree-shaker to remove in that case.

**Risks:** None discovered.
