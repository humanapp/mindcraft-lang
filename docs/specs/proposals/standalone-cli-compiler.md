# Standalone Program Compilation + Platform Apps -- Draft Spec

**Status:** Draft
**Date:** 2026-04-27

## Overview

Add a "program" compilation mode to `packages/ts-compiler` that compiles
standalone TypeScript (no brain, no sensors, no actuators) to a generic
Mindcraft bytecode artifact, and define the seam through which a separate
**platform app** wraps the compiler + VM, injects its own ambient API and
host functions, and ships its own CLI.

`packages/ts-compiler` itself does **not** become a CLI. It stays a library.
A platform app is a small package that:

1. Constructs a `PlatformServices` bundle (types, host functions, ambient
   types) describing its target environment.
2. Calls into `ts-compiler` in program mode to produce bytecode.
3. Loads the bytecode into a `Runtime` it owns, providing a host-side
   implementation of every host function it declared.
4. Optionally exposes a CLI (`compile`, `run`, `check`) for that target.

The brain pipeline is one consumer of the same machinery (with a different
services bundle and a different runtime wrapper). A future Node CLI, a
browser playground, or an embedded-device platform is just another package
implementing the same seam.

## Design Principles

- **Layered.** ts-compiler is a library. Targets, host functions, runners,
  and CLIs live in platform-app packages, not in ts-compiler.
- **Reuse the back-end.** No new opcodes, no new IR. Program mode emits the
  same `Program` shape the brain runtime already executes.
- **One mode flag.** Compilation mode is a single discriminated option on
  `CompileOptions`. Existing tile compilation continues to work unchanged.
- **General-TypeScript semantics for top-level code.** A program file's
  top-level statements execute in textual order at program start, the way
  they do in a normal Node script. No `main()` convention is required.
- **Single artifact per program.** A program-mode compilation produces
  exactly one `CompiledProgram`. There is no descriptor, no callsite
  registry, no action table.
- **Platform identity is explicit.** Every artifact records the platform it
  was compiled for; a runtime refuses to load artifacts compiled for a
  different platform.
- **Greenfield.** No backwards-compatibility requirements; no existing
  consumers of program mode. Breaking changes during development are
  acceptable.

## Non-Goals

- No brain features in program mode: no Sensors, Actuators, pages, rules,
  tiles, actions, callsites, or `Context`.
- No sandboxing beyond what the VM already provides. Host functions run
  with full host privileges.
- No new VM features. Host operations go through the existing
  `HostCall` / `HostCallAsync` mechanism.
- ts-compiler does not gain a `bin` entry, IO, ambient host functions, or a
  runner. All of that is platform-app responsibility.
