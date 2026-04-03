# Diagnostics Bridge Pipeline -- Phased Implementation Plan

Delivers compiler-emitted diagnostics from the Mindcraft browser app (where
compilation runs) through the vscode-bridge relay server to the VS Code extension,
where they are displayed in the Problems panel.

See also:
- [vscode-authoring-debugging.md](vscode-authoring-debugging.md) -- sections 4
  (Compilation Pipeline) and 16 (Protocol Design) define the target message shapes.
- [typescript-compiler-phased-impl-p2.md](typescript-compiler-phased-impl-p2.md) --
  the compiler phased plan; Phases 22-25 add debug metadata emission.
- [user-authored-sensors-actuators.md](user-authored-sensors-actuators.md) --
  spec for user-authored tiles.

---

## Workflow Convention

Same loop as the compiler phased plan:

1. **Kick off** -- "Implement Phase N." Read this doc and relevant instruction
   files before writing code. After implementation, STOP and present work.
2. **Review + refine** -- Followup prompts.
3. **Declare done** -- Only the user declares a phase complete.
4. **Post-mortem** -- "Run post-mortem for Phase N." Diff planned vs actual,
   record in Phase Log, propagate discoveries.
5. **Next phase** -- New conversation (or same if context is not exhausted).

---

## Current State

(2026-04-02)

### Compilation side (sim app / bridge-app)

- Compilation runs **in the Mindcraft browser app** (`apps/sim/`).
- `apps/sim/src/services/user-tile-compiler.ts` wraps `UserTileProject` from
  `@mindcraft-lang/typescript`. Calls `compileAll()` on every file change.
- `apps/sim/src/services/vscode-bridge.ts` manually wires
  `fromRemoteFileChange` to dispatch to `user-tile-compiler`. This wiring
  should move to `bridge-app` via a `CompilationProvider` interface
  (Phase D2.5) so other apps get it automatically.
- `ProjectCompileResult` contains:
  - `results: Map<string, CompileResult>` -- per-file diagnostics + compiled
    program.
  - `tsErrors: Map<string, CompileDiagnostic[]>` -- TypeScript checker errors
    (shared across files in the project).
- `CompileDiagnostic { code, message, severity, line?, column?, endLine?,
  endColumn? }` -- full source ranges and severity. `severity` is
  `"error" | "warning" | "info"` (required). `line` and `column` are 1-indexed.
  All diagnostic creation sites (`makeDiag` in `lowering.ts`, `addDiag` in
  `validator.ts` and `descriptor.ts`, TS diagnostic mapping in `project.ts`,
  emit-phase errors in `emit.ts`) populate these fields. TS checker diagnostics
  map severity from `ts.DiagnosticCategory`; all compiler-emitted diagnostics
  use `"error"`. The `CompileDiagnostic` -> `CompileDiagnosticsPayload` mapping
  in Phase D3 is a direct passthrough with no synthesis needed.
- `user-tile-compiler.ts` exposes `onCompilation(fn)` and `onRemoval(fn)`
  listener hooks. Currently only consumed by `console.log`-style logging.
  No subscriber sends diagnostics to the bridge.

### Bridge (apps/vscode-bridge)

- App-side compile handlers relay `compile:diagnostics` and
  `compile:status` messages to all paired extensions (Phase D2).
- `compile.handler.ts` validates payloads with Zod schemas from
  `bridge-protocol`, looks up the `AppSession`, and broadcasts to
  extensions via `getExtensionsByAppSessionId()` + `safeSend()`.
- Three empty handler stubs exist on the extension side:
  - `compile.handler.ts` -- exports `compileHandlers: WsHandlerMap = {}`
  - `debug.handler.ts` -- exports `debugHandlers: WsHandlerMap = {}`
  - `project.handler.ts` -- exports `projectHandlers: WsHandlerMap = {}`
- The extension router spreads these into the handler lookup, so adding entries
  to them is sufficient to activate new message types.
