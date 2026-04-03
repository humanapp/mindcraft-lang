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
  `@mindcraft-lang/typescript`. Exports `createCompilationProvider()` which
  returns a `CompilationProvider` adapter (Phase D3). The adapter's
  `compileAll()` calls `UserTileProject.compileAll()` and maps
  `ProjectCompileResult` into `CompilationResult` with protocol-shaped
  `CompileDiagnosticEntry[]` per file. Numeric diagnostic codes are
  formatted as `"MC{code}"` (e.g., `"MC5002"`). Optional line/column
  fields fall back to 1 when absent.
- `apps/sim/src/services/vscode-bridge.ts` passes the adapter as
  `compilationProvider` to `AppProject` (Phase D3). Uses
  `onRemoteFileChange()` for filesystem persistence and
  `compilation.onCompilation()` for the sim runtime cache. Seeds the
  compiler on startup via `handleFileChange({ action: "import", ... })`.
- `ProjectCompileResult` contains:
  - `results: Map<string, CompileResult>` -- per-file diagnostics + compiled
    program.
  - `tsErrors: Map<string, CompileDiagnostic[]>` -- TypeScript checker errors
    (shared across files in the project).
- `tsErrors` and `results` are **mutually exclusive**: when TS errors exist,
  `results` is an empty Map (compiler returns early). No deduplication needed.
- `CompileDiagnostic { code, message, severity, line?, column?, endLine?,
  endColumn? }` -- full source ranges and severity. `severity` is
  `"error" | "warning" | "info"` (required). `line` and `column` are 1-indexed.
- `user-tile-compiler.ts` exports `handleCompilationResult()` which the sim
  subscribes to via `CompilationManager.onCompilation()`. Updates the internal
  `CompileResult` cache and logs diagnostics.

### bridge-app (packages/bridge-app)

- `compilation.ts` (Phase D2.5) defines `CompilationProvider` interface and
  `CompilationManager` class. `CompilationProvider` is the seam between the
  app's compiler and the bridge diagnostic pipeline -- the app provides an
  adapter that maps compiler output to `CompileDiagnosticEntry[]`.
- `CompilationManager` drives compile-on-change: dispatches file
  notifications to the provider, calls `compileAll()`, emits
  `compile:diagnostics` and `compile:status` messages per file when
  connected. Tracks per-file version counters and previous-diagnostic
  state for correct clearing. Caches the last `CompilationResult` and
  exposes `sendDiagnostics()` to re-emit cached diagnostics (used
  when an extension pairs after compilation has already run).
- `AppProject` accepts optional `compilationProvider` in options. When
  provided, creates a `CompilationManager` and wires it into
  `fromRemoteFileChange`. Exposes `compilation` getter and
  `onRemoteFileChange(fn)` listener for app-level side effects.
- `onRemoteFileChange(fn)` replaces direct `fromRemoteFileChange` override
  for app-level hooks (e.g., localStorage persistence). Listeners fire on
  every inbound file change regardless of compilation.

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
- `DiagnosticsManager` (Phase D4) creates a
  `vscode.DiagnosticCollection("mindcraft")`, receives
  `compile:diagnostics` messages via `session.on()`, maps payloads to
  `vscode.Diagnostic` objects with 0-based range conversion and severity
  mapping. Tracks per-file version to ignore stale messages. Clears all
  diagnostics on disconnect. Disposed via `ProjectManager.dispose()`.
- `tsconfig.json` includes `"WebWorker"` in `lib` (this is a web
  extension with a `"browser"` entry point, not Node.js).

### Data flow gap

```
sim compiles tile (via CompilationProvider adapter, Phase D3)
  |
  v
CompilationManager maps result, emits compile:diagnostics (Phase D2.5)
  |
  v
vscode-bridge -- compile handlers relay to extensions (Phase D2 done)
  |
  v
vscode-extension -- DiagnosticsManager displays in Problems panel (Phase D4 done)
```

