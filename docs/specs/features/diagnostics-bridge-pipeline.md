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

### Compilation side (sim app)

- Compilation runs **in the Mindcraft browser app** (`apps/sim/`).
- `apps/sim/src/services/user-tile-compiler.ts` wraps `UserTileProject` from
  `@mindcraft-lang/typescript`. Calls `compileAll()` on every file change.
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

- Three empty handler stubs exist on the extension side:
  - `compile.handler.ts` -- exports `compileHandlers: WsHandlerMap = {}`
  - `debug.handler.ts` -- exports `debugHandlers: WsHandlerMap = {}`
  - `project.handler.ts` -- exports `projectHandlers: WsHandlerMap = {}`
- The extension router spreads these into the handler lookup, so adding entries
  to them is sufficient to activate new message types.
- App-side has no compile/debug handlers at all -- only filesystem and session.
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
  X -- no bridge message sent
  |
vscode-bridge -- no compile handlers
  |
  X -- no message relayed
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

### Phase D3: Sim emission -- send diagnostics through the bridge

**Objective:** After each compilation in the sim, send `compile:diagnostics`
messages for every affected file through the bridge to paired extensions.

**Packages/files touched:**

- `apps/sim/src/services/user-tile-compiler.ts` -- emit
  `compile:diagnostics` messages after each `recompileAll()`.
- `apps/sim/src/services/vscode-bridge.ts` -- expose a method or callback
  that sends typed messages through the `AppProject` session.
- Mapping from `CompileDiagnostic` to `CompileDiagnosticsPayload` is a
  direct passthrough once `CompileDiagnostic` is enhanced (see Phase D1
  risk note). No synthesis adapter needed.

**Concrete deliverables:**

1. After `recompileAll()`, iterate `ProjectCompileResult.results` and
   `ProjectCompileResult.tsErrors`. For each file with diagnostics (or
   a file that previously had diagnostics but now has zero), send a
   `compile:diagnostics` message with the full diagnostic list (empty
   array = file is clean).
2. Map `CompileDiagnostic` to the protocol's diagnostic shape:
   - `severity`: direct from `CompileDiagnostic.severity` (populated
     by the compiler after the `CompileDiagnostic` enhancement).
   - `range`: direct from `CompileDiagnostic`'s `line`, `column`,
     `endLine`, `endColumn` fields.
   - `code`: string-ify the `TsDiagCode` enum value.
3. Track a `version` counter per file (increment on each compilation) so
   the extension can discard stale messages that arrive out of order.
4. Optionally send `compile:status` for each file with
   `{ success, diagnosticCount }`.
5. Only send messages when the bridge session is connected
   (`session.status === "connected"`). Do not queue diagnostics for
   offline delivery -- they become stale immediately.

**Acceptance criteria:**

- After a file save triggers compilation, all paired extensions receive
  `compile:diagnostics` for that file.
- When a file goes from having errors to being clean, extensions receive
  an empty diagnostics array (clearing the file's problems).
- When a file is deleted, extensions receive an empty diagnostics array
  (or a removal signal).
- Messages are only sent when the bridge session is connected.

**Key risks:**

- **Compilation frequency.** `recompileAll()` runs on every file change
  (write, delete, rename, fullSync). This could produce a burst of
  diagnostic messages. Debouncing at the bridge message level may be
  needed if the volume causes issues. Start without debouncing; add it
  if bridge traffic is problematic.
- **TS error deduplication.** `tsErrors` are keyed by file path but may
  contain duplicates if the same error is reported for the same file in
  both `results.diagnostics` and `tsErrors`. The emission step should
  merge or deduplicate.
- **File path alignment.** The compiler uses paths like `sensors/foo.ts`.
  The extension's `mindcraft://` filesystem sees paths like
  `/sensors/foo.ts` (leading slash from URI). The protocol message should
  use the project-relative form without leading slash, and the extension
  must normalize when mapping to URIs.

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