- Message forwarding pattern: app router checks `pendingRequests` for response
  correlation, then dispatches to handler map. Extension router dispatches
  directly to handler map.
- `safeSend(ws, JSON.stringify({ type, id?, payload? }))` is the outbound
  primitive on both sides.

### Bridge protocol (packages/bridge-protocol)

- `messages/shared.ts` -- `FilesystemChangeMessage`, `FilesystemSyncMessage`,
  `SessionHelloMessage`, etc.
- `messages/compile.ts` -- `CompileDiagnosticsMessage`,
  `CompileStatusMessage`, and their payload/entry/range types (Phase D1).
  Zod validation schemas `compileDiagnosticsPayloadSchema` and
  `compileStatusPayloadSchema` added in Phase D2.
- `messages/app.ts` -- `AppClientMessage` (union of all app-to-bridge
  messages, includes `CompileDiagnosticsMessage` and `CompileStatusMessage`).
- `messages/extension.ts` -- `ExtensionClientMessage`,
  `ExtensionServerMessage` (includes `CompileDiagnosticsMessage` and
  `CompileStatusMessage`).
- `notifications.ts` -- `FileSystemNotification` (write/delete/rename/mkdir/
  rmdir/import actions), `FilesystemSyncPayload`.

### VS Code extension (apps/vscode-extension)

- `extension.ts` activates: registers `mindcraft://` FileSystemProvider,
  tree view, commands, status bar.
- `project-manager.ts` manages `Project<ExtensionClientMessage,
  ExtensionServerMessage>`, handles `session:appStatus`, filesystem sync,
  pending changes queue.
- Listens for `session:appStatus` (bound, clientConnected, bindingToken).
- Handles `filesystem:change` from bridge (fires VS Code `FileChangeEvent`).
- **No `DiagnosticCollection` exists.** No compilation feedback is displayed.
- **No listener for compile messages.** The extension does not subscribe to
  any `compile:*` or `diagnostics` message types.

### Data flow gap

```
sim compiles tile
  |
  v
CompileResult with diagnostics (in-memory, sim only)
  |
  X -- no CompilationProvider wired in bridge-app
  |
bridge-app (AppProject) -- would drive compile + emit diagnostics (Phase D2.5)
  |
  X -- no provider connected yet
  |
vscode-bridge -- compile handlers relay to extensions (Phase D2)
  |
  X -- no message relayed (no sender yet)
  |
vscode-extension -- no diagnostic display
```

---

## Phases

### Phase D1: Protocol -- compilation diagnostic message types

**Objective:** Define the `compile:diagnostics` message type in
`bridge-protocol` so both sides have a shared contract for diagnostic data.

**Packages/files touched:**

- `packages/bridge-protocol/src/messages/shared.ts` (or new
  `compile.ts` file) -- add `CompileDiagnosticsPayload` and
  `CompileDiagnosticsMessage` interfaces.
- `packages/bridge-protocol/src/messages/app.ts` -- add
  `CompileDiagnosticsMessage` to `AppClientMessage` union (app sends
  diagnostics).
- `packages/bridge-protocol/src/messages/extension.ts` -- add
  `CompileDiagnosticsMessage` to `ExtensionServerMessage` union (extension
  receives diagnostics).
- `packages/bridge-protocol/src/index.ts` -- export new types.

**Concrete deliverables:**

1. `CompileDiagnosticsPayload` interface:
   ```
   {
     file: string;            -- path relative to project root (e.g. "sensors/nearby.ts")
     version: number;         -- monotonic revision so the extension can ignore stale messages
     diagnostics: Array<{
       severity: "error" | "warning" | "info";
       message: string;
       code: string;           -- e.g. "MC2001", "TS2339"
       range: {
         startLine: number;    -- 1-based
         startColumn: number;  -- 1-based
         endLine: number;
         endColumn: number;
       };
     }>;
   }
   ```