Extension pairing flow:
```
extension connects, requests filesystem:sync
  |
  v
AppProject receives filesystem:sync, calls CompilationManager.sendDiagnostics()
  |
  v
cached diagnostics re-emitted through bridge to extension
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

### Phase D2.5 (2026-04-02)

**Objective:** Move the file-change -> compile -> diagnostic-emission loop
into `bridge-app` via `CompilationProvider` / `CompilationManager`.

**Planned vs actual:** Delivered as specified. The `fromRemoteFileChange`
composition risk was resolved by always overriding `fromRemoteFileChange`
in the `AppProject` constructor (not conditionally) and exposing an
`onRemoteFileChange(fn)` listener pattern for app-level side effects.
The spec suggested "use a listener pattern (e.g., `onRemoteFileChange`) or
chain the override" -- the listener pattern was chosen.

One minor addition vs spec: `CompilationManager` constructor takes an
`isConnected: () => boolean` callback rather than holding a reference to
the session directly. This keeps `CompilationManager` decoupled from
`ProjectSession` and testable in isolation.

`compile:status` is always emitted alongside `compile:diagnostics` (the
spec said "optionally sends"). Making it unconditional simplifies D5
since the status bar can rely on receiving status messages.

**Files created:**
- `packages/bridge-app/src/compilation.ts`

**Files modified:**
- `packages/bridge-app/src/app-project.ts` -- `AppProjectOptions` gains
  `compilationProvider?`; `AppProject` creates `CompilationManager`,
  overrides `fromRemoteFileChange`, exposes `compilation` getter and
  `onRemoteFileChange(fn)` subscriber.
- `packages/bridge-app/src/index.ts` -- exports `CompilationManager`,
  `CompilationProvider`, `CompilationResult`.

**Discoveries:**
- `Project.fromRemoteFileChange` is a public property (arrow function
  assignment, not a method), so overriding it in the subclass constructor
  is clean -- just reassign `this.fromRemoteFileChange`.
- `Project` always invokes `fromRemoteFileChange` from two sites:
  `filesystem:change` handler after `applyNotification`, and
  `filesystem:sync` handler after import. Both paths feed through
  `CompilationManager.handleFileChange` seamlessly.
- `mkdir` and `rmdir` filesystem notifications are irrelevant to
  compilation and are early-returned without triggering a compile.
- The `_previousFiles` tracking set in `CompilationManager` enables
  correct clearing: files that had diagnostics in the previous compilation
  but have none now get an empty array emitted. Files that disappear
  entirely from the result (e.g., deleted) get empty array + `onRemoval`.
- `bridge-app` depends only on `bridge-protocol` for diagnostic types
  (`CompileDiagnosticEntry`, `AppClientMessage`), not on
  `@mindcraft-lang/typescript`. The decoupling is clean.

### Phase D3 (2026-04-02)

**Objective:** Sim provides a `CompilationProvider` adapter to `AppProject`,
replacing the manual file-change dispatch in `vscode-bridge.ts`.

**Planned vs actual:** Delivered as specified with these deviations:

1. **No `onRemoval()` subscription.** The spec called for
   `project.compilation.onRemoval()` to clear removed files from the sim
   cache. Instead, `handleCompilationResult()` detects removed files by
   diffing `cache.keys()` against the raw `ProjectCompileResult.results`
   keys, replicating the old `recompileAll()` logic. The
   `CompilationManager.onRemoval()` fires for bridge-level clearing (empty
   diagnostics array), but the sim cache cleanup is handled internally.

2. **`lastRawResult` side-channel.** The `CompilationProvider.compileAll()`
   returns protocol-shaped `CompilationResult`, but the sim also needs the
   raw `ProjectCompileResult` (with `CompileResult` objects containing
   `program` fields) for its runtime cache. Rather than extending the
   `CompilationProvider` interface, `compileAll()` stashes the raw result
   in a module-level `lastRawResult` variable that
   `handleCompilationResult()` reads. This keeps the `bridge-app` interface
   unchanged.

3. **Initial filesystem seeding.** The spec did not explicitly call for
   seeding the compiler with existing files at startup. The old code had
   `userTileCompiler.fullSync(project.files.raw.export())` at the end of
   `initProject()`. This was replaced with
   `compilation.handleFileChange({ action: "import", entries: [...] })` to
   go through the `CompilationManager` path, which triggers compilation
   and fires the `onCompilation` listener to populate the sim cache.

4. **Avoided `bridge-protocol` dependency.** The sim depends on
   `bridge-app` but not `bridge-protocol`. Rather than adding a new
   dependency, the `DiagnosticEntry` type is derived from
   `CompilationResult` using conditional type inference
   (`CompilationResult["files"] extends Map<string, infer E> ? ...`).

5. **Diagnostic code formatting.** All compiler diagnostic codes (both TS
   checker errors mapped via `CompileDiagCode.TypeScriptError = 5002` and
   Mindcraft compiler codes 1000-4099) are formatted as `"MC{code}"` (e.g.,
   `"MC5002"`, `"MC1001"`). The spec example showed `"TS2339"` for TS errors,
   but the compiler doesn't preserve the original TS error code -- it maps
   all TS errors to `CompileDiagCode.TypeScriptError`. Using a uniform
   `"MC"` prefix avoids confusion.

**Files modified:**
- `apps/sim/src/services/user-tile-compiler.ts` -- refactored to export
  `createCompilationProvider()` and `handleCompilationResult()`. Removed
  `fileWritten`, `fileDeleted`, `fileRenamed`, `fullSync`,
  `onCompilation`, `onRemoval` exports. Added `mapDiagnostic()` and
  `mapProjectResult()` for the diagnostic mapping.
- `apps/sim/src/services/vscode-bridge.ts` -- passes `compilationProvider`
  to `AppProject`, replaced `fromRemoteFileChange` override with
  `onRemoteFileChange` for filesystem persistence and
  `compilation.onCompilation` for the runtime cache. Added initial
  filesystem seeding via `handleFileChange`.

**Discoveries:**
- `tsErrors` and `results` in `ProjectCompileResult` are mutually exclusive.
  When `tsErrors.size > 0`, the compiler returns early with
  `results: new Map()`. No deduplication is needed in `mapProjectResult`.
- `Project` imports filesystem entries directly in the constructor (via
  `FileSystem.import()`) without triggering `fromRemoteFileChange`. Initial
  seeding must be done explicitly after construction.
- The `ExportedFileSystem` Map must be spread to an array for the
  `FileSystemNotification` import action (Zod schema expects array of
  tuples, not a Map).
- `CompileDiagnostic.line` and `.column` are optional (undefined when the
  diagnostic has no source location). The mapping falls back to line 1,
  column 1 for these cases -- the protocol's `CompileDiagnosticRange`
  requires all four fields.
- File path alignment risk (D3 key risk) is a non-issue at the provider
  level: `UserTileProject` uses VFS paths like `sensors/foo.ts` (no leading
  slash), which match the protocol's project-relative path convention.
  The extension will need to prepend `/` when constructing `mindcraft://`
  URIs in Phase D4.

