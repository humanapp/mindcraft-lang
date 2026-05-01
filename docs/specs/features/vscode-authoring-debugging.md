# VS Code Authoring and Debugging for TypeScript Tiles

Architecture spec for editing and debugging user-authored TypeScript sensors
and actuators from VS Code, with the Mindcraft browser app as the runtime host
and canonical data store.

Depends on: [user-authored-sensors-actuators.md](user-authored-sensors-actuators.md)

---

## Table of Contents

- [1. System Architecture](#1-system-architecture)
- [2. Communication Model](#2-communication-model)
- [3. Virtual File System](#3-virtual-file-system)
- [4. Compilation Pipeline](#4-compilation-pipeline)
- [5. Identity Model](#5-identity-model)
- [6. Debug Metadata](#6-debug-metadata)
- [7. Debugging Architecture](#7-debugging-architecture)
- [8. Debug Target and Thread Model](#8-debug-target-and-thread-model)
- [9. Pause and Execution Control](#9-pause-and-execution-control)
- [10. Async and Coroutine Debugging](#10-async-and-coroutine-debugging)
- [11. Breakpoint Semantics](#11-breakpoint-semantics)
- [12. Stack, Scopes, and Variable Inspection](#12-stack-scopes-and-variable-inspection)
- [13. Faults and Exception Handling](#13-faults-and-exception-handling)
- [14. DAP Capability Contract](#14-dap-capability-contract)
- [15. State Ownership and Sync](#15-state-ownership-and-sync)
- [16. Protocol Design](#16-protocol-design)
- [17. Deployment Models](#17-deployment-models)
- [18. v1 Scope and Constraints](#18-v1-scope-and-constraints)
- [19. Memory and Performance Considerations](#19-memory-and-performance-considerations)
- [20. End-to-End Example](#20-end-to-end-example)

---

## Implementation Status

**Last Updated:** 2026-06-19

This document describes the target architecture for TypeScript authoring and debugging in
Mindcraft. The implementation is being completed in phases:

### Phase 1: Foundation (Complete)

The following components are **implemented and working**:

- **TypeScript Compiler Pipeline** (`packages/ts-compiler`)
  - Full TypeScript-to-bytecode compilation with type checking
  - Virtual file system (in-memory, no disk I/O)
  - Compilation diagnostics (errors, warnings) with source positions
  - User tile registration (sensors, actuators, parameters)
  - Async/await support via `IrAwait` and `IrHostCallAsync` instructions
  - Descriptor extraction (name, params, output type, async flag)
  - Multi-file compilation with cross-file function, variable, and class imports
  - Class support (struct-backed, no inheritance)
  - Closures with captured variables
  - Destructuring (object, array, rest, defaults, nested)
  - Linker for merging user bytecode into brain programs

- **Runtime Infrastructure** (`packages/core`)
  - Stack-based bytecode VM with fiber (coroutine) execution
  - Full opcode set including LOAD_LOCAL/STORE_LOCAL, LOAD_CALLSITE_VAR/STORE_CALLSITE_VAR,
    MAKE_CLOSURE/LOAD_CAPTURE, CALL_INDIRECT/CALL_INDIRECT_ARGS, TYPE_CHECK,
    STRUCT_COPY_EXCEPT, and expanded list operations (LIST_POP, LIST_SHIFT,
    LIST_REMOVE, LIST_INSERT, LIST_SWAP)
  - Async operation handling via handles and suspending/resuming
  - Exception handling (TRY/THROW/FAULT)
  - Instruction budgets and fairness scheduling
  - ErrorValue type with stack traces (`site: { funcId, pc }` and `stackTrace` array)
  - Frame inspection infrastructure (frames carry `locals` and `captures` lists)

- **Bridge Infrastructure** (`apps/vscode-bridge`, `packages/bridge-*`)
  - WebSocket relay server (Hono + Node.js) with `/app` and `/extension` endpoints
  - Session management with join codes (three-word triplets, refreshed every 10 min)
  - Binding token system (HMAC-SHA256 for session persistence across reconnects)
  - Bidirectional filesystem change propagation (write, delete, rename, mkdir, rmdir)
  - Filesystem sync (full state pull/push)
  - Etag-based optimistic concurrency conflict detection
  - Rate limiting (100 msg/sec burst, 50 sustained) and connection throttling
  - Disconnected session cache with 5-minute TTL for seamless reconnection
  - Graceful shutdown handling

- **VS Code Extension** (`apps/vscode-extension`)
  - `MindcraftFileSystemProvider` for `mindcraft://` URI scheme
  - File decoration provider (readonly indicators)
  - "Mindcraft Sessions" tree view with connect/disconnect/create commands
  - Status bar with connection state indicators
  - Join code-based connection flow
  - Pending change queue with deduplication and retry on reconnect
  - Workspace folder management (auto-add/rename on connection)
  - Binding token persistence via globalState for auto-reconnect

- **Bridge Client Library** (`packages/bridge-client`)
  - WsClient with exponential backoff reconnection (500ms-30s)
  - Heartbeat (15s interval, 2 missed tolerance)
  - Request/response with 30s timeout
  - Message queuing during reconnection
  - ProjectSession for connection lifecycle management
  - Project class with filesystem state and sequence-based deduplication

### Phase 2: Debug System (Planned)

The following are described in this spec but **not yet implemented**:

- **Debug Metadata Emission** -- DebugMetadata types (DebugFileInfo, DebugFunctionInfo, Spans)
  are not yet collected/emitted by the compiler. The compiler must be extended to generate
  source-to-bytecode mappings, scope information, and callable sites.

- **VM Debug Runtime API** -- The `IVMDebugRuntime` interface and its implementation do not
  exist. The VM must be extended to expose pause/resume, breakpoint checking, and fiber
  inspection methods.

- **Compile/Debug Bridge Handlers** -- The bridge server has stub handlers for compile and
  debug message categories. The filesystem and session transports work, but compile
  diagnostics and debug protocol messages are not yet wired through the bridge.

- **DAP Integration** -- The VS Code extension does not yet include a debug adapter. No
  breakpoint, stepping, or variable inspection support exists.

- **Source Mapping and Stepping** -- Breakpoint resolution, span boundary detection, and
  step execution are not yet implemented.

- **Diagnostics Transport** -- The compiler emits structured diagnostics with source
  positions, but there is no bridge transport to surface them in VS Code's Problems panel.

---

## 1. System Architecture

### High-level diagram

```
+---------------------+          +---------------------+
|      VS Code        |          |  Mindcraft Browser   |
|                     |          |       App             |
|  +---------------+  |          |                     |
|  | Extension     |  |          |  +---------------+  |
|  |  - FileSystem |  |          |  | Bridge Client |  |
|  |    Provider   |  |          |  | (bridge-app)  |  |
|  |  - Status Bar |  |  Bridge  |  +-------+-------+  |
|  |  - Tree View  |<-| Server  |->|       |          |
|  |  - DAP Client |  |  (WS)   |  +-------v-------+  |
|  |    (planned)  |  |          |  | Project Store |  |
|  +-------+-------+  |          |  | (world data)  |  |
|          |           |          |  +-------+-------+  |
|  +-------v-------+  |          |          |          |
|  | VS Code UI    |  |          |  +-------v-------+  |
|  |  - Editor     |  |          |  | TS Compiler   |  |
|  |  - Debug pane |  |          |  | (packages/    |  |
|  |    (planned)  |  |          |  |  typescript)  |  |
|  |  - Problems   |  |          |  +-------+-------+  |
|  |    (planned)  |  |          |          |          |
|  +---------------+  |          |  +-------v-------+  |
|                     |          |  | VM + Scheduler|  |
+---------------------+          |  | (per entity)  |  |
                                 |  +-------+-------+  |
+---------------------+         |          |          |
|   Bridge Server     |         |  +-------v-------+  |
|  (apps/vscode-      |         |  | Debug Runtime |  |
|   bridge)           |         |  | (planned)     |  |
|  Hono + Node.js     |         |  +---------------+  |
|  /app + /extension  |         +---------------------+
+---------------------+
```

### Component responsibilities

**Mindcraft browser app** (runtime host + canonical store):

- Owns the world/project data, including all user-authored TypeScript source files
- Runs the TypeScript compiler (from the user-authored-sensors-actuators spec) [done]
- Executes compiled bytecode in the VM (one VM per entity) [done]
- Connects to the bridge server via WebSocket (`/app` endpoint) [done]
- Propagates filesystem changes bidirectionally through the bridge [done]
- Exposes a debug runtime API on each VM instance [planned] (interface spec in section 7)

**VS Code extension** (`apps/vscode-extension`) [done for file editing; debug planned]:

- Provides a `MindcraftFileSystemProvider` for the `mindcraft://` URI scheme [done]
- Presents TypeScript tile source files as editable documents [done]
- File decoration provider for readonly indicators [done]
- Status bar with connection state (disconnected/connecting/connected) [done]
- "Mindcraft Sessions" tree view with connect/disconnect/create commands [done]
- Join code-based connection flow with binding token persistence [done]
- Pending change queue with deduplication and retry on reconnect [done]
- Receives and displays diagnostics (errors, warnings) in the Problems panel [planned]
- Hosts a DAP client for debugging [planned]

**Bridge server** (`apps/vscode-bridge`) [done]:

- Hono + Node.js WebSocket server with two endpoints: `/app` and `/extension`
- Relays filesystem changes and sync messages between app and extension
- Session management with join code pairing and HMAC-signed binding tokens
- Disconnected session cache (5-min TTL) for seamless reconnection
- Rate limiting and connection throttling
- Stub handlers for compile, debug, and project message categories [planned]
- **Note:** The registration bridge (`registration-bridge.ts` in `packages/ts-compiler`)
  integrates compiled user tiles into the brain's catalog; this is separate from the
  WebSocket bridge server.

**Debug adapter** [planned]:

- Lives inside the VS Code extension process (inline DA)
- Translates DAP requests into Mindcraft debug protocol messages
- Maps between TypeScript source locations and bytecode PCs using debug metadata
- Manages breakpoint state on the extension side
- Execution control (pause, step, resume) is delegated to the VM debug runtime
  in the app -- the adapter translates but does not own stepping logic

### Ownership summary

| Concern                       | Owner                            | Status  |
| ----------------------------- | -------------------------------- | ------- |
| Source storage                | Mindcraft app (world)            | done    |
| Compilation + debug metadata  | Mindcraft app                    | partial |
| Runtime execution             | Mindcraft app (VM)               | done    |
| Execution control (VM-side)   | Mindcraft app (VM debug runtime) | planned |
| File sync transport           | Bridge server + clients          | done    |
| Source display/editing        | VS Code extension                | done    |
| Diagnostics display           | VS Code extension                | planned |
| DAP translation               | VS Code extension (DA)           | planned |
| Breakpoint source-level state | VS Code extension (DA)           | planned |
| Transport relay               | Bridge server                    | done    |

---

## 2. Communication Model

### Transport

All communication between VS Code and the Mindcraft app uses WebSocket with
JSON-encoded messages, relayed through the bridge server. WebSocket provides:

- Bidirectional messaging (required for debug events, file change notifications)
- Browser-compatible (the Mindcraft app is a web app)
- Low latency for interactive debugging
- Works through firewalls in both local and remote modes

### Message framing

Each WebSocket message is a JSON object with a flat envelope:

```
{
  "type": "<category>:<action>",
  "id": "<string>" | undefined,
  "payload": { ... } | undefined,
  "seq": <number> | undefined
}
```

- `type`: Colon-separated string combining category and action
  (e.g., `"session:hello"`, `"filesystem:change"`, `"control:ping"`).
- `id`: Correlates requests with responses. Absent for fire-and-forget events.
- `payload`: Action-specific data.
- `seq`: Sequence number for filesystem change ordering and deduplication.

The bridge protocol types are defined in `packages/bridge-protocol`.

### Session model

A **session** represents an active connection between one VS Code window and one
Mindcraft project. The session lifecycle:

1. **App connects.** The Mindcraft app connects to the bridge server's `/app` endpoint
   and sends `session:hello` with app metadata (`appName`, `projectId`, `projectName`).
   The bridge responds with `session:welcome` containing a `sessionId`, `joinCode`
   (three-word triplet), and `bindingToken`.
2. **User enters join code.** The user enters the join code displayed in the app into
   VS Code via the "Mindcraft: Connect" command.
3. **Extension connects.** The VS Code extension connects to the bridge server's
   `/extension` endpoint and sends `session:hello` with the join code. The bridge
   validates the code, binds the extension to the app session, and responds with
   `session:welcome` and `session:appStatus` (bound state, project metadata,
   binding token).
4. **Active.** Extension can sync files, propagate changes, and (in the future)
   request compilation and attach the debugger.
5. **Disconnect.** Either side disconnects. The bridge caches the disconnected session
   for 5 minutes. If the client reconnects with a valid binding token, the session
   is reclaimed without re-entering the join code.

Join codes refresh every 10 minutes. Each app session receives a new join code,
pushed via `session:joinCode` message.

### Connection lifecycle

```
VS Code                      Bridge Server              Mindcraft App
  |                            |                            |
  |                            |<-- WS /app connect --------|
  |                            |<-- session:hello -----------|
  |                            |--- session:welcome -------->|
  |                            |    (joinCode, bindingToken) |
  |                            |                            |
  |--- WS /extension connect ->|                            |
  |--- session:hello --------->|                            |
  |    (joinCode)              |                            |
  |<-- session:welcome --------|                            |
  |<-- session:appStatus ------|                            |
  |    (bound, projectName,    |                            |
  |     bindingToken)          |                            |
  |                            |                            |
  |    (active session)        |    (relay active)          |
  |                            |                            |
  |<-- filesystem:sync --------|<-- filesystem:sync --------|
  |<-- filesystem:change ------|<-- filesystem:change ------|
  |--- filesystem:change ----->|--- filesystem:change ----->|
  |                            |                            |
  |--- WS close ------------->|                            |
  |    (session cached 5 min)  |                            |
  |                            |                            |
  |--- WS reconnect --------->|                            |
  |--- session:hello --------->|                            |
  |    (bindingToken)          |                            |
  |<-- session:welcome --------|                            |
  |<-- session:appStatus ------|                            |
  |                            |                            |
```

### Bridge server architecture

The bridge server (`apps/vscode-bridge`) is a standalone Hono + Node.js application:

- Two WebSocket routes: `/app` for web app clients, `/extension` for VS Code
- Session registry with `AppSession` and `ExtensionSession` types
- Disconnected session cache with 5-minute TTL and LRU eviction (max 10k)
- Rate limiting: token bucket (100 burst, 50/sec sustained) per client
- Connection throttle: 10/sec per IP
- Max message size: 1 MB
- Stale connection reaper: closes idle sockets after 60 seconds
- Graceful shutdown (SIGINT/SIGTERM) with 10-second forced exit

### Discovery and connection

The extension discovers the bridge server via the `mindcraft.bridgeUrl` VS Code
setting (configurable WebSocket URL). The Mindcraft app discovers it via a
user-entered URL or query parameter.

### Remote bridge mode (future)

The current bridge server can be deployed on a remote host to support VS Code for
Web and institutional environments. This would require adding WSS transport,
authentication, and endpoint pairing. The architecture already supports this
(both sides connect outbound to the bridge), but the additional security and
infrastructure work is deferred.

---

## 3. Virtual File System

### URI scheme

VS Code sees Mindcraft source files through a `MindcraftFileSystemProvider` registered
for the `mindcraft` URI scheme. This is implemented in
`apps/vscode-extension/src/services/mindcraft-fs-provider.ts`.

```
mindcraft://projectId/sensors/nearby-enemy.ts
mindcraft://projectId/actuators/flee.ts
mindcraft://projectId/lib/helpers.ts
```

Path structure:

```
mindcraft://<projectId>/
  sensors/
    <name>.ts           -- one file per sensor
  actuators/
    <name>.ts           -- one file per actuator
  lib/
    <name>.ts           -- shared helper modules
  mindcraft.d.ts        -- ambient type declarations (read-only, generated)
```

The `mindcraft.d.ts` file is synthesized by the extension from the app's ambient type
declarations. It is read-only and provides IntelliSense for the `mindcraft` module
imports.

### Implementation details

The file system provider uses dual underlying filesystems from `packages/bridge-client`:

- **Read filesystem** -- local cache used for reading file content
- **Write filesystem** -- notifying filesystem that triggers bridge sync on writes

All write operations go through the notifying filesystem, which sends
`filesystem:change` messages to the bridge with sequence numbers for ordering.
Reads are served from the local cache, which is updated by both local writes and
incoming remote changes.

### Write flow

```
User saves file in VS Code (Cmd+S)
  |
  v
MindcraftFileSystemProvider.writeFile(uri, content)
  |
  v
Write to notifying filesystem (triggers filesystem:change with seq number)
  |
  v
Bridge relays filesystem:change to app
  |
  v
App stores source, optionally triggers recompilation
  |
  v
Bridge relays ACK (filesystem:change response) to extension
  |
  v
If ACK fails: change queued as pending (retried on reconnect)
```

### Change notifications

The Mindcraft app sends `filesystem:change` messages when source files change outside
of VS Code. The bridge relays these to all bound extensions. The extension updates its
local cache and fires `onDidChangeFile` events to refresh open editors.

Filesystem notifications support these actions:
- `write` -- file content changed (includes content and etag)
- `delete` -- file removed
- `rename` -- file moved/renamed
- `mkdir` -- directory created
- `rmdir` -- directory removed
- `import` -- bulk state sync (all entries)

### Supported operations

The virtual FS supports the operations needed by VS Code, implemented through the
bridge client's `NotifyingFileSystem`:

| Operation         | Supported | Notes                                           |
| ----------------- | --------- | ----------------------------------------------- |
| `stat`            | Yes       | Returns size, mtime, type                       |
| `readFile`        | Yes       | Returns file content from local cache           |
| `writeFile`       | Yes       | Writes content, sends change via bridge         |
| `readDirectory`   | Yes       | Lists directory entries                         |
| `createDirectory` | Yes       | Creates sensor/actuator/lib folders             |
| `delete`          | Yes       | Deletes a source file                           |
| `rename`          | Yes       | Renames a source file                           |
| `watch`           | Yes       | Subscribes to change notifications              |

### Conflict detection

Writes include etag-based optimistic concurrency. If the extension's etag does not
match the server's (another client wrote in between), the write is rejected and the
extension prompts the user to sync and retry.

### File metadata

Each file stat includes:

```
{
  type: FileType.File,
  size: <byte length>,
  mtime: <last modified timestamp>,
  ctime: <created timestamp>
}
```

Timestamps come from the world/project store. They are used by VS Code to detect
external changes and prompt reload when needed.

### Multi-file support

The virtual FS supports multiple files. Each sensor/actuator is a single file. The
`lib/` directory holds shared modules for cross-file imports. Multi-file compilation
is fully implemented -- the FS structure does not change when adding more files.

### TypeScript language support

The extension configures a `tsconfig.json` inside the virtual workspace:

```
mindcraft://worldId/tsconfig.json
```

This is a synthesized read-only file that configures the TypeScript language service:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "bundler",
    "noEmit": true,
    "types": []
  },
  "include": ["**/*.ts"]
}
```

Combined with the generated `mindcraft.d.ts`, this gives VS Code's built-in TypeScript
language service full IntelliSense, type checking, hover information, and go-to-definition
for user code referencing the Mindcraft API -- without any additional language server.

---

## 4. Compilation Pipeline

### Where compilation occurs

Compilation runs **inside the Mindcraft browser app**. Reasons:

1. The compiler (from the user-authored-sensors-actuators spec) is part of
   `@mindcraft-lang/ts-compiler`, which is loaded in the app.
2. The compiled bytecode must be immediately available to the VM instances running
   in the app.
3. The compiler needs access to the app's function registry and type system to
   resolve host function IDs and validate engine-specific context methods.
4. Keeping compilation in the app avoids transmitting bytecode or compiler state
   across the bridge.

VS Code does **not** compile TypeScript to Mindcraft bytecode. VS Code's built-in
TypeScript language service provides syntax checking and IntelliSense independently,
but the authoritative compilation is the Mindcraft compiler in the app.

### When compilation is triggered

| Trigger                   | Initiated by | Behavior                                |
| ------------------------- | ------------ | --------------------------------------- |
| File save from VS Code    | Extension    | `filesystem:change` -> app stores + compiles |
| File edit in Mindcraft UI | App (future) | App stores + compiles directly          |
| Explicit rebuild request  | Extension    | `compile:rebuild` -> app recompiles all |
| World load                | App          | App compiles all source files on load   |

On save, the app:

1. Stores the updated source in the world/project data.
2. Runs the TypeScript compiler pipeline (see Section B.2 of user-authored-sensors-actuators.md).
   - The compiler pipeline is **fully implemented** in `packages/ts-compiler/src/compiler/`
   - Stages: parse (TypeScript AST) -> validate -> extract descriptor -> lower to IR ->
     emit bytecode -> assemble program
   - Multi-file: `UserTileProject` class manages file imports, `collectImports()` gathers
     functions/variables/classes across files with module init ordering
   - Output: `UserAuthoredProgram` (bytecode, constants, metadata)
3. If successful, updates the registered `BrainFunctionEntry` for the sensor/actuator.
4. Sends diagnostics back to VS Code. [planned -- compiler emits structured diagnostics
   but the bridge transport to VS Code is not yet wired]
5. If the compiled tile is used in a running brain, the brain hot-reloads the updated
   bytecode (future -- see v1 scope).

### Diagnostics flow

After compilation, the app sends diagnostics to VS Code (planned -- bridge transport
not yet wired):

```
{
  "type": "compile:diagnostics",
  "payload": {
    "file": "sensors/nearby-enemy.ts",
    "diagnostics": [
      {
        "severity": "error",
        "message": "Property 'queryFaraway' does not exist on type 'EngineContext'",
        "range": { "startLine": 8, "startCol": 20, "endLine": 8, "endCol": 32 },
        "code": 3010
      },
      {
        "severity": "warning",
        "message": "Variable 'unused' is declared but never read",
        "range": { "startLine": 5, "startCol": 6, "endLine": 5, "endCol": 12 },
        "code": 5000
      }
    ]
  }
}
```

The extension maintains a `DiagnosticCollection` for the `mindcraft` URI scheme and
updates it on each diagnostics event.

Diagnostics come from two sources:

1. **TypeScript checker diagnostics** (parse & type check) [done]
   - Standard TS errors/warnings from the compiler's type system
2. **Subset validator diagnostics** (validation) [done]
   - Mindcraft-specific restrictions (forbids class inheritance, class
     expressions, getters/setters, static members, `eval`, `with`, `for...in`,
     etc.)

Both are mapped to source ranges and available during compilation. The compiler
uses a comprehensive diagnostic code system organized by phase:
- 1000-1099: Validator (forbidden syntax)
- 2000-2099: Descriptor extraction
- 3000-3199: Lowering (AST to IR)
- 4000-4099: Emission (IR to bytecode)
- 5000+: Orchestration (TypeScript errors, imports, types)

**Note:** The transport of diagnostics to VS Code via the bridge is not yet
implemented. The compiler emits structured diagnostics with source positions and
diagnostic codes, but they currently only exist on the app side.

**Debug metadata emission:** [planned] Following successful compilation,
the compiler will emit `DebugMetadata` (Section 6) alongside the `UserAuthoredProgram`.
This requires extending the compiler pipeline to track:
- Source file identity and content hashes
- Function identity and source spans
- Executable spans aligned to statement boundaries
- Scope and local variable information
- Call and suspend site tracking

These will be included in step (2) of the "On save" flow above once implemented.

### Error mapping

All diagnostic positions reference the user's TypeScript source. The Mindcraft compiler
operates on source positions throughout the pipeline (the TypeScript AST carries source
positions, and they are preserved through validation and descriptor extraction). No
reverse mapping from bytecode is needed for diagnostics.

### Compilation status

The app sends a compilation status event after each compilation (planned -- bridge
transport not yet wired):

```
{
  "type": "compile:status",
  "payload": {
    "file": "sensors/nearby-enemy.ts",
    "success": true,
    "diagnosticCount": { "error": 0, "warning": 1 }
  }
}
```

The extension can display this in the status bar (e.g., "Mindcraft: compiled ok" or
"Mindcraft: 2 errors").

---

## 5. Identity Model

The system has two distinct identity namespaces: **code identity** (static, derived
from compilation) and **runtime identity** (dynamic, derived from execution state).
The debugger must translate between them.

### Code identity

| Identity             | Scope                | Description                                                                                                                    |
| -------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Source file path     | Per world            | e.g. `sensors/nearby-enemy.ts`. Stable across compiles.                                                                        |
| Debug function ID    | Per compiled program | Stable identifier for a compiled function within a program's debug metadata. Used for breakpoint resolution and stack display. |
| Compiled function ID | Per `Program`        | Index into `Program.functions`. May change on recompile.                                                                       |
| Debug metadata ID    | Per compiled program | Ties a `FunctionBytecode` to its debug metadata (source map, locals, scopes). Parallel to compiled function ID.                |
| Program revision ID  | Per compilation      | Unique ID for a compiled program revision. Changes on every successful recompile.                                              |

The debug function ID must be stable enough to survive recompilation when the source
has not semantically changed (same function, same file). The compiler assigns debug
function IDs based on source identity (file path + function name), not on the compiled
function index. This allows breakpoints to be re-resolved after recompilation without
relying on bytecode offsets remaining stable.

### Runtime identity

| Identity  | Scope      | Description                                                                                                          |
| --------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| World ID  | Global     | Identifies the world/project. Scopes a session.                                                                      |
| Brain ID  | Per world  | Identifies a brain definition. Multiple entities may share a brain definition.                                       |
| Entity ID | Per world  | Identifies a specific entity instance.                                                                               |
| VM ID     | Per entity | One VM per entity. In practice, entity ID and VM ID are equivalent.                                                  |
| Fiber ID  | Per VM     | Identifies a fiber (lightweight coroutine). One fiber per active rule. Fibers are created and destroyed dynamically. |

### Relationship: one entity, many fibers

A brain page contains multiple rules. When a page activates, the scheduler spawns
one fiber per root rule. During a brain tick, all RUNNABLE fibers in the VM execute
(round-robin, budget-limited). Fibers that complete or fault are respawned on the
next tick. Async fibers (WAITING on a handle) resume when their handle resolves.

This means that within a single attached VM, there are typically N concurrent fibers
where N equals the number of root rules on the active page. The debugger must model
fibers as first-class execution units.

### Program revision alignment

Each successful compilation produces a program revision with a unique
`programRevisionId`. The attach response includes this ID (see section 8).
An attached debug session is bound to exactly one revision: the VM's executing
bytecode, the debug metadata used for source mapping, and the source files
displayed in VS Code must all correspond to the same revision.

If a recompile produces a new revision while a debug session is active, the
session is invalidated. The adapter detaches and re-attaches to the new
revision (see section 11, "Recompilation during an active debug session").
Breakpoints are re-resolved against the new debug metadata.

---

## 6. Debug Metadata

**Implementation Status:** The `DebugMetadata` structure and types are not yet
implemented in the compiler. This section describes the target design that will be
required for Phase 2 debugger support. The compiler will be extended to emit these
structures alongside each compiled `UserAuthoredProgram`.

The compiler-emitted `DebugMetadata` is the single source of truth for all
debugging behavior. The debug adapter does not infer structure independently --
it consumes spans, scopes, functions, and mappings exactly as emitted by the
compiler. Every debugger operation -- breakpoint resolution, stepping, scope
presentation, variable inspection -- is derived from this metadata.

### Execution boundary model

The compiler and VM share a contract that determines where all debugger-visible
execution events can occur:

1. The compiler emits **executable spans** -- source ranges aligned to
   statement-level execution points. Each span maps to one or more bytecode
   instructions.
2. The compiler marks a subset of PC values as **span boundaries** by setting
   `isStatementBoundary: true` in the span metadata. These are the only PCs
   where the VM will check for breakpoints, process pause requests, or report
   step completion.
3. The VM never pauses mid-instruction. All debugger stops occur at the
   instruction boundary **before** executing the instruction at a span-boundary
   PC.

Consequences:

- Breakpoints can only be set at PCs that are span boundaries. The adapter
  resolves a user's line-level breakpoint to the nearest span boundary.
- Stepping runs the targeted fiber until it reaches the next span boundary
  (subject to frame depth and suspension rules defined in sections 9-10).
- A manual pause request (`pauseVM`) takes effect at the next span boundary
  reached by any fiber. There is no guarantee of immediate pause.
- The debugger makes no guarantees about execution state between span
  boundaries. Only state observed at a span boundary is considered valid for
  inspection.

This contract is the foundation for all debugger behavior. Every breakpoint,
step, and pause operation is defined in terms of span boundaries.

### Why source maps are insufficient

A flat `pc -> line/column` mapping is too weak for robust debugging. Stepping,
scope display, variable lifetime tracking, and breakpoint verification all require
richer information. The compiler emits a **debug metadata package** alongside each
compiled `UserAuthoredProgram` (via the `debugMetadata` field defined in the
referenced spec).

### Debug metadata structure

The structures below are emitted by the compiler. The debugger consumes them
as-is -- it does not maintain parallel representations.

```
DebugMetadata
  files: List<DebugFileInfo>
  functions: List<DebugFunctionInfo>
```

#### File info

```
DebugFileInfo
  fileIndex: number
  path: string                    -- e.g. "sensors/nearby-enemy.ts"
  sourceHash: string              -- content hash for staleness detection
```

#### Function info

```
DebugFunctionInfo
  debugFunctionId: string         -- stable identity (file path + function name)
  compiledFuncId: number          -- index into Program.functions
  fileIndex: number               -- which source file
  prettyName: string              -- display name for stack traces
  isGenerated: boolean            -- true for compiler-generated functions (init, thunks)
  sourceSpan: SourceSpan          -- full source range of the function
  spans: List<Span>               -- all executable spans in this function
  pcToSpanIndex: number[]         -- indexed by PC, value is index into spans (-1 if unmapped)
  scopes: List<ScopeInfo>
  locals: List<LocalInfo>
  callSites: List<CallSiteInfo>
  suspendSites: List<SuspendSiteInfo>
```

The `pcToSpanIndex` array provides O(1) lookup from any instruction pointer to its
corresponding span. This is used at runtime for:

- **Stack reconstruction:** Given a `Frame.pc`, look up `pcToSpanIndex[pc]` to get
  the span, then read `spans[index]` for the source location.
- **Stepping decisions:** After executing an instruction, check whether the new PC
  maps to a different span with `isStatementBoundary: true`. If so, the step target
  has been reached.
- **Breakpoint checking:** At each span boundary PC, check whether a breakpoint is
  installed at that PC.

#### Executable spans

```
Span
  spanId: number                  -- unique within the function; stability across
                                  -- recompiles is best-effort (see section 11)
  startLine: number               -- 1-based
  startColumn: number             -- 0-based
  endLine: number
  endColumn: number
  isStatementBoundary: boolean    -- true = valid breakpoint location and step target
```

Source spans (not just points) are required so the debugger can highlight the full
expression or statement being executed, not just a cursor position.

The `spanId` is assigned by the compiler based on the span's source position within
its function. Stability across recompiles is best-effort -- the compiler attempts
deterministic assignment, but refactoring or compiler changes may alter it. See
section 11 for how this affects breakpoint rebinding.

Not every span is a statement boundary. Sub-expression spans
(`isStatementBoundary: false`) exist for source mapping but are not valid pause
points.

#### Scope metadata

```
ScopeInfo
  scopeId: number
  kind: "function" | "block" | "module" | "brain"
  parentScopeId: number | null
  startPc: number                 -- first PC in scope
  endPc: number                   -- last PC in scope (exclusive)
  name: string | null             -- e.g. "for loop", "if body" (optional, for display)
```

Scopes form a tree rooted at the function scope. The `kind` field determines how
the debugger presents the scope:

- `"function"`: displayed as "Locals" in DAP, contains parameters and function-level
  locals.
- `"block"`: nested block scope (for, if, etc.). Variables declared here are only
  visible when the PC is within `startPc..endPc`. Block scopes are merged into
  the "Locals" presentation with lifetime-based filtering.
- `"module"`: callsite-persistent variables. Presented as "Callsite State" in DAP.
- `"brain"`: brain-level shared variables. Presented as "Brain Variables" in DAP.

#### Local variable metadata

```
LocalInfo
  name: string
  slotIndex: number               -- index into Frame.locals
  storageKind: "local" | "parameter"
  scopeId: number                 -- which scope this variable belongs to
  lifetimeStartPc: number         -- first PC where this variable is live
  lifetimeEndPc: number           -- last PC where this variable is live (exclusive)
  typeHint: string | null         -- optional type annotation for display
```

The `lifetimeStartPc` / `lifetimeEndPc` range determines when the variable is
visible in the debugger. A variable declared in a block is not visible outside that
block, even if its slot index is reused.

Variable lookup at a given PC:

1. Find all `LocalInfo` entries where `lifetimeStartPc <= pc < lifetimeEndPc`.
2. Group by `scopeId`. Walk the scope tree from the innermost scope containing
   the current PC to the function root.
3. For each in-scope variable, read `Frame.locals[slotIndex]` to get the value.

#### Callsite metadata

```
CallSiteInfo
  pc: number                      -- PC of the CALL / HOST_CALL instruction
  callSiteId: number              -- callsite ID used for persistent state lookup
  targetDebugFunctionId: string | null  -- if calling user code, the target's debug ID
  isAsync: boolean                -- true for HOST_CALL_ASYNC
```

#### Suspend/resume site metadata

```
SuspendSiteInfo
  awaitPc: number                 -- PC of the AWAIT instruction
  resumePc: number                -- PC where execution resumes after handle resolves
  sourceSpan: SourceSpan          -- the await expression in source
```

This metadata is critical for async debugging (section 10). It tells the debugger
where suspension and resumption occur, enabling correct stepping behavior around
await points.

### When debug metadata is emitted

The compiler emits debug metadata as part of stage 7 (program assembly) in the
compilation pipeline. Debug metadata is stored alongside the `UserAuthoredProgram`
in the world/project data. It is sent to the debug adapter on attach and refreshed
on recompilation.

### Metadata size and transfer

Debug metadata is compact -- it is a structured description of the compiled program,
not a copy of the source. For a typical single-file sensor/actuator with a few
functions, the metadata is a few KB. It is transferred once on attach and on
recompile, not per-instruction. The `pcToSpanIndex` array is the largest structure
(one number per instruction) but is typically a few hundred entries for a single
sensor/actuator.

---

## 7. Debugging Architecture

**Implementation Status:** The `IVMDebugRuntime` interface and its implementation do
not yet exist. This section describes the target debug runtime API that the VM must
expose. The underlying fiber execution infrastructure (FiberScheduler, fiber states,
frame inspection) is fully implemented; the debug API wrapping is planned.

### Overview

Debugging connects VS Code's Debug Adapter Protocol (DAP) to the Mindcraft VM's
execution state. All debugger stops are **VM-wide**: when any fiber hits a
breakpoint, faults, or a manual pause takes effect, the entire attached VM is
paused. All fibers freeze. The triggering fiber is reported in the DAP `stopped`
event; other fibers remain visible as paused sibling threads for inspection.

```
VS Code Debug UI
      |
      | (DAP - JSON messages)
      v
Debug Adapter (in extension)
      |
      | (Mindcraft debug protocol over bridge WS)
      v
Mindcraft App -> VM Debug Runtime (per attached VM)
                   |
                   +-- Fiber 0 (rule: "when see enemy -> flee")
                   +-- Fiber 1 (rule: "when hungry -> eat")
                   +-- Fiber 2 (rule: "when idle -> wander")
```

### Runtime debug API

Each VM instance will expose a debug interface once implemented. The debug runtime is
activated on attach and deactivated on detach. Below is the target interface design:

```typescript
interface IVMDebugRuntime {
  // Lifecycle
  activate(): void
  deactivate(): void

  // Breakpoints
  setBreakpoint(debugFuncId: string, pc: number): BreakpointId
  removeBreakpoint(id: BreakpointId): void
  listBreakpoints(): List<BreakpointInfo>

  // VM-level execution control (affects all fibers)
  pauseVM(): void
  resumeVM(): void
  stepOver(fiberId: number): void
  stepInto(fiberId: number): void
  stepOut(fiberId: number): void

  // Inspection (only valid when VM is paused)
  listFibers(): List<FiberInfo>
  getStackTrace(fiberId: number): List<StackFrameInfo>
  getScopes(fiberId: number, frameIndex: number): List<ScopeInfo>
  getVariables(scopeRef: number): List<VariableInfo>

  // Events
  onStopped: Event<StoppedEvent>
  onContinued: Event<ContinuedEvent>
  onFiberCreated: Event<FiberLifecycleEvent>
  onFiberDestroyed: Event<FiberLifecycleEvent>
  onOutput: Event<OutputEvent>
}
```

Design notes:

- `pauseVM` / `resumeVM` operate on the **entire VM**, not individual fibers.
- Stepping commands (`stepOver`, `stepInto`, `stepOut`) target a specific fiber
  but the entire VM remains paused between steps. Only the targeted fiber advances.
- Breakpoints are keyed by `debugFuncId` (stable across recompiles) rather than
  raw compiled function ID.
- Inspection methods are only valid while the VM is paused.

### Implementation Guidance for Phase 2

To implement the debug runtime described in this section, use the following existing
codebase infrastructure:

**1. Fiber and Execution State (`packages/core/src/brain/runtime/`)**
- `Fiber` tracks state (RUNNABLE, WAITING, DONE, FAULT, CANCELLED) with validated
  transitions
- `FiberScheduler` manages the fiber queue and execution loop (`tick()`, `spawn()`,
  `cancel()`, `gc()`, `getStats()`)
- `Frame` objects store `funcId`, `pc`, `base`, `locals: List<Value>`, and
  `captures?: List<Value>`
- These structures are sufficient for `listFibers()`, `getStackTrace()`, and
  `getScopes()`. Extend with debug-aware queries.

**2. Error and Stack Trace Infrastructure**
- `ErrorValue` type contains `tag: ErrorCode` (numeric enum: Timeout=1, Cancelled=2,
  HostError=3, ScriptError=4, StackOverflow=5, StackUnderflow=6),
  `message`, `site: { funcId, pc }`, and `stackTrace: List<string>`. Use
  `errorCodeName(tag)` at the diagnostics boundary to recover the canonical
  string label for display.
- Frame inspection is already performed during error handling
- Reuse this path for debugger stack reconstruction (map PC to span via debug metadata).

**3. VM Execution Loop (`packages/core/src/brain/runtime/vm.ts`)**
- The `VM.runFiber()` method executes fibers with budget-limited instruction loops
- `debugStackChecks` config option already provides stack leak detection
- Fiber stepping, budgets, and breakpoint checking must be integrated into the
  main execution loop
- Current: fibers run until budget exhausted or handle suspension
- Target: check for breakpoints/span boundaries at each statement boundary PC

**4. Handle and Async Infrastructure**
- The handle table (`HandleTable`) manages async operation identifiers
- Fiber suspension/resumption is automatic via `AWAIT` instruction
- `onHandleCompleted(handleId)` resumes waiting fibers
- Debug pause/resume can layer on top: pause blocks the scheduler loop entry,
  resume un-blocks it.

**5. Compiler Output**
- `UserAuthoredProgram` is the target for debug metadata attachment
- The compiler (`packages/ts-compiler/src/compiler/compile.ts`) is the place to emit
  `DebugMetadata` alongside bytecode
- The lowering pass (`lowering.ts`) has access to all scope, variable, and AST
  position information needed to generate spans, scopes, and locals

**Steps to implement:**
1. Add `DebugMetadata` types and emission to the compiler pipeline
2. Add `debugMetadata` field to `UserAuthoredProgram`
3. Create `IVMDebugRuntime` interface as a facade on top of `VM` and `FiberScheduler`
4. Implement pause/resume by adding a paused flag and checking it at fiber yield points
5. Implement breakpoint checking: map source breakpoints to span boundaries, check at
   each instruction
6. Implement step handlers by tracking target function/frame and span boundaries
7. Wire compile/debug handlers in the bridge server (`apps/vscode-bridge`)
8. Add DAP client in the VS Code extension

---

## 8. Debug Target and Thread Model

### DAP mapping

Each VM fiber maps to one DAP thread. Each thread corresponds to a rule
execution. There is no other mapping -- fibers are the only unit of
concurrency exposed to the debugger.

| Mindcraft concept | DAP concept   | Notes                                               |
| ----------------- | ------------- | --------------------------------------------------- |
| Entity VM         | Debug session | One attached VM = one DAP session                   |
| Fiber             | Thread        | Each fiber is a DAP thread                          |
| Call frame        | StackFrame    | Each VM `Frame` maps to a DAP `StackFrame`          |
| Lexical scope     | Scope         | Scopes within a frame (locals, module state, brain) |
| Variable          | Variable      | Values within a scope                               |

### Fibers as DAP threads

Every fiber in the attached VM is reported as a DAP thread. The debug adapter
responds to the DAP `threads` request with all current fibers:

```
DAP ThreadsResponse:
  threads: [
    { id: 1, name: "Rule: when see enemy -> flee" },
    { id: 2, name: "Rule: when hungry -> eat" },
    { id: 3, name: "Rule: when idle -> wander" }
  ]
```

**Thread naming:** Thread names are derived from rule identity when available. The
debug metadata or the brain's rule index provides a mapping from fiber/funcId to a
human-readable rule description. If no rule name is available, the thread name falls
back to the function's `prettyName` or `"Fiber <id>"`.

**Thread lifecycle:** Fibers are created and destroyed dynamically. Root rule fibers
are respawned each tick if they complete. The debug adapter tracks fiber lifecycle
via `fiberCreated` / `fiberDestroyed` events and sends DAP `thread` events
accordingly. Short-lived fibers (created and destroyed within a single paused
interval) may be coalesced or omitted from reporting.

### Fiber lifecycle states

Each fiber is in exactly one `FiberState` at any time. The runtime enum values are
used in all protocol messages and internal state tracking:

| `FiberState` | Description                                                    |
| ------------ | -------------------------------------------------------------- |
| `RUNNABLE`   | Fiber is eligible for execution. In scheduler queue.           |
| `WAITING`    | Fiber hit AWAIT with a PENDING handle. Waiting for resolution. |
| `DONE`       | Fiber's entry function returned normally.                      |
| `FAULT`      | Fiber encountered an unhandled fault.                          |
| `CANCELLED`  | Fiber was externally terminated (e.g. page deactivation).      |

There is no separate "running" state. A `RUNNABLE` fiber is either queued or
actively executing (the scheduler picks one `RUNNABLE` fiber at a time for
execution within a tick). From the debugger's perspective, a fiber that is
currently executing is still `RUNNABLE`.

State transitions:

```
RUNNABLE  --> WAITING     (AWAIT with PENDING handle)
RUNNABLE  --> DONE        (entry function returns)
RUNNABLE  --> FAULT       (unhandled fault)
RUNNABLE  --> CANCELLED   (external cancellation during execution)
WAITING   --> RUNNABLE    (handle resolves, scheduler re-enqueues fiber)
WAITING   --> CANCELLED   (external cancellation while waiting)
```

`DONE`, `FAULT`, and `CANCELLED` are terminal states. A freshly spawned fiber
starts as `RUNNABLE`.

### DAP thread events

The debug adapter emits DAP `thread` events based on fiber lifecycle:

| Fiber transition         | DAP event                                       |
| ------------------------ | ----------------------------------------------- |
| Fiber spawned (RUNNABLE) | `thread` event with `reason: "started"`         |
| Fiber enters `DONE`      | `thread` event with `reason: "exited"`          |
| Fiber enters `FAULT`     | `stopped` event first, then `thread` `"exited"` |
| Fiber enters `CANCELLED` | `thread` event with `reason: "exited"`          |

Edge cases when the VM is paused:

- **Fiber completes while VM is paused (step completes to return):** The fiber
  reaches `DONE` state. The `stopped` event is sent for the step completion.
  The `thread` `"exited"` event is sent after the stop is processed. The fiber
  remains visible for inspection until the VM resumes.
- **Fiber faults during resume from suspension:** The fiber transitions directly
  from `WAITING` to `RUNNABLE` to `FAULT`. The VM pauses all fibers and sends
  a `stopped` event with `reason: "exception"`. The faulted fiber's stack is
  inspectable.
- **Root rule fiber respawn:** When a root rule fiber completes or faults and the
  scheduler respawns it on the next tick, the new fiber gets a new fiber ID. The
  old fiber's `thread` `"exited"` event and the new fiber's `thread` `"started"`
  event are emitted as separate events. Breakpoints still apply because they are
  bound by `debugFuncId` + PC, not by fiber ID.

All DAP `thread` lifecycle events are delivered within the context of the VM-wide
pause model. When the VM is paused, no fiber executes regardless of whether
`thread` `"started"` or `"exited"` events have been sent. The events update
VS Code's Threads pane but do not imply per-fiber execution.

### Target enumeration and selection

Each entity with user-authored code is a potential debug target:

```
DebugTarget {
  entityId: string
  entityName: string
  archetype: string
  brainId: string
  brainName: string
  hasUserCode: boolean
}
```

**From VS Code:** The user launches a debug session via Run and Debug. The extension
shows a quick-pick list of available targets (entity name + archetype + brain name).
The user selects one, and the extension sends `debug:attach` for that entity.

**From in-game:** The user selects an entity in the Mindcraft app. The app sends a
`debug:targetSelected` event. The extension can prompt to attach or auto-attach if
configured.

### Attach/detach

**Attach:**

```
debug:attach { entityId: "e1" }
->
{
  sessionId: "ds-001",
  programRevisionId: "rev-17",
  debugMetadata: { ... },
  fibers: [
    { fiberId: 1, state: "RUNNABLE", funcId: 5, name: "Rule: when see enemy -> flee" },
    { fiberId: 2, state: "WAITING", funcId: 8, name: "Rule: when hungry -> eat" }
  ]
}
```

On attach:

1. The VM debug runtime activates. This adds per-instruction checks for breakpoints
   and pause requests. No overhead on non-attached VMs.
2. Debug metadata for all user-authored functions is sent to the adapter.
3. The adapter resolves and installs any pending breakpoints.
4. The extension opens relevant source files if not already open.
5. The adapter sends a DAP `initialized` event, followed by `threads` response.

**Detach:**

On detach:

1. All breakpoints are removed from the VM.
2. If the VM is paused, it is resumed.
3. Debug instrumentation is deactivated (VM returns to full-speed execution).
4. The adapter sends a DAP `terminated` event.

### Scope of a debug session (v1)

- One debug session at a time (one attached VM).
- To debug a different entity, detach first, then attach to the new target.
- Other entities continue executing normally while one is being debugged.

---

## 9. Pause and Execution Control

### Safe points

A **safe point** is a PC where `pcToSpanIndex[pc]` resolves to a span with
`isStatementBoundary: true`. All debugger-visible execution events occur exclusively
at safe points:

- Breakpoint checks
- Pause request processing
- Step completion
- Stopped event emission

The VM executes instructions freely between safe points. No debugger interaction
occurs mid-instruction or at non-boundary PCs.

The compiler guarantees safe points at least at:

- Function entry (first instruction of every function body)
- Loop back-edges (the jump target at the start of each loop iteration)
- Before AWAIT suspension (the AWAIT instruction PC)
- After AWAIT resumption (the resume PC)
- Every statement boundary emitted during compilation

All pause, step, and breakpoint behavior depends on these guarantees. Code that
executes a long sequence of non-boundary instructions (e.g., a chain of
sub-expression evaluations) may delay a pending pause or step completion until
the next safe point is reached.

### VM-level pause semantics

All debugger stops are VM-wide. When any fiber hits a breakpoint, a manual pause
takes effect, or a fiber faults, **the entire attached VM is paused**:

- All fibers stop. No fiber executes further instructions until the debugger
  resumes.
- The triggering fiber is identified in the `stopped` event. VS Code focuses on
  that fiber's stack trace.
- Other fibers are visible as paused sibling threads in the Threads pane. The
  user can switch between them to inspect their state.
- Step operations (`stepOver`, `stepInto`, `stepOut`) run only the targeted
  fiber. All other fibers remain paused. After the step completes, the VM is
  paused again with all fibers frozen.
- `resumeVM` resumes all fibers together. There is no per-fiber resume in v1.

This model is required because brain-level shared variables (`LOAD_VAR` /
`STORE_VAR`) are visible to all rule fibers. If other fibers continued running
during a pause, shared state would mutate while the user inspects it. VM-wide
pause guarantees a frozen execution snapshot.

Other entities in the world **continue executing** unless the host app explicitly
pauses simulation. The debugger pauses one VM, not the world.

### Pause request timing

A `pauseVM` request sets a flag on the VM. The VM checks this flag at every safe
point. The pause takes effect at the next safe point reached by any executing fiber.
There is no guarantee of immediate pause -- if a fiber is between safe points, it
runs until the next one.

### Stopped event

When the VM stops, the debug runtime sends a stopped event identifying the
**triggering fiber** (the one that hit a breakpoint, was manually paused, or faulted):

```
StoppedEvent {
  reason: "breakpoint" | "pause" | "step" | "await" | "exception" | "entry"
  triggeringFiberId: number
  breakpointId: BreakpointId | null
  faultInfo: FaultInfo | null
}
```

The debug adapter translates this into a DAP `stopped` event with
`threadId = triggeringFiberId` and `allThreadsStopped: true`. The
`allThreadsStopped` flag tells VS Code that every thread is paused, not just
the triggering one. VS Code highlights the triggering thread and shows its
stack trace. The user can switch to other threads (fibers) in the Threads pane
to inspect their state.

### Resume

`resumeVM` resumes execution of all fibers. The scheduler continues its normal
tick cycle. Individual fiber resume is not supported in v1 -- all fibers resume
together.

### Stepping

Stepping commands target a specific fiber but keep the VM paused between steps.
All stepping is defined in terms of safe points (see section 6, execution boundary
model).

When a step begins, the adapter records:

- `initialDepth = fiber.frames.size()` -- the call stack depth at step start
- `initialSpan = pcToSpanIndex[topFrame.pc]` -- the span index at step start

These two values drive all step completion checks.

**Step over:**

Runs the targeted fiber until one of (whichever comes first):

1. `fiber.frames.size() == initialDepth` and `pcToSpanIndex[topFrame.pc] != initialSpan`
   and the PC is a safe point -> stop with `"step"` (reached a different statement
   at the same depth).
2. `fiber.frames.size() < initialDepth` and the PC is a safe point -> stop with
   `"step"` (current frame returned; now in caller).
3. The fiber suspends at an AWAIT (see section 10) -> stop with `"await"`.

All other fibers remain frozen. On completion, the VM re-pauses and sends a
`stopped` event with the corresponding reason.

**Step into:**

Same as step-over, except: if the current instruction is a CALL to user-authored
code (identified by `CallSiteInfo.targetDebugFunctionId` being non-null and the
target's `isGenerated` being false), execution enters the called function and
pauses at its first safe point. Specifically,
`fiber.frames.size() > initialDepth` and the PC is a safe point -> stop with
`"step"`.

Generated functions (`isGenerated: true`) are treated as opaque by step-into:
stepping into a call that targets a generated function behaves as step-over.
This keeps stepping aligned with authored code.

HOST_CALL, HOST_CALL_ARGS, HOST_CALL_ASYNC, and HOST_CALL_ARGS_ASYNC (built-in
host functions) cannot be stepped into. Step-into on any host call behaves as
step-over.

**Step out:**

Runs the targeted fiber until one of:

1. `fiber.frames.size() < initialDepth` and the PC is a safe point -> stop with
   `"step"` (current frame returned; now in caller).
2. If `initialDepth == 1` (outermost frame), the fiber runs to completion or next
   breakpoint.
3. The fiber suspends at an AWAIT before the frame returns -> stop with `"await"`
   (see section 10).

**During a step, only the targeted fiber executes.** Other fibers remain paused.
After the step completes, the VM is paused again with all fibers frozen.

### Synchronous user-code dispatch (reentrant execution)

When a rule fiber reaches a `HOST_CALL` that dispatches to a user-authored
synchronous sensor, the VM executes the sensor's program inline via reentrant
dispatch. This does not create a new visible DAP thread in v1.

From the debugger's perspective:

- The sensor's entry function is pushed as a normal frame on the calling
  fiber's call stack. Stepping into such a HOST_CALL produces a frame push
  on the same thread, not a thread spawn.
- The sensor's frames appear in the call stack of the current fiber,
  interleaved with the caller's frames as with any function call.
- Breakpoints inside the sensor's code fire on the calling fiber's thread.
- No separate scheduling model is exposed. The reentrant call runs to
  completion within the current tick.

This avoids introducing hidden thread complexity. The user sees a deeper call
stack on the same thread, which accurately reflects the synchronous execution
semantics.

---

## 10. Async and Coroutine Debugging

### Fiber identity across suspend/resume

When a fiber hits an AWAIT instruction with a PENDING handle, the fiber transitions
to `WAITING` state. When the handle resolves, the scheduler resumes the **same fiber**
(same fiber ID, same call frames, same local variables). The fiber's identity is
preserved across suspension.

A resumed fiber retains its DAP thread ID. It appears as the same thread to the
user, providing a continuous execution history for that rule's fiber.

### What happens at an await point

All pause points at await boundaries correspond to compiler-emitted
`SuspendSiteInfo` entries. Each `SuspendSiteInfo` records the `awaitPc` (the PC
of the AWAIT instruction) and `resumePc` (the PC where execution resumes after
the handle resolves). Both PCs are safe points.

When execution reaches `HOST_CALL_ASYNC` + `AWAIT`:

1. The `HOST_CALL_ASYNC` instruction creates a handle and starts the async operation.
2. The `AWAIT` instruction checks the handle state:
   - If RESOLVED: the result is pushed onto the stack and execution continues
     synchronously. No suspension occurs.
   - If PENDING: the fiber transitions to `WAITING`. The fiber's full state (stack,
     frames, locals) is preserved. The fiber is removed from the run queue.
3. Later, when the handle resolves, the scheduler calls `resumeFiberFromHandle`,
   which restores the fiber to `RUNNABLE`, pushes the result onto the stack, and
   re-enqueues it.

### Stepping rules at await points

All stepping rules are extensions of the safe-point model (section 9). Suspension
adds one additional termination condition to each step type. The `initialDepth` and
`initialSpan` values recorded at step start (section 9) carry through to async
stepping.

**Step over:**

Runs the targeted fiber until one of (whichever comes first):

1. `fiber.frames.size() == initialDepth` and `pcToSpanIndex[topFrame.pc] != initialSpan`
   and the PC is a safe point -> stop with `"step"`
2. `fiber.frames.size() < initialDepth` and the PC is a safe point -> stop with `"step"`
3. Fiber hits AWAIT with PENDING handle -> stop with `"await"`

If condition 3 fires, the step is **interrupted, not abandoned**. When the handle
resolves and the fiber resumes, the VM re-pauses at the next safe point after
the resume PC and sends a `stopped` event with `reason: "step"`.

The user sees two stops: one at the await (`"await"` reason) and one when the
fiber resumes (`"step"` reason).

**Step into:**

Same as step-over, plus: if the current instruction is a CALL to user-authored
code (`CallSiteInfo.targetDebugFunctionId` is non-null and the target's
`isGenerated` is false), enter the called function and pause at its first safe
point (`fiber.frames.size() > initialDepth`).

HOST_CALL_ASYNC, HOST_CALL_ARGS_ASYNC, and all other host call variants cannot
be stepped into (native code). Step-into on any host call behaves as step-over.
Step-into on a CALL targeting a generated function also behaves as step-over
(same rule as section 9).

**Step out:**

Runs the targeted fiber until one of:

1. `fiber.frames.size() < initialDepth` and the PC is a safe point -> stop with
   `"step"` (current frame returned)
2. Fiber hits AWAIT with PENDING handle -> stop with `"await"`

If suspended, when the fiber resumes, the step continues toward the frame return.

### Breakpoints after resumption

If a breakpoint is encountered after a fiber resumes from suspension, it triggers
normally. The VM pauses all fibers and sends a `stopped` event with
`reason: "breakpoint"`. The pending step (if any) is cancelled by the breakpoint
hit -- the breakpoint takes precedence.

### Summary of v1 async guarantees

| Scenario                         | Behavior                                                     |
| -------------------------------- | ------------------------------------------------------------ |
| Step over sync statement         | Pauses at next safe point. Deterministic.                    |
| Step over await (handle ready)   | Handle resolved immediately. Pauses at next safe point.      |
| Step over await (handle pending) | Fiber suspends. Stopped with `"await"`. Re-pauses on resume. |
| Step into HOST_CALL_ASYNC        | Behaves as step-over (native code).                          |
| Step into user async function    | Enters function, pauses at first safe point.                 |
| Step out with pending await      | Stopped with `"await"` at suspension. Completes on resume.   |
| Breakpoint hit after resume      | Normal breakpoint. Pending step cancelled.                   |

The two-stop behavior for pending awaits (stop at suspension, then stop again
at resumption) is inherent to the coroutine execution model. It is expected
behavior, not a debugger limitation. The user always sees where their fiber
suspended and where it resumed.

---

## 11. Breakpoint Semantics

### Breakpoint lifecycle

A breakpoint goes through distinct states:

| State      | Meaning                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `pending`  | Set by user but no debug session active. Stored in adapter only.        |
| `verified` | Resolved to a safe-point PC at the requested line. Installed in the VM. |
| `moved`    | Resolved to a safe-point PC at a different line than requested.         |
| `unbound`  | Could not resolve to any executable code. Displayed as unverified.      |

`verified` and `moved` both result in an active breakpoint in the VM. The
distinction is reported to VS Code via the `breakpoint` event so the UI can show
the actual resolved line.

### Breakpoint resolution algorithm

When a debug session is active and the user sets a breakpoint at a source line,
the adapter runs a multi-stage resolution:

**Stage 1: Exact span match (preferred)**

Find a `Span` with `isStatementBoundary: true` whose `startLine` equals the
requested line, within a non-generated function (`isGenerated: false`) whose
`sourceSpan` contains the line.

If found: breakpoint is **verified** at that span's PC.

**Stage 2: Same function, nearest span**

Within the same `DebugFunctionInfo`, find the nearest `Span` (by line distance)
with `isStatementBoundary: true`. Prefer the nearest span on a later line (forward
search) over an earlier line.

If found: breakpoint is **moved** to that span's line. The adapter sends
`debug:setBreakpoint` with the resolved `debugFuncId` and `pc`, and reports the
adjusted location to DAP.

**Stage 3: Same file, nearest span**

Search all non-generated `DebugFunctionInfo` entries in the same file for the
nearest span boundary by line distance.

If found: breakpoint is **moved**. This handles cases where the requested line
falls between function boundaries (e.g., between two function declarations).

**Stage 4: Unbound**

No executable span found in the file at or near the requested line. The breakpoint
is **unbound**. The adapter responds to DAP with `verified: false`.

After resolution, the adapter sends `debug:setBreakpoint` to the app with the
`debugFuncId` and `pc`, and responds to the DAP `setBreakpoints` request with
the resolved locations.

**Surfacing breakpoint state:** The adapter must report all three observable
states to VS Code:

- **Bound** (`verified`): breakpoint resolved at the requested line. DAP
  `breakpoint` event with `verified: true` and the resolved location.
- **Moved**: breakpoint resolved at a different line. DAP `breakpoint` event
  with `verified: true` and the actual resolved line (VS Code shows the
  breakpoint marker at the adjusted line).
- **Unbound**: no resolution possible. DAP `breakpoint` event with
  `verified: false`. VS Code dims the breakpoint marker.

### Re-resolution after recompilation

When the source file is recompiled (e.g., after a save), the debug session is
detached and re-attached (see section 11, "Recompilation during an active debug
session"). During re-attach, all breakpoints are re-resolved against the new
debug metadata using the **original requested line** (not the previously resolved
line). The resolution algorithm (stages 1-4) runs for each breakpoint. Breakpoints
that can no longer resolve become `unbound`.

Re-resolution uses the original requested line because the user's intent is tied
to a line in the source, not to a bytecode address that may have shifted.

### Span identity for rebinding

Each `Span` has a `spanId` assigned by the compiler. The compiler attempts to
produce deterministic `spanId` values based on source position within the function,
but stability is **best-effort**: refactoring, reordering statements, or compiler
changes may alter `spanId` assignment. The adapter may record the `spanId` at
resolution time and attempt a `spanId`-first match during re-resolution, but must
always fall back to the line-based algorithm (stages 1-4) if no `spanId` match
is found.

This is a performance hint, not a correctness requirement. The line-based algorithm
is the primary and authoritative resolution path.

### Semantic drift

The adapter does **not** attempt to track semantic changes (e.g., "this line moved
down by 3 lines") and does not use AST-based matching or heuristic rebinding.
Re-resolution is purely by line proximity against the current debug metadata's
spans. If the user edits the file such that a breakpoint line now contains
different code, the breakpoint binds to whatever statement is now at that line
and is reported as `moved` if the resolved line differs from the requested line.
This matches the behavior of most debuggers.

### Breakpoint types (v1)

Only **line breakpoints** are supported in v1. Each breakpoint targets a source file
and line number.

Not supported in v1:

- Conditional breakpoints (require expression evaluation)
- Logpoints (require expression evaluation + output channel)
- Function breakpoints (require function name resolution at debug time)
- Instruction breakpoints (raw bytecode PC -- not exposed to users)
- Data breakpoints / watchpoints (require memory monitoring)

### Recompilation during an active debug session

When the user saves a file while a debug session is active, the app recompiles
the affected source. The v1 policy is **detach on recompile**:

1. The app compiles the updated source.
2. If compilation succeeds: the debug adapter automatically detaches the current
   session. A DAP `terminated` event is sent. The adapter then re-attaches using
   the new debug metadata, starting a fresh debug session. Breakpoints are
   re-resolved against the new metadata using original requested lines.
3. If compilation fails: the old bytecode and old debug metadata remain active.
   The debug session continues uninterrupted. Diagnostics are reported to VS Code.

There is no hot reload in v1. Recompiled code does not replace running bytecode
in-flight. The detach-reattach cycle ensures the debug session always refers to
the currently compiled bytecode and metadata. There is no "stale frame" state.

**Bytecode after re-attach:** After successful recompilation and re-attach, the
VM executes the **new** bytecode. The scheduler restarts rule fibers from their
entry points using the new program revision. No fiber continues executing old
bytecode after re-attach -- the detach-reattach cycle is a clean cut. The brain's
normal page re-entry or restart behavior applies: callsite-persistent state
(`callsiteVars`) is re-initialized by the module init function, and brain-level
variables retain their values.

---

## 12. Stack, Scopes, and Variable Inspection

### Stack frame reconstruction

When a fiber is paused, its `frames: List<Frame>` contains the call stack. Each
`Frame` has `funcId`, `pc`, and `base` (stack base index). The debug adapter maps
these to DAP `StackFrame` objects using the debug metadata:

1. Look up the `DebugFunctionInfo` where `compiledFuncId == frame.funcId`.
2. Use `pcToSpanIndex[frame.pc]` to get the span index. Read `spans[index]` for
   source location (line, column, end line, end column).
3. Use `DebugFileInfo[fileIndex].path` for the source file path. Construct the
   `mindcraft://` URI for the DAP `Source` object.
4. Use `prettyName` for the frame's display name.
5. If `isGenerated` is true, mark the frame as `subtle` (dimmed in the UI).
   See "Generated function handling" below.

Helper functions are normal frames in the call stack. They inherit access to
callsite-persistent state (module variables) and are presented identically to
entry-point frames. The debugger makes no distinction based on "entry vs helper"
-- presentation reflects source-level visibility.

Stack frames are ordered top (current) to bottom (outermost). The outermost frame
of a rule fiber is the rule's entry function (or a generated wrapper). Each frame
gets a unique integer `frameId` assigned by the adapter for the duration of the
stop.

**Frame ID stability:** `frameId` values are valid only while the VM is paused at
the current stop. When the VM resumes (continue, step), all `frameId` values are
invalidated. After the next stop, the adapter assigns fresh `frameId` values. The
adapter must not assume any relationship between `frameId` values across stops.
DAP `scopes` and `variables` requests reference `frameId`; the adapter rejects
requests with stale `frameId` values.

For cross-file calls, the stack trace naturally spans files because each
`DebugFunctionInfo` carries its own `fileIndex`. The adapter resolves each frame's
source location independently. Multi-file compilation is fully implemented.

### Generated function handling

The compiler produces generated functions beyond user-declared code. Each is
marked with `isGenerated: true` in its `DebugFunctionInfo`.

**Generated functions in v1:**

| Function                | Purpose                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| Module init             | Evaluates top-level variable initializers via `STORE_CALLSITE_VAR`.    |
|                         | Runs once per callsite on first invocation and again on page re-entry. |
| `onPageEntered` wrapper | Calls module init to reset state, then calls user's `onPageEntered`.   |

**Debugger behavior for generated functions:**

- **Stack traces:** Generated functions appear in stack traces but are rendered
  `subtle` (dimmed in VS Code). They are always present for correctness but
  visually de-emphasized.
- **Stepping:** Step-into on a CALL targeting a generated function behaves
  as step-over -- the generated function executes but the debugger does not
  pause inside it. If the debugger is already stopped inside a generated
  frame (e.g., it was entered via a breakpoint in a non-generated callee
  below it), step-out works normally.
- **Breakpoints:** Users cannot set breakpoints inside generated functions in
  v1. The adapter's breakpoint resolution algorithm (section 11) only resolves
  to spans in non-generated functions. If a user sets a breakpoint on a line
  that maps to a generated function's span, the breakpoint is `unbound`.
- **Scope inspection:** Generated frames expose the same scopes as any other
  frame (Locals, Callsite State if applicable, Brain Variables). No special
  restrictions.

### Scope model

Scope presentation is strictly source-driven. When paused at any frame, the
debugger shows all variables that are semantically visible at that source
location. There are no restrictions based on frame type (entry point vs helper).

For each stack frame, the adapter presents up to three scopes. Each scope
corresponds to a `ScopeInfo.kind` in the compiler's debug metadata and is a
separate entry in the DAP `scopes` response.

**Locals** (`kind: "function"` / `kind: "block"`) -- per-frame, per-fiber:

Parameters and local variables for the current frame, derived from `LocalInfo`
entries in the debug metadata. Only variables where
`lifetimeStartPc <= frame.pc < lifetimeEndPc` are shown. Parameters appear first.

Resolution: for each in-scope `LocalInfo`, read the value from
`fiber.frames[frameIndex].locals[localInfo.slotIndex]`. Block scopes
(`kind: "block"`) are flattened into the single "Locals" DAP scope, with
lifetime filtering providing correct visibility.

DAP scope: `{ name: "Locals", presentationHint: "locals" }`

**Callsite State** (`kind: "module"`) -- per-callsite, persists across ticks:

Top-level persistent bindings (`LOAD_CALLSITE_VAR` / `STORE_CALLSITE_VAR`) visible
from the current module. These are scoped per-callsite -- each usage of a
user-authored tile gets independent module state.

Resolution: the adapter reads the `callsiteVars` array from the callsite state
associated with the current fiber's callsite ID. Variable names come from the
debug metadata's `ScopeInfo` entries with `kind: "module"`.

DAP scope: `{ name: "Callsite State" }`

Scope presentation is based on source-level visibility, not frame type. Any
frame whose function is defined in the same authored module has the module's
top-level `let`/`const` bindings in lexical scope, so the debugger exposes
Callsite State for that frame. This means helper functions called from an
entry point see the same Callsite State as the entry point itself, because
those module variables are semantically visible at the helper's source
location. The callsite ID used to resolve `callsiteVars` is the one established
by the entry-point callsite, shared across the entire call tree rooted at
that entry point.

**Brain Variables** (`kind: "brain"`) -- shared across all fibers:

Shared brain-level bindings (`LOAD_VAR` / `STORE_VAR`). Visible from all rules
and all frames. When the VM is paused, brain variables are frozen and can be
inspected consistently.

Resolution: the adapter reads values via `ExecutionContext.getVariable()`, which
delegates to `brain.getVariable()` (a `Dict<string, Value>` keyed by variable
name). Variable names come from `BrainProgram.variableNames`.

DAP scope: `{ name: "Brain Variables" }`

### What is inspectable at each stop point

| Stop point             | Locals                | Callsite State | Brain Variables |
| ---------------------- | --------------------- | -------------- | --------------- |
| Normal safe point      | Current frame locals  | Yes            | Yes             |
| Just before suspension | Current frame locals  | Yes            | Yes             |
| Just after resumption  | Restored frame locals | Yes            | Yes             |
| Fault                  | Last frame locals     | Yes            | Yes             |

After resumption from an AWAIT, the fiber's stack, frames, and locals are fully
restored. The debugger sees the same local variables as before suspension, plus the
result of the awaited operation (pushed onto the stack and typically stored into a
local).

On fault, the stack trace shows the frame where the fault occurred. Locals are
available for the faulted frame and all frames below it.

### Variable representation

Mindcraft `Value` types are mapped to DAP variable display:

| Value type   | DAP type    | Display                                                         |
| ------------ | ----------- | --------------------------------------------------------------- |
| NumberValue  | `"float"`   | Numeric literal                                                 |
| StringValue  | `"string"`  | Quoted string                                                   |
| BooleanValue | `"boolean"` | `true` / `false`                                                |
| NilValue     | (none)      | `nil`                                                           |
| EnumValue    | `"string"`  | Enum key string (e.g. `"Idle"`)                                 |
| ListValue    | (none)      | `[item0, item1, ...]` with expandable children                  |
| MapValue     | (none)      | `{ key: value, ... }` with expandable children                  |
| StructValue  | (none)      | `{ field: value, ... }` with expandable children                |
| HandleValue  | (none)      | `<Handle: PENDING>`, `<Handle: RESOLVED>`, `<Handle: REJECTED>` |
| VoidValue    | (none)      | `void`                                                          |

### Variable identity and DAP handles

DAP uses integer `variablesReference` values to enable lazy child expansion of
structured values. The adapter manages these as follows:

**Handle allocation:** When the adapter builds a `scopes` or `variables` response,
it assigns a unique `variablesReference` integer to each expandable value (lists,
maps, structs). Non-expandable values (numbers, strings, booleans, nil) have
`variablesReference: 0`.

**Handle structure:**

```
VariableHandle
  id: number                      -- the variablesReference integer
  fiberId: number                 -- which fiber's state this references
  frameIndex: number              -- which stack frame (for locals)
  kind: "local" | "module" | "brain" | "child"
  path: (string | number)[]      -- path from scope root to this value
                                  -- e.g. ["myList", 2] for myList[2]
```

**Handle stability:** Handles are valid only while the VM is paused at the same
stop. When the VM resumes (continue, step), all outstanding handles are
invalidated. The adapter rejects `variables` requests with stale handles. This
is standard DAP behavior -- VS Code re-requests scopes and variables after each
stop.

**Child enumeration:** When VS Code sends a `variables` request with a
`variablesReference`, the adapter resolves the handle's path back to the VM value
and enumerates its children:

- ListValue: children are indexed (name = `"[0]"`, `"[1]"`, ...)
- MapValue: children are keyed (name = key string)
- StructValue: children are fields (name = field name)

**Scope references:** Each scope in a `scopes` response also has a
`variablesReference`. When VS Code requests `variables` for a scope reference,
the adapter returns the top-level variables in that scope.

---

## 13. Faults and Exception Handling

### Fault sources

Faults can originate from:

1. **User code error:** Division by zero, nil dereference, out-of-bounds access.
   These produce a `ScriptError` via the VM's THROW instruction or implicit runtime
   checks.
2. **Host function error:** A HOST_CALL throws an error (e.g., invalid argument to
   engine API). The VM catches this and transitions the fiber to `FAULT` state.
3. **Budget exhaustion:** Not a fault per se -- the fiber yields with `YIELDED` status
   and is re-enqueued. But if a fiber consistently exhausts budget without progress,
   it may indicate an infinite loop.
4. **Cancellation:** The fiber is cancelled (e.g., page deactivation). This is
   `CANCELLED` state, not `FAULT`. Cancellation is not a debugger stop reason --
   cancelled fibers are simply destroyed.

### Fault behavior in the debugger

When debug instrumentation is active and a fiber faults:

1. The VM transitions the fiber to `FAULT` state.
2. The VM pauses **all fibers** in the attached VM (same as breakpoint hit).
3. A `stopped` event is sent with `reason: "exception"`:

```
StoppedEvent {
  reason: "exception"
  triggeringFiberId: number
  faultInfo: {
    tag: number               -- numeric ErrorCode (e.g. ErrorCode.ScriptError = 4)
    tagName: string           -- canonical name from errorCodeName(tag)
    message: string           -- human-readable error message
    isUserCode: boolean       -- true if fault originated in user bytecode
    location: {               -- source location of the faulting instruction
      file: string
      line: number
      column: number
    } | null
  }
}
```

4. The faulted fiber's stack trace remains available for inspection. All frames,
   locals, and scopes are preserved in the state they were in when the fault
   occurred.

**v1 fault policy:** All faults stop execution. There is no exception filter
configuration and no distinction between "caught" and "uncaught" faults in v1.
Every unhandled fault pauses the entire VM. This is consistent with the VM-wide
pause model -- a faulted fiber causes all sibling fibers to freeze, exactly
like a breakpoint hit.

### Stack traces on fault

The faulted fiber's `frames` list shows the full call stack at the point of failure.
If a TRY/CATCH handler caught the error, the stack reflects the handler's frame.
If no handler caught it (the common case in v1, since try/catch is Phase 2), the
stack shows the frame where the fault originated.

### User faults vs host faults

| Fault origin        | `isUserCode` | Debugger behavior                                                                              |
| ------------------- | ------------ | ---------------------------------------------------------------------------------------------- |
| User bytecode error | true         | Stops. Stack trace points to user source.                                                      |
| Host function error | false        | Stops. Stack trace shows the HOST_CALL site in user code. The host error message is displayed. |

In both cases the debugger stops and the user sees where in their code the fault
occurred. For host faults, the error message from the host function is surfaced but
the host function's internal native stack is not visible.

### Cancellation

Cancelled fibers (e.g., page deactivation) are not debugger stop events. The debug
adapter receives a `fiberDestroyed` event with the cancellation reason. If the
cancelled fiber was mid-step, the step is abandoned.

### Canonical stop reasons

The VM emits exactly these stop reasons. This is the complete set for v1.

| Reason     | DAP `stopped.reason` | Trigger                                              |
| ---------- | -------------------- | ---------------------------------------------------- |
| Breakpoint | `"breakpoint"`       | Fiber reached a PC with an installed breakpoint      |
| Pause      | `"pause"`            | User requested pause; took effect at next safe point |
| Step       | `"step"`             | Step operation completed at target safe point        |
| Await      | `"await"`            | Fiber suspended at AWAIT with PENDING handle         |
| Exception  | `"exception"`        | Fiber faulted (unhandled error)                      |
| Entry      | `"entry"`            | Stopped on attach (if configured)                    |

`"await"` is a Mindcraft-specific extension. Standard DAP clients display it as a
generic stop reason, which is acceptable. `"exception"` is the standard DAP reason
for faults; the VM uses this rather than a custom `"fault"` reason.

No other stop reasons are emitted. If a stop does not fit one of these categories,
it is a bug.

---

## 14. DAP Capability Contract

### Capabilities declared by the debug adapter (v1)

| DAP Capability                          | Value   | Notes                                                                                                                             |
| --------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `supportsConfigurationDoneRequest`      | `true`  | Standard handshake flow.                                                                                                          |
| `supportsFunctionBreakpoints`           | `false` | Line breakpoints only in v1.                                                                                                      |
| `supportsConditionalBreakpoints`        | `false` | No expression evaluation for conditions.                                                                                          |
| `supportsHitConditionalBreakpoints`     | `false` | No hit count tracking.                                                                                                            |
| `supportsEvaluateForHovers`             | `true`  | Identifier-only evaluation (see below).                                                                                           |
| `supportsStepBack`                      | `false` | No reverse execution.                                                                                                             |
| `supportsSetVariable`                   | `false` | Read-only inspection in v1.                                                                                                       |
| `supportsRestartFrame`                  | `false` | Cannot re-enter a frame in the VM.                                                                                                |
| `supportsGotoTargetsRequest`            | `false` | Cannot jump to arbitrary PC.                                                                                                      |
| `supportsStepInTargetsRequest`          | `false` | Single step-into target only.                                                                                                     |
| `supportsCompletionsRequest`            | `false` | No expression completion in v1.                                                                                                   |
| `supportsModulesRequest`                | `false` | DAP "modules" tracks loaded libraries/DLLs, not applicable to Mindcraft's model. Use `loadedSources` for source file enumeration. |
| `supportsRestartRequest`                | `false` | Detach + re-attach instead.                                                                                                       |
| `supportsExceptionInfoRequest`          | `true`  | Fault details are available.                                                                                                      |
| `supportsExceptionFilterOptions`        | `false` | No exception filter configuration in v1. All faults stop.                                                                         |
| `supportsLoadedSourcesRequest`          | `true`  | Reports user-authored source files loaded in the program.                                                                         |
| `supportsTerminateRequest`              | `false` | Detach only; cannot terminate the VM.                                                                                             |
| `supportsDataBreakpoints`               | `false` | No memory watchpoints.                                                                                                            |
| `supportsInstructionBreakpoints`        | `false` | Bytecode PC not exposed to users.                                                                                                 |
| `supportsSingleThreadExecutionRequests` | `false` | VM pauses all threads; no per-thread resume.                                                                                      |

### Evaluate semantics (v1: identifier-only)

The adapter supports the DAP `evaluate` request with a constrained model:

**Allowed:**

- Simple identifiers: a single variable name that exists in the current scope
  (e.g., `enemy`, `speed`, `count`).
- The adapter resolves the identifier against the current frame's locals, then
  module variables, then brain variables -- same precedence as variable inspection.

**Not allowed (returns an error response):**

- Arbitrary expressions (e.g., `a + b`, `list[0]`, `obj.field`)
- Function calls (e.g., `Math.abs(x)`)
- Assignment or any side-effecting expression
- Dotted paths (e.g., `entity.position`)

**Evaluation context:**

- The `evaluate` request includes a `frameId`. The adapter resolves the identifier
  in that frame's scope chain only.
- If `context` is `"hover"`: the adapter extracts the identifier from the
  expression text and looks it up. This provides hover-to-inspect for simple
  variables.
- If `context` is `"watch"`: same identifier lookup. This allows the Watch pane
  to show variable values, but only for single identifiers.
- If `context` is `"repl"`: returns an error. No REPL evaluation in v1.

This model is deliberately minimal. The v1 debugger supports variable inspection
only -- no expression evaluation, no computed values, no side effects. It provides
useful hover and watch behavior for the common case (inspecting a single variable
by name) without requiring an expression parser or on-the-fly bytecode compiler.
The scope chain for identifier resolution is: locals, then callsite/module
variables (if applicable), then brain variables. Expanding to support dotted
paths or simple expressions is a future enhancement.

### Exception breakpoint filters

v1 declares a single exception filter:

```json
{
  "filter": "all",
  "label": "All Faults",
  "default": true,
  "description": "Break when any fiber faults"
}
```

All faults stop execution by default. There is no distinction between "caught" and
"uncaught" exceptions in v1 (try/catch is Phase 2).

### Loaded sources

The adapter responds to `loadedSources` with the list of user-authored source files
that are part of the attached brain's compiled program:

```json
{
  "sources": [{ "name": "nearby-enemy.ts", "path": "mindcraft://w1/sensors/nearby-enemy.ts" }]
}
```

This enables VS Code to show which source files are part of the debug session and
allows "Open Loaded Source" navigation.

---

## 15. State Ownership and Sync

### Canonical source of truth

The Mindcraft world/project is the canonical store for all source code. This is a
fundamental design principle:

- Worlds are portable and self-contained. All source code travels with the world.
- VS Code is an external editor, not the source of truth.
- If VS Code disconnects, the world retains all code.
- If the world is shared/exported, all source code is included.

### Write semantics

When VS Code saves a file:

1. The extension writes to the notifying filesystem, which sends a `filesystem:change`
   message to the bridge with the new content and an etag.
2. The bridge relays the change to the bound app.
3. The app stores the content in the world/project data.
4. The app responds with an ACK (or error if the write fails).
5. If the ACK fails, the extension queues the change as pending and retries on reconnect.

### Conflict handling (etag-based optimistic concurrency)

The bridge client implements etag-based optimistic concurrency:

- Each file has an etag that changes on every write.
- Write operations include the last-known etag.
- If the etag does not match (another client wrote in between), the write is
  rejected with a conflict error.
- The extension detects etag mismatches and prompts the user to sync and retry.

This is sufficient for the expected single-user editing workflow. Conflicts can
arise from multiple VS Code windows or if the app creates/modifies files
programmatically.

### Offline editing

Offline editing is **not supported in v1**. VS Code cannot edit files without an active
connection to the Mindcraft app. If the connection drops:

- The extension queues any pending changes with deduplication.
- The status bar shows a disconnected indicator (orange if pending changes exist).
- The extension attempts reconnection with exponential backoff (500ms-30s).
- When the connection is restored using the saved binding token, the extension
  sends pending changes and requests a filesystem sync to reconcile state.

### World lifecycle events

The app notifies the extension of world-level changes:

| Event (planned)              | Behavior                                    |
| ---------------------------- | ------------------------------------------- |
| `session:worldChanged`       | Extension tears down FS + debug, reinits    |
| `session:worldClosed`        | Extension tears down FS + debug             |
| `session:entityAdded`        | Extension refreshes target list             |
| `session:entityRemoved`      | Extension detaches if debugging that entity |
| `session:brainChanged`       | Extension refreshes source files + targets  |

**Note:** These world lifecycle events are planned. The message types follow the
implemented `category:action` naming convention (colon-separated, not slash-separated).

---

## 16. Protocol Design

### Implemented message types

The following message types are defined in `packages/bridge-protocol` and implemented
in the bridge server and clients:

#### Session (`session:*`) [done]

| Type                   | Direction         | Purpose                                           |
| ---------------------- | ----------------- | ------------------------------------------------- |
| `session:hello`        | client -> server  | Handshake with app/extension metadata             |
| `session:welcome`      | server -> client  | Session ID, join code, binding token              |
| `session:goodbye`      | client -> server  | Graceful disconnect                               |
| `session:error`        | server -> client  | Session-level error                               |
| `session:appStatus`    | server -> ext     | Binding state, project metadata, client status    |
| `session:joinCode`     | server -> app     | Refreshed join code (every 10 min)                |

#### Control (`control:*`) [done]

| Type                   | Direction         | Purpose                                           |
| ---------------------- | ----------------- | ------------------------------------------------- |
| `control:ping`         | bidirectional     | Heartbeat (15s interval)                          |
| `control:pong`         | bidirectional     | Heartbeat response                                |

#### Filesystem (`filesystem:*`) [done]

| Type                   | Direction         | Purpose                                           |
| ---------------------- | ----------------- | ------------------------------------------------- |
| `filesystem:change`    | bidirectional     | File change notification (write/delete/rename/    |
|                        |                   | mkdir/rmdir) with seq number and etag             |
| `filesystem:sync`      | bidirectional     | Full state sync (request/response with entries)   |

#### Error (`error`) [done]

| Type                   | Direction         | Purpose                                           |
| ---------------------- | ----------------- | ------------------------------------------------- |
| `error`                | server -> client  | General protocol error                            |

### Planned message types (for Phase 2)

The bridge server has stub handlers for these categories. The message types below
are the target design for compile, debug, and project operations.

#### Compilation (`compile:*`) [planned]

| Type                | Direction  | Purpose                                        |
| ------------------- | ---------- | ---------------------------------------------- |
| `compile:rebuild`   | ext -> app | Request full recompilation of all source files |
| `compile:diagnostics` | app -> ext | Compilation diagnostics for a file (event)   |
| `compile:status`    | app -> ext | Compilation success/failure summary (event)    |
| `compile:debugMetadata` | app -> ext | Updated debug metadata after compile (event) |

#### Debug (`debug:*`) [planned]

| Type                     | Direction  | Purpose                                             |
| ------------------------ | ---------- | --------------------------------------------------- |
| `debug:listTargets`      | ext -> app | Enumerate debuggable entities                       |
| `debug:targetListChanged`| app -> ext | Target list changed (event)                         |
| `debug:targetSelected`   | app -> ext | User selected entity in-game (event)                |
| `debug:attach`           | ext -> app | Attach debugger to an entity's VM                   |
| `debug:detach`           | ext -> app | Detach debugger from an entity's VM                 |
| `debug:setBreakpoint`    | ext -> app | Set breakpoint (debugFuncId + pc)                   |
| `debug:removeBreakpoint` | ext -> app | Remove a breakpoint                                 |
| `debug:pauseVM`          | ext -> app | Pause the entire attached VM                        |
| `debug:resumeVM`         | ext -> app | Resume the entire attached VM                       |
| `debug:stepOver`         | ext -> app | Step over on a specific fiber                       |
| `debug:stepInto`         | ext -> app | Step into on a specific fiber                       |
| `debug:stepOut`          | ext -> app | Step out on a specific fiber                        |
| `debug:listFibers`       | ext -> app | Get all fibers and their states                     |
| `debug:getStackTrace`    | ext -> app | Get call stack for a fiber                          |
| `debug:getScopes`        | ext -> app | Get variable scopes for a stack frame               |
| `debug:getVariables`     | ext -> app | Get variables within a scope                        |
| `debug:evaluate`         | ext -> app | Look up a single identifier in a scope              |
| `debug:getExceptionInfo` | ext -> app | Get fault details for a faulted fiber               |
| `debug:stopped`          | app -> ext | VM stopped (breakpoint, fault, step, pause) (event) |
| `debug:continued`        | app -> ext | VM resumed execution (event)                        |
| `debug:fiberCreated`     | app -> ext | New fiber spawned (event)                           |
| `debug:fiberDestroyed`   | app -> ext | Fiber completed or cancelled (event)                |
| `debug:output`           | app -> ext | Debug output message (event)                        |

### Message structure examples

**Session handshake (actual):**

```json
{
  "type": "session:hello",
  "id": "req-1",
  "payload": {
    "appName": "Mindcraft Sim",
    "projectId": "proj-123",
    "projectName": "Ecosystem Demo"
  }
}
```

**Filesystem change (actual):**

```json
{
  "type": "filesystem:change",
  "id": "req-2",
  "seq": 42,
  "payload": {
    "action": "write",
    "path": "sensors/nearby-enemy.ts",
    "content": "aW1wb3J0IHsgU2Vuc29y...",
    "newEtag": "abc123"
  }
}
```

**Debug stopped event (planned):**

```json
{
  "type": "debug:stopped",
  "payload": {
    "sessionId": "ds-001",
    "triggeringFiberId": 1,
    "reason": "breakpoint",
    "breakpointId": "bp-3",
    "location": { "file": "sensors/nearby-enemy.ts", "line": 12, "column": 4 }
  }
}
```

### Protocol versioning

The `session:hello` message includes a `protocolVersion` field (semver string). The
app responds with its supported version. If the major versions are incompatible, the
connection is rejected with an error message directing the user to update the
extension or app.

---

## 17. Deployment Models

### Current architecture

```
+-----------+         WS          +-------------------+
|  VS Code  |<------------------->|  Bridge Server    |
| Extension |    /extension       | (apps/vscode-     |
+-----------+                     |  bridge)          |
                                  | Hono + Node.js    |
                                  +--------+----------+
                                           |
                                      WS /app
                                           |
                                  +--------v----------+
                                  |   Mindcraft App   |
                                  |   (browser tab)   |
                                  +-------------------+
```

The bridge server (`apps/vscode-bridge`) is a standalone Hono + Node.js server:

- Runs independently (not bundled with the extension)
- Two WebSocket endpoints: `/app` and `/extension`
- Join code pairing: app gets a three-word code, user enters it in VS Code
- HMAC-signed binding tokens for session persistence across reconnects
- Dockerized for deployment (`Dockerfile` included)
- Rate limiting, connection throttling, graceful shutdown
- Disconnected session cache (5-min TTL) for seamless reconnection

In local development mode, the bridge server runs on localhost. Both the browser
app and VS Code extension connect to it. The extension discovers the bridge via
the `mindcraft.bridgeUrl` configuration setting.

### Remote deployment (supported by architecture)

The bridge server can be deployed to a remote host to support VS Code for Web and
institutional environments. The architecture already supports this since both
clients connect outbound to the bridge. Additional work needed for production
remote deployment:

- WSS (TLS) transport
- Authentication and authorization
- Deployment infrastructure

| Factor             | Local                | Remote                        |
| ------------------ | -------------------- | ----------------------------- |
| Latency            | Sub-millisecond      | 10-100ms typical              |
| Install required   | Bridge server + ext  | Extension only                |
| Works offline      | No (bridge required) | No                            |
| School/IT friendly | Requires bridge      | Nothing to install locally    |
| Security           | All data stays local | Messages transit relay server |
| Reliability        | No server dependency | Depends on relay uptime       |

---

## 18. v1 Scope and Constraints

### What v1 includes

**File system** [done]:

- `mindcraft://` virtual file system provider
- Read, write, stat, directory listing for sensor/actuator/lib source files
- Etag-based optimistic concurrency for conflict detection
- File change notifications bidirectionally through the bridge
- Pending change queue with deduplication and retry on reconnect

**Connection** [done]:

- Bridge server with `/app` and `/extension` WebSocket endpoints
- Join code-based pairing (three-word triplets, refreshed every 10 min)
- HMAC-signed binding tokens for session persistence across reconnects
- Exponential backoff reconnection (500ms-30s)
- Heartbeat with 15s interval
- Session caching for seamless reconnection (5-min TTL)

**Compilation** [done locally; bridge transport planned]:

- Full TypeScript-to-bytecode compilation in the Mindcraft app
- Multi-file compilation with cross-file imports
- Comprehensive diagnostics with source positions and diagnostic codes
- Compilation status tracking

**Debugging** [planned]:

- Inline debug adapter in the extension
- Attach to a single entity's VM
- All fibers exposed as DAP threads with lifecycle events
- VM-level pause (all fibers stop together)
- Line breakpoints with multi-stage resolution (verified, moved, unbound)
- Breakpoint re-resolution on recompile via detach-reattach cycle
- Pause, continue, step over, step into, step out (all safe-point based)
- Stack trace inspection via debug metadata (`pcToSpanIndex` lookup)
- Three scope levels: Locals, Callsite State, Brain Variables
- Variable inspection with DAP handle-based lazy child expansion
- Identifier-only evaluation for hover and watch (no expressions)
- Fault/exception stops with error details
- Async-aware stepping (await suspension reported as `"await"` stop reason)
- Loaded sources reporting
- Canonical stop reasons: breakpoint, pause, step, await, exception, entry

**IntelliSense** [planned]:

- Synthesized `mindcraft.d.ts` for IntelliSense
- Synthesized `tsconfig.json` for TypeScript language service configuration
- Diagnostics pushed to VS Code Problems panel

**Target selection** [planned]:

- Quick-pick target selector in VS Code
- Entity selection from in-game pushes a suggestion to VS Code

### What v1 does not include

| Feature                     | Reason                                           |
| --------------------------- | ------------------------------------------------ |
| Remote bridge with auth     | Requires WSS, authentication, deployment infra   |
| Hot reload of running code  | Requires bytecode replacement in live VM         |
| Multiple debug sessions     | Single-target is sufficient for initial use      |
| Conditional breakpoints     | Requires expression compilation for conditions   |
| Logpoints                   | Requires expression compilation + output channel |
| Function breakpoints        | Requires function name resolution at debug time  |
| Data breakpoints            | Requires memory watchpoints in VM                |
| Arbitrary expression eval   | No expression parser/compiler in v1 debugger     |
| Per-thread resume           | VM pauses/resumes all fibers together            |
| Step back                   | No reverse execution in VM                       |
| Set variable                | Read-only inspection in v1                       |
| Code sharing between brains | Requires cross-brain module system               |
| Collaborative editing       | Requires OT/CRDT infrastructure                  |

### Key v1 simplifications

1. **VM-level pause only.** No per-fiber resume. All fibers stop and resume together.
2. **Single debug target.** One attached VM at a time.
3. **No hot reload.** Recompilation triggers detach-reattach. New code takes effect
   on brain restart or page re-entry.
4. **Identifier-only evaluation.** Hover and watch support simple variable names.
   No arbitrary expressions, no function calls, no side effects.
5. **Single project per session.** Switching projects requires reconnecting.
6. **All faults stop.** No exception filter configuration. Every fault pauses the VM.
7. **Conservative async stepping.** Await suspension is reported as `"await"` rather
   than hidden behind synchronous stepping illusions.
8. **No conditional breakpoints or logpoints.** Requires expression compilation.
9. **Etag-based conflict resolution.** Detects concurrent edits but does not merge.
10. **Pending changes queued on disconnect.** Retried on reconnect, not persisted to
    disk.

### Extension packaging

The VS Code extension package (`apps/vscode-extension`) includes:

- `MindcraftFileSystemProvider` implementation for `mindcraft://`
- File decoration provider for readonly indicators
- Bridge connection manager (WebSocket client via `packages/bridge-client`)
- Status bar with connection state indicators
- "Mindcraft Sessions" tree view with commands
- Join code pairing and binding token persistence
- Pending change queue with deduplication

Planned additions for Phase 2:
- Inline debug adapter (DAP)
- Diagnostics collection for Problems panel
- Synthesized `mindcraft.d.ts` (embedded, updated with extension releases)

The extension activates when:

- A `mindcraft://` URI is opened
- The user runs the "Mindcraft: Connect" command

### Launch configuration

The extension contributes a `mindcraft` debug type. A minimal `launch.json`:

```json
{
  "type": "mindcraft",
  "request": "attach",
  "name": "Debug Mindcraft Entity"
}
```

The extension handles target selection interactively (quick-pick) when no `entityId`
is specified. An explicit target can be provided:

```json
{
  "type": "mindcraft",
  "request": "attach",
  "name": "Debug Wolf",
  "entityId": "e1"
}
```

### Multi-file support

Multi-file compilation is fully implemented. The architecture accommodates multi-file
debugging without structural changes. The debug metadata model supports multiple files.

**File and module identity:**

Each source file has a `DebugFileInfo` with a unique `fileIndex` and a `path`
(e.g., `"sensors/nearby-enemy.ts"`, `"lib/helpers.ts"`). Every
`DebugFunctionInfo` references its source file via `fileIndex`. This is the
file identity used throughout the debugger -- breakpoint resolution, stack
trace display, and loaded sources all key on `fileIndex`.

Each `lib/` module file gets its own `fileIndex` and its functions get their
own `DebugFunctionInfo` entries. No new identity scheme is needed. Multi-file
compilation with cross-file imports is fully implemented.

**Stack traces across files:**

Each `DebugFunctionInfo` carries its own `fileIndex` and `sourceSpan`. The
adapter resolves each stack frame's source location independently via its
function's metadata. A call from `sensors/nearby-enemy.ts` into
`lib/helpers.ts` produces two stack frames with different file references.
VS Code renders cross-file stack traces naturally.

**Breakpoint resolution per file:**

The breakpoint resolution algorithm (section 11) operates per-file. Each file's
`DebugFunctionInfo` entries contain the spans for that file. Adding more files
means more `DebugFunctionInfo` entries to search during resolution but no
algorithm changes.

**Loaded sources:**

The `loadedSources` DAP response enumerates all `DebugFileInfo` entries.
This includes all sensor, actuator, and lib files in the compiled program.
The adapter constructs a `mindcraft://` URI for each file.

No protocol, debug adapter, or metadata structural changes are needed for
multi-file. The multi-file compiler support is already complete (see
`packages/ts-compiler/src/compiler/project.ts` for the `UserTileProject` class
and `collectImports()` function).

---

## 19. Memory and Performance Considerations

### Debug metadata size

Debug metadata scales linearly with program complexity:

| Component           | Size driver                        | Typical size (single file) |
| ------------------- | ---------------------------------- | -------------------------- |
| `DebugFileInfo`     | One per source file                | ~100 bytes                 |
| `DebugFunctionInfo` | One per function                   | ~200 bytes + children      |
| `Span`              | One per statement + sub-expression | ~30 bytes each             |
| `pcToSpanIndex`     | One number per instruction         | ~2-4 bytes per instruction |
| `LocalInfo`         | One per variable declaration       | ~50 bytes each             |
| `ScopeInfo`         | One per lexical scope              | ~40 bytes each             |
| `CallSiteInfo`      | One per call instruction           | ~40 bytes each             |
| `SuspendSiteInfo`   | One per await point                | ~40 bytes each             |

For a typical sensor/actuator with 50-200 bytecode instructions and a handful of
functions, the total debug metadata is 2-10 KB. This is transferred once on attach
and once per recompile.

### Non-debug builds

In non-debug contexts (production, exported worlds without debugger), debug metadata
can be omitted entirely. The compiler should support a flag (e.g.,
`emitDebugMetadata: boolean`) that skips stage 7's debug metadata generation. When
omitted:

- No `DebugMetadata` is stored alongside the program.
- The VM runs without per-instruction breakpoint checks.
- The debug runtime API is not activated.
- Programs are slightly smaller (no metadata overhead).

### Runtime overhead of debug instrumentation

When **not attached**, the VM has zero debug overhead. No per-instruction checks,
no breakpoint tables, no event emission.

When **attached**, the VM checks two conditions at each safe point:

1. Is there a breakpoint at this PC? (hash set lookup, O(1))
2. Is a pause or step pending? (flag check, O(1))

Both checks are O(1) per safe point. Safe points occur at statement boundaries,
so the check frequency scales with statement count, not instruction count. The
total overhead is two constant-time checks per statement executed.

### Transfer strategy

Debug metadata is sent as a single JSON payload in the `debug:attach` response
and in `compile:debugMetadata` events. No streaming, compression, or lazy loading
is needed in v1 given the small sizes involved.

If future phases introduce large programs (many files, many functions), the
metadata could be sent per-file or on-demand (requested when a source file is
opened for debugging). This is a future optimization, not a v1 concern.

---

## 20. End-to-End Example

This walkthrough traces a single user-authored sensor through the entire pipeline:
source -> compilation -> debug metadata -> attach -> breakpoint -> stepping ->
scope inspection -> await -> recompile.

### Source file

```typescript
// sensors/cooldown-check.ts

let lastFireTime = 0;
let fireCount = 0;

function incrementCount(): void {
  fireCount += 1;
}

export default Sensor({
  name: "cooldown-check",
  output: "boolean",
  params: { cooldown: { type: "number", default: 5 } },
  async onExecute(ctx, params): Promise<boolean> {
    const elapsed = ctx.time - lastFireTime;
    if (elapsed < params.cooldown * 1000) {
      return false;
    }
    incrementCount();
    const result = await ctx.queryNearby("enemy", 10);
    lastFireTime = ctx.time;
    return result.length > 0;
  },
});
```

This file has:

- Two top-level persistent variables (`lastFireTime`, `fireCount`)
- One helper function (`incrementCount`)
- One `await` call (`ctx.queryNearby`)

### Compiled program structure

The compiler (stages 1-8) produces a `UserAuthoredProgram` with:

```
Program.functions:
  [0] module-init          (isGenerated: true)
  [1] onExecute            (isGenerated: false, entry point)
  [2] incrementCount       (isGenerated: false, helper)

Program.constants:
  [0] 0        (initial lastFireTime)
  [1] 0        (initial fireCount)
  [2] 1        (increment literal)
  [3] 1000     (cooldown multiplier)
  [4] "enemy"  (query string)
  [5] 10       (query radius)

numCallsiteVars: 2   (lastFireTime at index 0, fireCount at index 1)
```

### Debug metadata

```
DebugMetadata:
  files:
    [0] { fileIndex: 0, path: "sensors/cooldown-check.ts", sourceHash: "a1b2..." }

  functions:
    [0] DebugFunctionInfo:
          debugFunctionId: "sensors/cooldown-check.ts::module-init"
          compiledFuncId: 0
          fileIndex: 0
          prettyName: "(module init)"
          isGenerated: true
          spans: [
            { spanId: 0, startLine: 3, ..., isStatementBoundary: true },  -- lastFireTime = 0
            { spanId: 1, startLine: 4, ..., isStatementBoundary: true },  -- fireCount = 0
          ]
          scopes: [
            { scopeId: 0, kind: "function", parentScopeId: null, ... },
            { scopeId: 1, kind: "module", parentScopeId: null, ... },
          ]

    [1] DebugFunctionInfo:
          debugFunctionId: "sensors/cooldown-check.ts::onExecute"
          compiledFuncId: 1
          fileIndex: 0
          prettyName: "onExecute"
          isGenerated: false
          spans: [
            { spanId: 0, startLine: 14, ..., isStatementBoundary: true },  -- const elapsed = ...
            { spanId: 1, startLine: 15, ..., isStatementBoundary: true },  -- if (elapsed < ...)
            { spanId: 2, startLine: 16, ..., isStatementBoundary: true },  -- return false
            { spanId: 3, startLine: 18, ..., isStatementBoundary: true },  -- incrementCount()
            { spanId: 4, startLine: 19, ..., isStatementBoundary: true },  -- const result = await ...
            { spanId: 5, startLine: 20, ..., isStatementBoundary: true },  -- lastFireTime = ctx.time
            { spanId: 6, startLine: 21, ..., isStatementBoundary: true },  -- return result.length > 0
          ]
          locals: [
            { name: "ctx", slotIndex: 0, storageKind: "parameter", ... },
            { name: "params", slotIndex: 1, storageKind: "parameter", ... },
            { name: "elapsed", slotIndex: 2, storageKind: "local",
              lifetimeStartPc: 4, lifetimeEndPc: 30, ... },
            { name: "result", slotIndex: 3, storageKind: "local",
              lifetimeStartPc: 18, lifetimeEndPc: 30, ... },
          ]
          scopes: [
            { scopeId: 0, kind: "function", ... },
            { scopeId: 1, kind: "module", ... },
            { scopeId: 2, kind: "brain", ... },
          ]
          suspendSites: [
            { awaitPc: 16, resumePc: 17, sourceSpan: { startLine: 19, ... } },
          ]
          callSites: [
            { pc: 12, callSiteId: null, targetDebugFunctionId:
              "sensors/cooldown-check.ts::incrementCount", isAsync: false },
            { pc: 14, callSiteId: null, targetDebugFunctionId: null,
              isAsync: true },  -- HOST_CALL_ASYNC (ctx.queryNearby)
          ]

    [2] DebugFunctionInfo:
          debugFunctionId: "sensors/cooldown-check.ts::incrementCount"
          compiledFuncId: 2
          fileIndex: 0
          prettyName: "incrementCount"
          isGenerated: false
          spans: [
            { spanId: 0, startLine: 7, ..., isStatementBoundary: true },  -- fireCount += 1
          ]
          scopes: [
            { scopeId: 0, kind: "function", ... },
            { scopeId: 1, kind: "module", ... },
            { scopeId: 2, kind: "brain", ... },
          ]
```

### Attach and breakpoint placement

1. User launches debug session, selects entity "Wolf".
2. Adapter sends `debug:attach { entityId: "e1" }`.
3. Response includes `programRevisionId: "rev-1"`, debug metadata above,
   and current fibers.
4. User sets breakpoint at **line 18** (`incrementCount()`).

Breakpoint resolution:

- Stage 1: find span in non-generated function with `startLine == 18`.
  Matches `onExecute` span 3 (`spanId: 3`, `startLine: 18`).
- Result: **verified** at `onExecute` span 3's PC.

### Stepping walkthrough

The rule fiber evaluates `cooldown-check` via synchronous dispatch.
The caller's HOST_CALL pushes `onExecute` as a frame on the same thread.

**Stop 1: Breakpoint at line 18**

The fiber reaches the safe point for `incrementCount()`. The breakpoint
fires.

```
DAP stopped { reason: "breakpoint", threadId: 1 }
```

Stack trace:

```
Frame 0: onExecute         line 18   (sensors/cooldown-check.ts)
Frame 1: (rule dispatch)   ...       (brain rule -- dimmed if generated)
```

Scopes for Frame 0 (`onExecute`):

```
Locals:
  ctx       = <Handle: ...>
  params    = { cooldown: 5 }
  elapsed   = 12500.0

Callsite State:
  lastFireTime = 0
  fireCount    = 0

Brain Variables:
  health    = 80
  speed     = 3.5
```

All three scopes are visible. `elapsed` is in scope (its `lifetimeStartPc`
has been reached). `result` is not yet visible (declared after line 18).

**Step into (line 18 -> line 7)**

User presses step-into. The CALL instruction at PC 12 targets
`incrementCount` (`targetDebugFunctionId` is non-null, `isGenerated` is
false). Execution enters `incrementCount` and pauses at its first safe point.

```
DAP stopped { reason: "step", threadId: 1 }
```

Stack trace:

```
Frame 0: incrementCount    line 7    (sensors/cooldown-check.ts)
Frame 1: onExecute         line 18   (sensors/cooldown-check.ts)
Frame 2: (rule dispatch)   ...
```

Scopes for Frame 0 (`incrementCount`):

```
Locals:
  (none -- incrementCount has no parameters or locals)

Callsite State:
  lastFireTime = 0
  fireCount    = 0

Brain Variables:
  health    = 80
  speed     = 3.5
```

The helper frame sees Callsite State because `incrementCount` is defined in
the same authored module. The `callsiteVars` are resolved via the entry-point
callsite ID, shared across the call tree.

**Step over (line 7 -> return to line 19)**

User presses step-over. `fireCount += 1` executes (`LOAD_CALLSITE_VAR 1`,
push 1, add, `STORE_CALLSITE_VAR 1`). The function returns, and the step
completes in `onExecute` at the next statement (line 19).

```
DAP stopped { reason: "step", threadId: 1 }
```

Scopes for Frame 0 (`onExecute`) at line 19:

```
Callsite State:
  lastFireTime = 0
  fireCount    = 1       <-- updated by incrementCount
```

**Step over (line 19 -> await suspension)**

User presses step-over at line 19 (`const result = await ctx.queryNearby(...)`).
The HOST_CALL_ASYNC creates a handle. The AWAIT instruction finds the handle
PENDING. The fiber suspends.

```
DAP stopped { reason: "await", threadId: 1 }
```

The fiber is now in `WAITING` state. The stack trace still shows the frame
at line 19 (the await expression). All scopes remain inspectable. `result`
is not yet visible (the await has not completed).

**Resume after handle resolves**

The handle resolves with `[{ id: "enemy-1" }]`. The scheduler resumes the
fiber. The VM re-pauses at the resume PC (the safe point after the AWAIT).

```
DAP stopped { reason: "step", threadId: 1 }
```

Scopes for Frame 0 (`onExecute`) at line 20:

```
Locals:
  ctx       = <Handle: ...>
  params    = { cooldown: 5 }
  elapsed   = 12500.0
  result    = [{ id: "enemy-1" }]   <-- now visible

Callsite State:
  lastFireTime = 0
  fireCount    = 1
```

`result` is now in scope (its `lifetimeStartPc` has been reached after the
AWAIT pushed the resolved value).

### Recompile during session

The user edits line 18, changing `incrementCount()` to `fireCount += 2`, and
saves. The app recompiles:

1. Compilation succeeds. New `programRevisionId: "rev-2"`.
2. Adapter detaches the current session (DAP `terminated`).
3. Adapter re-attaches with new debug metadata.
4. The breakpoint originally at line 18 is re-resolved using the **original
   requested line** (18). The new metadata still has a span at line 18
   (`fireCount += 2`). Breakpoint is **verified** at the new PC.
5. The VM restarts rule fibers from entry points using the new bytecode.
   `callsiteVars` are re-initialized by the module init function.
   Brain variables retain their values.
6. Execution continues with the new program. The user sees their updated code.

---

## Acknowledgements: Key Source Files for Phase 2 Implementation

This document describes the integration points between the debugger and existing
Mindcraft infrastructure. Implementation should reference the following files:

**Compiler and Type System:**
- `packages/ts-compiler/src/compiler/compile.ts` -- Main compilation entry point
- `packages/ts-compiler/src/compiler/project.ts` -- Multi-file project orchestration
- `packages/ts-compiler/src/compiler/lowering.ts` -- TS AST to IR lowering (scope/variable info)
- `packages/ts-compiler/src/compiler/emit.ts` -- Bytecode emission (extend for debug metadata)
- `packages/ts-compiler/src/compiler/ir.ts` -- IR node type definitions (~40 kinds)
- `packages/ts-compiler/src/compiler/types.ts` -- `UserAuthoredProgram`, `ExtractedDescriptor`
- `packages/ts-compiler/src/compiler/descriptor.ts` -- Tile metadata extraction
- `packages/ts-compiler/src/compiler/scope.ts` -- Variable scope tracking
- `packages/ts-compiler/src/compiler/diag-codes.ts` -- Diagnostic code system
- `packages/ts-compiler/src/compiler/linker/linker.ts` -- User program linking
- `packages/ts-compiler/src/index.ts` -- Public API

**VM and Fiber Execution:**
- `packages/core/src/brain/runtime/vm.ts` -- Stack-based VM, instruction execution
- `packages/core/src/brain/runtime/fiber-scheduler.ts` -- Fiber queue and scheduling
- `packages/core/src/brain/interfaces/vm.ts` -- Public VM interfaces (Op, Frame, Fiber,
  FiberState, ErrorValue, VmConfig)
- `packages/core/src/brain/runtime/brain.ts` -- Brain orchestration (handles page, rule exec)

**Type Definitions:**
- `packages/core/src/brain/interfaces/program.ts` -- `Program`, `FunctionBytecode` types
  (extend with `DebugMetadata` field)

**User-Authored Tile Integration:**
- `packages/ts-compiler/src/runtime/authored-function.ts` -- User tile execution wrapper
- `packages/ts-compiler/src/runtime/registration-bridge.ts` -- Tile registration

**Bridge Infrastructure:**
- `apps/vscode-bridge/src/` -- Bridge server (Hono + Node.js WebSocket relay)
- `packages/bridge-protocol/src/` -- Shared message types and Zod schemas
- `packages/bridge-client/src/` -- Client SDK (WsClient, ProjectSession, Project)
- `packages/bridge-app/src/` -- App-side bridge integration

**VS Code Extension:**
- `apps/vscode-extension/src/extension.ts` -- Extension activation
- `apps/vscode-extension/src/services/project-manager.ts` -- Central state manager
- `apps/vscode-extension/src/services/mindcraft-fs-provider.ts` -- FileSystemProvider

**Supporting Documentation:**
- `docs/specs/features/user-authored-sensors-actuators.md` -- Compilation design
- `.github/instructions/global.instructions.md` -- Code style guidelines
- `.github/instructions/vscode-bridge.instructions.md` -- Bridge server conventions