2. `CompileDiagnosticsMessage`:
   ```
   { type: "compile:diagnostics"; id?: string; payload: CompileDiagnosticsPayload }
   ```
3. `CompileStatusPayload` interface (optional, for status bar integration):
   ```
   {
     file: string;
     success: boolean;
     diagnosticCount: { error: number; warning: number };
   }
   ```
4. `CompileStatusMessage`:
   ```
   { type: "compile:status"; id?: string; payload: CompileStatusPayload }
   ```
5. Both message types added to the appropriate union types.

**Acceptance criteria:**

- `packages/bridge-protocol` builds without errors.
- Message type unions are updated so `ProjectSession.on("compile:diagnostics")`
  is type-safe on the extension side.
- Message type unions are updated so `session.send("compile:diagnostics")`
  is type-safe on the app side.

**Key risks:**

- **Diagnostic range and severity -- back-propagated to compiler.** The
  protocol requires `startLine/startColumn/endLine/endColumn` and `severity`.
  Rather than synthesizing these in Phase D3, the `CompileDiagnostic`
  interface in `packages/typescript/src/compiler/types.ts` will be enhanced
  to carry `endLine?`, `endColumn?`, and
  `severity?: "error" | "warning" | "info"` natively. All three diagnostic
  creation sites (`makeDiag` in lowering, `addDiag` in validator, TS
  diagnostic mapping in project.ts) already have access to full span info
  from the TS AST; the fields just need to be populated. This prerequisite
  is tracked in [typescript-compiler-phased-impl-p2.md](typescript-compiler-phased-impl-p2.md)
  Current State section. Phase D3's mapping becomes a direct passthrough
  rather than a synthesis step.
- **File path namespace.** Paths must match between what the extension sees
  via `mindcraft://` filesystem and what the compiler uses. Both use
  project-relative paths (e.g., `sensors/foo.ts`), but verify no leading
  slash mismatch.

---

### Phase D2: Bridge relay -- compile message forwarding

**Objective:** Add handlers to the vscode-bridge that relay
`compile:diagnostics` and `compile:status` messages from the app to all
paired extensions.

**Packages/files touched:**

- `apps/vscode-bridge/src/transport/ws/app/handlers/compile.handler.ts`
  (new file) -- handler for `compile:diagnostics` and `compile:status` that
  broadcasts to all paired extensions.
- `apps/vscode-bridge/src/transport/ws/app/router.ts` -- spread
  `compileHandlers` into the app router's handler map.

**Concrete deliverables:**

1. App-side `compile.handler.ts` with two handlers:
   - `"compile:diagnostics"` -- validate payload, look up the `AppSession`,
     get all paired extensions via `getExtensionsByAppSessionId()`, broadcast
     to each via `safeSend()`.
   - `"compile:status"` -- same broadcast pattern.
2. App router updated to dispatch `compile:diagnostics` and `compile:status`
   to the new handlers.

**Acceptance criteria:**

- Bridge builds and passes existing tests.
- A `compile:diagnostics` message from an app WebSocket is relayed to all
  paired extension WebSockets.
- A `compile:diagnostics` message from an unpaired app is silently dropped.

**Key risks:**

- **Message validation.** The bridge should validate the payload shape before
  relaying. Use a zod schema consistent with the protocol types from Phase D1.
  Invalid payloads should be logged and dropped, not forwarded.
- **No extension-side compile handlers needed.** The extension receives
  `compile:diagnostics` through its normal message dispatch (the
  `ProjectSession.on()` listener). The bridge just relays; no extension-side
  handler file is needed for receiving push messages.

---

### Phase D2.5: Compilation lifecycle in bridge-app

**Objective:** Move the file-change -> compile -> diagnostic-emission loop
out of the sim app and into `bridge-app`, so any Mindcraft app that connects
to the bridge gets diagnostic forwarding automatically.