- No package manager, no transitive `node_modules` resolution, no
  `tsconfig.json` discovery beyond the rules in [Module Resolution](#module-resolution).

---

## Architecture

```
+--------------------------------------------------------------+
|  Platform App (one per target, e.g. apps/cli-node)           |
|  - CLI: compile / run / check                                |
|  - PlatformServices: types, host functions, ambient .d.ts    |
|  - Runtime adapter: implements PlatformContext, drives VM    |
|  - Bytecode loader/writer (reads .mcb files)                 |
+--------------------------+-----------------------------------+
                           |
                           v
+--------------------------------------------------------------+
|  packages/ts-compiler    (library)                           |
|  - UserTileProject (tile mode)                               |
|  - UserProgramProject (program mode)  <-- new                |
|  - Validator, lowering, emit, ambient generation             |
|  - Mode flag selects entry-point detection + statement set   |
+--------------------------+-----------------------------------+
                           |
                           v
+--------------------------------------------------------------+
|  packages/core           (library)                           |
|  - VM, fibers, instructions                                  |
|  - PlatformContext interface  <-- new (split from Brain ctx) |
|  - Program / CompiledProgram artifact types                  |
+--------------------------------------------------------------+
```

The brain pipeline (`apps/sim`, the visual editor) is itself a "platform
app" in this taxonomy: it constructs a `PlatformServices` whose registry
includes sensors/actuators, calls the compiler in tile mode, and runs the
result inside a `Brain` (a richer wrapper around the same VM). The seam
this spec defines makes that arrangement explicit instead of implicit.

---

## Package Layout

### `packages/ts-compiler` (library, modified)

- Add program-mode capability (validator + lowering changes, new artifact
  type).
- Continue to export `compileUserTile`, `UserTileProject` unchanged.
- Add `UserProgramProject` (sibling to `UserTileProject`).
- No CLI, no `bin`, no Node-only IO at module top level.

### `packages/core` (library, modified)

- Split the existing `ExecutionContext` into `PlatformContext` (VM-only)
  and `BrainExecutionContext extends PlatformContext` (brain fields).
- Move `Program` (and add `CompiledProgram`) into a neutral location:
  `packages/core/src/runtime/artifact.ts`.
- The brain runtime continues to consume the wider context type; the VM
  references only `PlatformContext`.

### `apps/cli-node` (new platform app)

- Reference implementation of a platform app. Ships a Node-only CLI
  binary named per the platform (default `mcraft-node`).
- Owns `NodePlatformServices`, the default host-function set
  (`print`, `exit`, `time.now`, `env.args`, `env.var`, etc.), and a
  `NodeRuntime` that drives the VM with stdout/stderr/argv/env wired in.
- Depends on `packages/ts-compiler` and `packages/core`.

This spec defines the contract; `apps/cli-node` is the first concrete
platform app and the one used to validate the seam end-to-end.

---

## Compilation Mode

### `CompileOptions` change

Extend `CompileOptions` in `packages/ts-compiler/src/compiler/types.ts`:

```ts
export type CompileMode =
  | { kind: "tile" }                            // existing; default
  | { kind: "program"; entryFile: string };

export interface CompileOptions {
  ambientSource?: string;
  /** Type/function/constant registry. Brain pipeline uses BrainServices;
   *  platform apps construct their own PlatformServices implementation. */
  services: PlatformServices;
  mode?: CompileMode;                           // default: { kind: "tile" }
}
```

`mode.entryFile` is a workspace-relative path matching one of the files
passed to `UserProgramProject.setFiles()` / `updateFile()`. It identifies
the file whose top-level statements form the program's entry sequence. All
other files are importable modules; their top-level statements still
execute (lazily, see [Module Init Order](#module-init-order)).

### Behavior in program mode

1. **Entry-point detection** ([project.ts](packages/ts-compiler/src/compiler/project.ts#L260)):
   - Skip the `extractDescriptor` call entirely.
   - Do not require a `Sensor(...)` or `Actuator(...)` default export.
     Files without one are not skipped; they are compiled as normal
     modules.
   - The file identified by `mode.entryFile` becomes the program entry.

2. **Validator** ([validator.ts](packages/ts-compiler/src/compiler/validator.ts)):
   - Allow all statement kinds at the top level that are already allowed
     inside function bodies. `ExpressionStatement`, `IfStatement`,
     `ForStatement`, `WhileStatement`, `Block`, `SwitchStatement`,
     `TryStatement`, etc., follow their existing per-construct rules.
   - Forbidden constructs remain forbidden (`with`, labeled statements,
     `debugger`, etc.) -- existing diagnostics apply.
   - `return` at the top level is rejected with a new diagnostic
     `E_RETURN_AT_TOP_LEVEL`.
   - `MissingDefaultExport` is suppressed in program mode.

3. **Lowering** ([lowering.ts](packages/ts-compiler/src/compiler/lowering.ts#L1306)):
   - Replace `hasTopLevelInitializers` with `hasTopLevelExecutableContent`,
     true if the file has any of:
     - `VariableStatement` with initializers (existing trigger),
     - Static class field initializers (existing trigger),
     - Any other executable top-level statement (new for program mode).
   - In `generateModuleInitWithImports`, after processing imported
     variable initializers and local top-level variable initializers,
     append an in-order lowering of the remaining executable top-level
     statements (skipping pure declarations: `FunctionDeclaration`,
     `ClassDeclaration`, `InterfaceDeclaration`, `TypeAliasDeclaration`,
     `EnumDeclaration`, `ImportDeclaration`, side-effect-free
     `ExportDeclaration`).
   - The resulting `<module-init>` for the entry file is the program's
     effective entry point.

4. **Artifact shape** ([project.ts](packages/ts-compiler/src/compiler/project.ts#L435)):
   - Emit a `CompiledProgram` (new type, see below) instead of
     `UserAuthoredProgram`. The new type omits `kind`, `key`, `callDef`,
     `outputType`.
   - `entryFuncId` points at the entry file's `<module-init>`.
   - `activationFuncId` is unused in program mode.

### `UserProgramProject`

Sibling to `UserTileProject` in
`packages/ts-compiler/src/compiler/program-project.ts`. Same multi-file
API (`setFiles`, `updateFile`, `compileAll`) but:

- Constructor requires `mode.entryFile`.
- `compileAll()` returns a single `CompiledProgram` (or diagnostics), not
  a per-file map.
- Internally calls the same lowering pipeline used for tile mode, with
  `mode.kind === "program"`.

`UserTileProject` is unchanged.

### `CompiledProgram` artifact

Lives in `packages/core/src/runtime/artifact.ts` (alongside `Program`):

```ts
import type { Program } from "./program.js";
import type { DebugMetadata } from "./debug.js";

/** Standalone bytecode artifact produced by program-mode compilation. */
export interface CompiledProgram extends Program {
  /** Format discriminator. Must equal `"mindcraft.program"`. */
  format: "mindcraft.program";
  /** Schema version of the artifact envelope. Bumped on breaking changes. */
  formatVersion: 1;
  /** Compiler version that produced the artifact, from package.json. */
  compilerVersion: string;
  /** Identifier of the platform the artifact was compiled for. Must
   *  match the runtime's `PlatformServices.platformId` at load time. */
  platformId: string;
  /** Platform schema version the artifact was compiled against. */
  platformVersion: string;
  /** ID of the function executed when the program starts. */
  entryFuncId: number;
  /** Names of host functions referenced by the bytecode. The runtime
   *  validates each is provided before execution begins. */
  requiredHostFunctions: string[];
  /** Optional debug metadata. */
  debug?: DebugMetadata;
}
```

### Bytecode file format

A `.mcb` file is UTF-8 JSON containing exactly one `CompiledProgram`. A
runtime validates `format`, `formatVersion`, `platformId`, and
`platformVersion` before loading. A future binary format is allowed but
out of scope.

---

## Module Resolution

The compiler already resolves relative imports through
`createVirtualCompilerHost`. Program mode inherits these rules with three
additions:

- **Project root.** The platform app supplies the file set and a project
  root. All transitively imported `.ts` files must live under the root.
- **Imports outside root** -> `E_OUT_OF_ROOT` diagnostic.
- **Bare specifiers** other than the platform's ambient module(s) ->
  `E_BARE_SPECIFIER` diagnostic.
- **Extensions.** Only `.ts`. No `.js`, `.mjs`, `.cjs`, JSON, or
  `node_modules`.
- **Ambient module imports.** Resolve to the generated ambient `.d.ts`.
  The ambient module specifier is configurable
  (`PlatformServices.ambientModule`).

### Module init order

The existing post-order traversal of the import graph in
`generateModuleInitWithImports` is reused. A module's `<module-init>`
runs at most once per program activation. Cyclic edges observe
partially-initialized modules, matching ECMAScript module semantics.

---

## Platform Seam

### `PlatformServices`

Defined in `packages/ts-compiler/src/compiler/services.ts` (or a neutral
re-export location). Replaces the implicit "BrainServices is the only
services type" assumption.

```ts
import type { TypeRegistry, FunctionRegistry, ConstantRegistry }
  from "./registries.js";

/** Service bundle that describes a compilation target. Brain pipeline
 *  supplies BrainServices (extends PlatformServices with sensor/actuator
 *  /action registries). Program-mode platforms supply a PlatformServices
 *  directly. */
export interface PlatformServices {
  /** Stable identifier (e.g. "mindcraft.brain", "mindcraft.cli-node").
   *  Recorded on every artifact this platform compiles; verified at
   *  load time. */
  platformId: string;
  /** Semver-style version. Recorded on artifacts; runtime refuses to
   *  load artifacts whose major version differs from its own. */
  platformVersion: string;
  /** Specifier users write in `import { ... } from "<name>"`. */
  ambientModule: string;
  /** Type registry: built-in primitives + platform-specific structs. */
  types: TypeRegistry;
  /** Host function registry. Each entry has a TS signature and a
   *  runtime contract (sync/async, return type). The runtime side of
   *  the function lives in the platform app, not here. */
  functions: FunctionRegistry;
  /** Compile-time constants exposed as ambient identifiers. */
  constants: ConstantRegistry;
}
```

`BrainServices` becomes `interface BrainServices extends PlatformServices`,
adding sensor/actuator/action registries. `descriptor.ts`, the tile-mode
parts of `project.ts`, and the brain runtime continue to require
`BrainServices`. Program-mode code paths require only `PlatformServices`.

`TypeRegistry`, `FunctionRegistry`, `ConstantRegistry` are existing
interfaces. Reusing them lets `ambient.ts`, `lowering.ts`, and the
host-call resolver work without modification.

### Host function metadata vs implementation

The compiler needs the **signature** of every host function. The runtime
needs the **implementation**. These live in different packages:

- `PlatformServices.functions` registers signatures only. Each entry
  declares argument types, return type, sync/async, and a string name.
- The platform app, in its runtime adapter, supplies a parallel
  `Map<string, HostFunctionImpl>` indexed by the same name.
- The runtime validates the maps agree at startup and refuses to launch
  if any name declared in `PlatformServices.functions` is missing an
  implementation, or vice versa.

Keeping signatures separate from implementations lets the same
`PlatformServices` value be reused at compile time in environments where
the runtime impls don't exist (e.g. type-checking in a browser before
shipping a `.mcb` to a Node runner).

### `PlatformContext`

VM-only execution context. Defined in
`packages/core/src/runtime/platform-context.ts`:

```ts
export interface PlatformContext {
  /** Resolves and invokes a host function by name. */
  callHost(name: string, args: unknown[]): unknown;
  callHostAsync(name: string, args: unknown[]): Promise<unknown>;
  /** Clock used by the VM for timeout traps. */
  nowMs(): number;
}
```

`BrainExecutionContext extends PlatformContext` and adds the existing
brain-specific fields (`brain`, `getVariable`, `setVariable`, `currentTick`,
`dt`). The VM (`vm.ts`) references only `PlatformContext`. Brain callers
keep passing the wider type and pick up the narrower seam automatically.

---

## Platform App Contract

A platform app is any package that:

1. Exports a `PlatformServices` value (or a factory that produces one
   given platform-specific options).
2. Exports a runtime adapter that implements `PlatformContext` and
   supplies a `Map<string, HostFunctionImpl>` whose keys exactly match
   `services.functions`.
3. Optionally exports a CLI binary that:
   - Uses ts-compiler's `UserProgramProject` to compile.
   - Writes the produced `CompiledProgram` to a `.mcb` file (JSON).
   - Loads `.mcb` files, validates `platformId` / `platformVersion`, and
     drives the runtime to completion.

Platform apps may add their own concepts on top (e.g. a brain-flavored
app adds rule scheduling, page activation, the `Context` value), as long
as they continue to satisfy the `PlatformContext` seam at the VM
boundary.

### Reference platform: `apps/cli-node`

The first platform app and the one this spec uses for validation.

**Layout**
- `apps/cli-node/package.json` -- `bin: { "mcraft-node": "./dist/cli.js" }`
- `apps/cli-node/src/services.ts` -- `nodePlatformServices()` factory
- `apps/cli-node/src/runtime.ts` -- `NodeRuntime` (`PlatformContext` impl)
- `apps/cli-node/src/host-functions.ts` -- impls keyed by name
- `apps/cli-node/src/cli.ts` -- argv parsing + dispatch
- `apps/cli-node/src/commands/{compile,run,check}.ts`

**Default platform identity**
- `platformId: "mindcraft.cli-node"`
- `platformVersion: "1"` (matches major version of `apps/cli-node`)
- `ambientModule: "mindcraft"`

**Default host functions**

| Function | Signature | Behavior |
|---|---|---|
| `print` | `(message: string) => void` | Writes `message + "\n"` to stdout. |
| `eprint` | `(message: string) => void` | Writes `message + "\n"` to stderr. |
| `exit` | `(code: number) => never` | Sets exit code, traps fiber with sentinel. |
| `time.now` | `() => number` | Milliseconds since program start. |
| `env.args` | `() => List<string>` | Trailing argv after `--`. |
| `env.var` | `(name: string) => string \| null` | Reads a process env var. |

The set is intentionally minimal. Adding more is a follow-up; this spec
defines the seam, not a complete standard library.

### CLI surface (apps/cli-node)

```
mcraft-node compile <entry> [-o <output>] [--root <dir>] [--ambient <file>]
mcraft-node run <bytecode> [--max-ticks <n>] [-- <program-args>...]
mcraft-node check <entry> [--root <dir>] [--ambient <file>]
```

#### `compile`

- `<entry>` -- entry `.ts` file. Required.
- `-o, --output <path>` -- output `.mcb`. Default: `<entry-basename>.mcb`.
- `--root <dir>` -- project root for module resolution. Default:
  directory of `<entry>`.
- `--ambient <file>` -- override ambient `.d.ts`. Default: generated from
  `nodePlatformServices()`.
- Exit codes: `0` success, `1` user error, `2` compile diagnostics, `3`
  internal compiler bug.

#### `run`

- `<bytecode>` -- `.mcb` file produced by any platform app whose
  `platformId` matches `"mindcraft.cli-node"`.
- `--max-ticks <n>` -- safety bound on VM steps. Default: unlimited.
- `-- <program-args>...` -- exposed to the program via `env.args()`.
- Exit codes: program exit code (default `0`), `1` runtime trap, `2`
  bytecode load error (including platform mismatch).

#### `check`

Type-check and validate only; no emit. Exit `0` clean, `2` if errors.

### Runtime lifecycle (apps/cli-node)

```ts
const program = JSON.parse(readFileSync(bytecodePath));
assertProgramArtifact(program);                   // format + version
assertPlatformMatch(program, services);           // platformId + version
assertHostFunctions(program.requiredHostFunctions, hostFns);

const context = new NodeRuntime({
  hostFunctions: hostFns,
  args: programArgs,
  env: process.env,
  programStartMs: Date.now(),
  stdout: process.stdout,
  stderr: process.stderr,
});

const vm = new VM(program);
const fiber = vm.spawnFiber(0, program.entryFuncId, [], context);

const limit = options.maxTicks ?? Infinity;
let steps = 0;
while (!fiber.isComplete) {
  vm.stepFiber(fiber);
  if (++steps > limit) throw new Error("max-ticks exceeded");
}

if (fiber.error && !context.isExitSentinel(fiber.error)) {
  context.stderr.write(formatTrap(fiber.error, program.debug) + "\n");
  process.exit(1);
}
process.exit(context.exitCode ?? 0);
```

`exit(code)` from a host function sets `context.exitCode` and traps the
fiber with a sentinel error the runner treats as normal termination.

There is no scheduler in this platform -- exactly one fiber runs to
completion. Async host calls suspend the fiber; the runner pumps the
microtask queue between `stepFiber` calls. (Day-one scope is sync-only;
if no async host functions are registered, the runner asserts the fiber
never enters `Awaiting`.)

### Termination semantics

Program ends when:

- The entry `<module-init>` returns. Exit code `0` unless `exit()` was
  called.
- `exit(code)` is called. Exit code is `code`.
- A trap is thrown out of bytecode without being caught. Exit code `1`,
  trap formatted to stderr with file/line/column from `program.debug`.

---

## Diagnostics

New diagnostic codes (in `diag-codes.ts`, `CompileDiagCode` namespace,
emitted by the compiler in program mode):

- `E_OUT_OF_ROOT` -- imported `.ts` file is outside project root.
- `E_BARE_SPECIFIER` -- import specifier is not relative and not the
  platform's ambient module.
- `E_RETURN_AT_TOP_LEVEL` -- `return` outside a function in program mode.
- `E_PROGRAM_MODE_ENTRY_NOT_FOUND` -- `mode.entryFile` not in the
  project file set.

`MissingDefaultExport` is suppressed in program mode but otherwise
unchanged.

The CLI formatter (in `apps/cli-node`) prints diagnostics as:

```
<workspace-relative-path>:<line>:<col> error[<code>] <message>
```

Warnings print with `warning[...]`. CLI exit code is `2` if any
error-severity diagnostic was produced.

---

## Test Plan

### Compiler unit tests (`packages/ts-compiler`)

- `program-mode.spec.ts` -- compile a single file with bare top-level
  statements, verify `<module-init>` IR contents, verify
  `CompiledProgram.entryFuncId`.
- `program-mode-validator.spec.ts` -- each statement kind newly allowed
  at top level produces no diagnostic; each still-forbidden kind
  produces the expected error; top-level `return` errors.
- `program-mode-multi-file.spec.ts` -- entry imports helper module;
  module-init runs in dependency order; cycles tolerated.
- `program-mode-artifact.spec.ts` -- artifact has correct
  `format` / `formatVersion` / `platformId` / `platformVersion` /
  `requiredHostFunctions`.

### Backwards compatibility

Run the full existing `packages/ts-compiler` test suite. No tile-mode
test should change. `BrainServices`, `compileUserTile`, and
`UserTileProject` keep their existing semantics with default mode
`tile`.

### Platform app tests (`apps/cli-node`)

- `compile-cmd.spec.ts` -- compile fixture programs, snapshot
  stdout/stderr and exit codes. Verify `.mcb` content.
- `run-cmd.spec.ts` -- compile + run fixtures exercising each default
  host function. Verify stdout, stderr, exit codes, `--`-passed args.
- `errors.spec.ts` -- import out-of-root, bare specifier, top-level
  `return`, missing entry file, platform-mismatch artifact, missing
  host function impl -- each produces the expected diagnostic and exit
  code.

---

## Implementation Phases

### Phase 1 -- Compile-mode plumbing (ts-compiler)

- Add `CompileMode` to `CompileOptions`.
- Introduce `PlatformServices` as the supertype of `BrainServices`.
- Thread `mode` through the project compiler.
- Gate descriptor extraction and `MissingDefaultExport` on
  `mode.kind === "tile"`.
- Validator: allow all currently-allowed-in-functions statements at top
  level when `mode.kind === "program"`.
- Programmatic API only.

### Phase 2 -- Lowering top-level statements (ts-compiler)

- Implement `hasTopLevelExecutableContent`.
- Extend `generateModuleInitWithImports` to append top-level statement
  lowering.
- Add `program-mode.spec.ts` and `program-mode-multi-file.spec.ts`.

### Phase 3 -- `CompiledProgram` artifact (core + ts-compiler)

- Move `Program` to `packages/core/src/runtime/artifact.ts`.
- Define `CompiledProgram` with `format`, `formatVersion`, `platformId`,
  `platformVersion`, `requiredHostFunctions`.
- Add a program-mode emitter in `UserProgramProject`.

### Phase 4 -- VM context split (core)

- Introduce `PlatformContext` in
  `packages/core/src/runtime/platform-context.ts`.
- Migrate the VM to reference only `PlatformContext`.
- Move brain-specific fields to `BrainExecutionContext extends PlatformContext`.
- Existing brain code paths continue to work unchanged.

### Phase 5 -- `apps/cli-node` skeleton

- Scaffold `apps/cli-node` (package.json, tsconfig, build).
- `nodePlatformServices()` with default types/functions/constants.
- Default host function impls: `print`, `eprint`, `exit`, `time.now`,
  `env.args`, `env.var`.
- Generate ambient `.d.ts` from the bundle (`ambient.ts` should work
  once it accepts `PlatformServices`).

### Phase 6 -- `apps/cli-node compile` and `check`

- Argv parser (no third-party deps; hand-rolled).
- `compile` command: read entry, walk imports under root, build virtual
  host, call `UserProgramProject`, write `.mcb` to `--output`.
- `check` command: same path, no emit.
- Diagnostic formatter.

### Phase 7 -- `apps/cli-node run`

- `NodeRuntime` (`PlatformContext` impl).
- `run` command: load `.mcb`, validate envelope + platform, build
  context, drive VM.
- Wire `exit(code)` sentinel to runner exit code.

### Phase 8 -- Documentation and examples

- README in `apps/cli-node` documenting CLI usage.
- Example programs under `apps/cli-node/examples/`: hello-world,
  fizzbuzz, multi-file, exit-codes, env-args.
- Update `packages/ts-compiler/README.md` to point at `apps/cli-node` as
  the canonical program-mode consumer.

---

## Open Questions

1. **Ambient module name across platforms.** Should every platform reuse
   `"mindcraft"` (familiar to users, but ambiguous about which platform
   they're targeting), or should each platform declare its own
   (`"mindcraft.cli-node"`, etc., explicit but verbose)? Default in this
   spec: per-platform via `PlatformServices.ambientModule`; the cli-node
   reference uses `"mindcraft"`.
2. **Platform compatibility check granularity.** `platformVersion` is a
   single string today. Switch to `{major, minor}` and refuse only on
   major mismatch, or keep string + exact match? Default: string +
   major-major comparison; spec-level loose.
3. **Async host functions in cli-node.** Day-one is sync-only. Decide
   whether to ship the microtask pump up front or stub it.
4. **`tsconfig.json` discovery.** Spec says no. Confirm before
   implementation; alternative is a per-platform single hard-coded
   settings file.
5. **Source maps.** `DebugMetadata` is JSON in the artifact today.
   Sidecar `.mcb.map` to keep artifacts small? Default: keep inline;
   revisit when artifacts get large.
6. **Where should `PlatformServices` live?** ts-compiler (where it is
   consumed by compilation) or core (where the runtime also touches
   the host-function names)? Default: ts-compiler exports the
   interface; `BrainServices` extends it; runtime side imports from
   ts-compiler. If that creates an awkward dependency edge for non-brain
   runtimes, revisit by relocating to core.
7. **Should the spec be renamed?** Title still says "Standalone CLI
   Compiler" historically but the scope is now "program-mode +
   platform-app seam". Filename is currently
   `standalone-cli-compiler.md`; consider renaming to
   `program-mode-and-platform-apps.md` after Phase 1.