### Phase D4 (2026-04-02)

**Objective:** VS Code extension receives `compile:diagnostics` messages and
displays them in the Problems panel using a `DiagnosticCollection`.

**Planned vs actual:** Delivered as specified with these additions:

1. **No changes to `extension.ts`.** The spec listed `extension.ts` as a
   file to touch for registering the diagnostic collection. In practice,
   `DiagnosticsManager` is owned by `ProjectManager`, which is already in
   `context.subscriptions`. No separate registration was needed.

2. **Initial diagnostics on extension pairing.** The spec's "Reconnection"
   risk noted that fullSync triggers recompilation which emits diagnostics.
   However, if the project was already compiled before the extension
   connected, no recompilation occurs -- the sync just sends files. To
   ensure the extension receives current diagnostics immediately:
   - `CompilationManager` now caches `_lastResult` and exposes
     `sendDiagnostics()`, which re-emits all non-empty cached diagnostics.
   - `AppProject` subscribes to `filesystem:sync` (the request the
     extension sends after pairing) and calls `sendDiagnostics()`.
   This required changes to `bridge-app` (not listed in the D4 spec).

3. **`WebWorker` lib in tsconfig.** The extension is a web extension
   (`"browser"` entry point), but `tsconfig.json` only had `"ES2022"` in
   `lib`, leaving `setTimeout` unresolved. Added `"WebWorker"` to provide
   correct global types for the web worker runtime.

**Files created:**
- `apps/vscode-extension/src/services/diagnostics-manager.ts`

**Files modified:**
- `apps/vscode-extension/src/services/project-manager.ts` -- imports
  `DiagnosticsManager`, creates instance, subscribes to
  `compile:diagnostics` via `session.on()`, clears on disconnect, disposes
  in `dispose()`.
- `apps/vscode-extension/tsconfig.json` -- added `"WebWorker"` to `lib`.
- `packages/bridge-app/src/compilation.ts` -- added `_lastResult` cache
  and `sendDiagnostics()` method.
- `packages/bridge-app/src/app-project.ts` -- subscribes to
  `filesystem:sync` to call `sendDiagnostics()` when an extension pairs.

**Discoveries:**
- The extension is a **web extension** (uses `"browser"` entry point in
  `package.json`, no `"main"`). The runtime is a web worker, not Node.js.
  `@types/node` would be incorrect; `"WebWorker"` in `lib` is the right
  type source.
- `filesystem:sync` is the correct hook for resending diagnostics on
  extension pairing. It fires when the extension connects and requests the
  file listing, which happens after `session:appStatus` reports
  `bound && clientConnected`.
- URI construction for diagnostics uses the same pattern as filesystem
  notifications: `vscode.Uri.from({ scheme: MINDCRAFT_SCHEME, path: "/" + file })`.
  The leading `/` is required for the URI path to match the
  `mindcraft:///` authority-less form.
- `DiagnosticsManager.handleDiagnostics` maps the full payload each time
  (not incrementally). Empty diagnostics arrays naturally clear a file's
  problems via `collection.set(uri, [])`.
- Version tracking uses strict less-than (`version < lastVersion`) so that
  resent diagnostics (same version) are accepted. This is correct because
  `sendDiagnostics()` increments the version counter via `emitDiagnostics()`.