**Motivation:** Phase D3 as originally written placed compilation wiring and
diagnostic emission entirely in `apps/sim`. Any future app (lbb, etc.) would
have to duplicate that plumbing. The compilation lifecycle is generic and
belongs in the shared `bridge-app` package. Sim-specific concerns (consuming
compiled programs for its tile runtime) stay in the sim.

**Packages/files touched:**

- `packages/bridge-app/src/compilation.ts` (new file) -- defines the
  `CompilationProvider` interface and the `CompilationManager` class that
  drives compile-on-change and diagnostic emission.
- `packages/bridge-app/src/app-project.ts` -- accept an optional
  `CompilationProvider` in `AppProjectOptions`, create and wire a
  `CompilationManager` when one is provided.
- `packages/bridge-app/src/index.ts` -- export new types.

**Concrete deliverables:**

1. `CompilationProvider` callback interface:
   ```
   interface CompilationProvider {
     fileWritten(path: string, content: string): void;
     fileDeleted(path: string): void;
     fileRenamed(oldPath: string, newPath: string): void;
     fullSync(files: Iterable<[string, { kind: string; content?: string }]>): void;
     compileAll(): CompilationResult;
   }
   ```
   `CompilationResult` provides per-file diagnostics in a shape close to
   `ProjectCompileResult` but mapped to the protocol's
   `CompileDiagnosticEntry[]` per file. The exact shape should avoid
   coupling `bridge-app` to `@mindcraft-lang/typescript` internals -- the
   provider is responsible for the mapping.
   ```
   interface CompilationResult {
     files: Map<string, CompileDiagnosticEntry[]>;
   }
   ```
2. `CompilationManager` class:
   - Constructed with a `CompilationProvider` and a send function
     `(msg: AppClientMessage) => void`.
   - Exposes `handleFileChange(ev: FileSystemNotification): void` which
     dispatches `write`/`delete`/`rename`/`import` to the provider, then
     calls `compileAll()` and emits diagnostics.
   - After `compileAll()`, iterates the result. For each file with
     diagnostics (or a file that previously had diagnostics but now has
     zero), sends a `compile:diagnostics` message with the full list
     (empty array = file is clean).
   - Tracks a `version` counter per file (increment on each compilation)
     so the extension can discard stale messages.
   - Optionally sends `compile:status` per file with
     `{ success, diagnosticCount }`.
   - Only sends when the session is connected. Does not queue diagnostics
     for offline delivery -- they become stale immediately.
   - Exposes `onCompilation(fn)` and `onRemoval(fn)` listener hooks so
     the app can observe results (e.g., sim needs compiled programs).
3. `AppProject` integration:
   - `AppProjectOptions` gains an optional `compilationProvider` field.
   - When present, `AppProject` creates a `CompilationManager` and wires
     it into `fromRemoteFileChange` so inbound file changes trigger
     compilation automatically.
   - The app can still override `fromRemoteFileChange` for additional
     side effects (e.g., persisting filesystem to localStorage), but the
     compilation loop is handled by `AppProject` internally.
   - Exposes `compilation: CompilationManager | undefined` so the app
     can subscribe to `onCompilation`/`onRemoval`.

**Acceptance criteria:**

- `packages/bridge-app` builds without errors.
- When `AppProject` is constructed with a `CompilationProvider`, inbound
  file changes trigger compilation and diagnostic emission without any
  app-level wiring.
- When `AppProject` is constructed without a `CompilationProvider`, behavior
  is identical to today (no compilation, no diagnostic messages).
- `CompilationManager` emits `compile:diagnostics` only when the session
  is connected.
- Per-file version counters increment monotonically across compilations.
- Files that become clean (zero diagnostics) emit an empty diagnostics
  array to clear the extension's Problems panel.
- Files that are removed emit an empty diagnostics array followed by an
  `onRemoval` callback.

**Key risks:**

- **Coupling to compiler types.** `bridge-app` must not depend on
  `@mindcraft-lang/typescript`. The `CompilationProvider` interface is the
  seam -- the app provides an adapter that wraps the compiler and maps
  its output to `CompileDiagnosticEntry[]`. `bridge-app` depends only on
  `bridge-protocol` for the diagnostic entry type.
- **`fromRemoteFileChange` composition.** Today `AppProject` inherits the
  no-op `fromRemoteFileChange` from `Project`, and the app overrides it.
  With compilation support, `AppProject` needs to call the
  `CompilationManager` and still allow app-level side effects. Use a
  listener pattern (e.g., `onRemoteFileChange`) or chain the override
  so both the compilation manager and the app's callback are invoked.
- **Compilation frequency.** `compileAll()` runs on every file change
  (write, delete, rename, fullSync). This could produce a burst of
  diagnostic messages. Start without debouncing; add it if bridge traffic
  is problematic.
- **TS error deduplication.** The provider's `compileAll()` returns
  already-merged diagnostics per file. Deduplication of TS checker errors
  vs compiler diagnostics is the provider's responsibility, not the
  manager's.

---

### Phase D3: Sim integration -- wire CompilationProvider

**Objective:** Sim provides a `CompilationProvider` adapter to `AppProject`,
replacing the manual file-change dispatch in `vscode-bridge.ts` and the
compilation listener plumbing in `user-tile-compiler.ts`.

**Packages/files touched:**

- `apps/sim/src/services/vscode-bridge.ts` -- pass a `CompilationProvider`
  to `AppProject`, subscribe to `onCompilation`/`onRemoval` for the sim
  runtime cache.
- `apps/sim/src/services/user-tile-compiler.ts` -- refactor to expose a
  `CompilationProvider`-compatible interface. The module still owns the
  `UserTileProject` instance and the compile cache, but its file-change
  methods are now called by `bridge-app` rather than by `vscode-bridge.ts`.

**Concrete deliverables:**

1. `user-tile-compiler.ts` exports a `CompilationProvider`-compatible
   adapter. The `compileAll()` method calls `UserTileProject.compileAll()`
   and maps `ProjectCompileResult` + `tsErrors` into the protocol's
   `CompileDiagnosticEntry[]` per file, merging/deduplicating TS checker
   errors with compiler diagnostics.
2. `vscode-bridge.ts` passes the adapter as `compilationProvider` in
   `AppProjectOptions`. The manual `fromRemoteFileChange` override that
   dispatched to `userTileCompiler.fileWritten/fileDeleted/fileRenamed/
   fullSync` is removed -- `AppProject` handles this via the
   `CompilationManager`.
3. `vscode-bridge.ts` subscribes to `project.compilation.onCompilation()`
   to update the sim's runtime cache with compiled programs. The
   `onRemoval()` hook clears removed files from the cache.
4. `vscode-bridge.ts` retains its filesystem persistence side effect
   (saving to localStorage on file changes) via `onRemoteFileChange`
   or equivalent hook from D2.5.

**Acceptance criteria:**

- After a file save triggers compilation, all paired extensions receive
  `compile:diagnostics` for that file.
- When a file goes from having errors to being clean, extensions receive
  an empty diagnostics array (clearing the file's problems).
- When a file is deleted, extensions receive an empty diagnostics array.
- Messages are only sent when the bridge session is connected.
- Sim's tile runtime still receives compiled programs and can execute them.
- Sim's existing compilation logging still works.

**Key risks:**

- **File path alignment.** The compiler uses paths like `sensors/foo.ts`.
  The extension's `mindcraft://` filesystem sees paths like
  `/sensors/foo.ts` (leading slash from URI). The protocol message should
  use the project-relative form without leading slash, and the extension
  must normalize when mapping to URIs.
- **Filesystem persistence.** `vscode-bridge.ts` currently saves the
  filesystem to localStorage inside `fromRemoteFileChange`. After the
  refactor, this side effect must be preserved via whatever hook D2.5
  provides for app-level file-change observation.

---

### Phase D4: Extension display -- DiagnosticCollection in Problems panel

**Objective:** The VS Code extension receives `compile:diagnostics` messages
and displays them in the Problems panel using a `DiagnosticCollection`.

**Packages/files touched:**

- `apps/vscode-extension/src/services/diagnostics-manager.ts` (new file) --
  manages a `vscode.DiagnosticCollection`, listens for `compile:diagnostics`
  messages, maps payloads to `vscode.Diagnostic` objects.
- `apps/vscode-extension/src/services/project-manager.ts` -- instantiate
  and wire up the diagnostics manager when a project is connected.
- `apps/vscode-extension/src/extension.ts` -- register the diagnostic
  collection in the extension context for proper disposal.

**Concrete deliverables:**

1. `DiagnosticsManager` class:
   - Creates `vscode.languages.createDiagnosticCollection("mindcraft")`.
   - Exposes `handleDiagnostics(payload: CompileDiagnosticsPayload): void`.
   - Maps each diagnostic entry to a `vscode.Diagnostic`:
     - `range`: `new vscode.Range(startLine - 1, startColumn - 1,
       endLine - 1, endColumn - 1)` (VS Code is 0-based).
     - `severity`: `"error"` -> `DiagnosticSeverity.Error`, `"warning"` ->
       `Warning`, `"info"` -> `Information`.
     - `message`, `code`, `source: "mindcraft"`.
   - Calls `collection.set(uri, diagnostics)` with the `mindcraft://`-scheme
     URI for the file.
   - Tracks per-file version; ignores messages with `version` less than the
     last seen version for that file.
2. `ProjectManager` integration:
   - On `session.on("compile:diagnostics", ...)`, delegates to
     `diagnosticsManager.handleDiagnostics(msg.payload)`.
   - On disconnect, calls `diagnosticsManager.clear()` to remove all
     stale diagnostics.
3. Diagnostics appear in the Problems panel with the `mindcraft` source
   label, grouped by file.

**Acceptance criteria:**

- After compilation with errors, the Problems panel shows diagnostics for
  the affected `mindcraft://` files.
- After fixing errors and recompiling, the Problems panel clears the
  diagnostics for that file.
- After disconnecting from the bridge, all Mindcraft diagnostics are cleared.
- Stale messages (lower version) are ignored.

**Key risks:**

- **URI scheme matching.** The `mindcraft://` file system provider uses URIs
  like `mindcraft:///sensors/foo.ts` (note triple slash -- scheme + empty
  authority + absolute path). The diagnostic collection must use the same
  URI form. Use `vscode.Uri.from({ scheme: "mindcraft", path: "/" + file })`
  to construct URIs, matching the pattern in `project-manager.ts`.
- **Diagnostic lifetime.** Setting an empty array on a URI clears its
  diagnostics. The manager must send `collection.set(uri, [])` when a file
  becomes clean, not just omit the file.
- **Reconnection.** After reconnect + resync, the sim will recompile and
  send fresh diagnostics. The extension should clear stale diagnostics on
  disconnect and accept fresh ones on reconnect. No special "request all
  diagnostics" message is needed -- the fullSync triggers recompilation
  which emits diagnostics.

---

### Phase D5: Status bar compilation feedback

**Objective:** Show compilation status in the VS Code status bar item
alongside the existing connection status.

**Packages/files touched:**

- `apps/vscode-extension/src/ui/statusBar.ts` -- extend to show
  compilation error/warning counts.
- `apps/vscode-extension/src/services/diagnostics-manager.ts` -- expose
  aggregate counts via an event emitter.

**Concrete deliverables:**

1. `DiagnosticsManager` emits `onDidChangeCounts` with
   `{ errors: number, warnings: number }` whenever the diagnostic set
   changes.
2. Status bar item incorporates compilation feedback:
   - Connected + 0 errors: `$(pass-filled) Mindcraft: Connected`
   - Connected + N errors: `$(error) Mindcraft: N error(s)`
   - Connected + 0 errors + M warnings:
     `$(warning) Mindcraft: M warning(s)`
3. Error/warning state takes priority over the generic "Connected" text.
   Connection state (disconnected, reconnecting, no app) still takes
   priority over compilation state.

**Acceptance criteria:**

- Status bar shows error count when diagnostics are present.
- Status bar returns to normal "Connected" when all errors are resolved.
- Status bar still shows connection issues (disconnected, no app, offline)
  with higher priority than compilation counts.

**Key risks:**

- Low risk. UI-only change building on Phase D4 infrastructure.
- **Count aggregation.** Must count across all files, not just the last
  received message. `DiagnosticsManager` should maintain running totals.

---

## Phase Log

### Phase D1 (2026-04-02)

**Objective:** Define `compile:diagnostics` and `compile:status` message types
in `bridge-protocol`.

**Planned vs actual:** Delivered as specified. No deviations from the plan.
Used a new `compile.ts` file rather than adding to `shared.ts`. Extracted
`CompileDiagnosticRange` and `CompileDiagnosticEntry` as named interfaces
rather than inlining in the payload (minor structural improvement).

**Files created:**
- `packages/bridge-protocol/src/messages/compile.ts`

**Files modified:**
- `packages/bridge-protocol/src/messages/app.ts` -- `AppClientMessage` union
- `packages/bridge-protocol/src/messages/extension.ts` -- `ExtensionServerMessage` union
- `packages/bridge-protocol/src/messages/index.ts` -- barrel exports
- `packages/bridge-protocol/src/index.ts` -- top-level barrel exports

**Discoveries:**
- `ProjectSession.on<T>()` uses `Extract<TServer, { type: T }>` for type
  narrowing -- adding to the union is sufficient for type-safe listeners.
- `ProjectSession.send()` takes `TClient` -- adding to `AppClientMessage`
  enables type-safe sending.
- `bridge-protocol` requires `tsc --build` to produce `dist/` for downstream
  consumers.
- Risk "diagnostic range and severity -- back-propagated to compiler" is
  already resolved: `CompileDiagnostic` has `endLine`, `endColumn`, `severity`.
- Risk "file path namespace" deferred to D3.

### Phase D2 (2026-04-02)

**Objective:** Add handlers to the vscode-bridge that relay
`compile:diagnostics` and `compile:status` messages from the app to all
paired extensions.

**Planned vs actual:** Delivered as specified, with one addition: Zod
validation schemas (`compileDiagnosticsPayloadSchema`,
`compileStatusPayloadSchema`) were added to `bridge-protocol` since D1
only defined TypeScript interfaces. The spec's "Key risks" section called
for Zod validation before relay, but there were no schemas to reference.
Adding them to `bridge-protocol` (not the bridge itself) follows the
project convention that validation schemas live alongside their types.

**Files created:**
- `apps/vscode-bridge/src/transport/ws/app/handlers/compile.handler.ts`

**Files modified:**
- `apps/vscode-bridge/src/transport/ws/app/router.ts` -- spread
  `compileHandlers` into handler map
- `packages/bridge-protocol/src/messages/compile.ts` -- added Zod schemas
- `packages/bridge-protocol/src/messages/index.ts` -- barrel re-exports
- `packages/bridge-protocol/src/index.ts` -- top-level barrel re-exports

**Discoveries:**
- D1 defined types only; Zod schemas were missing. The bridge handler
  pattern requires Zod validation (see `filesystem.handler.ts`), so
  schemas were back-filled into `bridge-protocol` as part of D2.
- Biome auto-sorted the import in `router.ts` (compile before control)
  and consolidated the schema exports in `index.ts` into a single
  export block rather than a separate line. Formatter-driven, not manual.
- The handler pattern is identical for all relay-style handlers:
  validate -> lookup app session -> get paired extensions -> broadcast.
  No special handling needed for compile messages vs filesystem messages.
