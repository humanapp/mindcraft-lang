# @mindcraft-lang/core

The core implementation of the **Mindcraft** programming language -- a tile-based visual language designed for creating behaviors in interactive worlds.

## The Mindcraft Language

Mindcraft is a visual programming language where programs are built by arranging **tiles** -- typed, composable tokens -- into rules. Each rule has a **WHEN** side (conditions) and a **DO** side (actions), making behavior logic readable at a glance.

A Mindcraft program is called a **brain**. A brain contains **pages** of rules, and actors in a simulation each run their own brain instance. This makes it natural to express autonomous agent behaviors: "WHEN I see food, DO move toward it."

### What makes it interesting

- **Tile-based grammar** -- Programs are sequences of typed tiles rather than text. Tiles include literals, variables, operators, sensors (read the world), actuators (act on the world), and control flow. The tile system defines its own grammar using composable call specs (bags, choices, sequences, optionals, conditionals) that control which tiles can appear where.

- **Full compilation pipeline** -- Tile sequences are parsed by a Pratt parser into an AST, type-checked with bidirectional type inference, compiled to bytecode, and executed on a stack-based VM with fiber-based concurrency.

- **Extensible type system** -- Host applications register custom types, sensors, and actuators. The language's type system, operator overloads, and implicit conversions all extend to cover app-specific types.

- **Multi-target runtime** -- The same TypeScript source compiles to Roblox (Luau), Node.js, and browser (ESM) targets. A single codebase runs identically across all three environments.

### Core Package Layout

```
src/
  primitives/     Low-level utilities (FourCC) with zero dependencies
  platform/       Cross-platform abstractions (List, Dict, Stream, Error, StringUtils, etc.)
  util/           Higher-level utilities (EventEmitter, OpResult, BitSet, MTree)
  systems/        Service-level abstractions (Signal, Clock, Translator)
  brain/          The language implementation
    interfaces/   Type definitions and contracts (brain structures, tiles, type system, catalog)
    model/        Data model (Brain, Page, Rule, TileSet)
    compiler/     Pratt parser, AST types, type inference, bytecode compiler
    tiles/        Tile implementations (operators, sensors, actuators, control flow, variables, literals)
    runtime/      Stack-based VM, fiber scheduler, function registry, operator dispatch
    language-service/  Editor services (tile suggestions)
```

Layers follow a strict bottom-up dependency hierarchy: `primitives -> platform -> util -> systems -> brain`. This is enforced because the Luau target does not tolerate circular imports.

## Getting Started

### Prerequisites

- Node.js (latest LTS)
- npm

### Install

From the monorepo root:

```bash
npm install
```

### Build

From `packages/core/`:

```bash
npm run build          # All targets (Roblox, Node.js, ESM)
npm run build:node     # Node.js/CommonJS only
npm run build:esm      # ES Modules only
npm run build:rbx      # Roblox/Luau only
npm run watch:rbx      # Watch mode for Roblox development
npm run clean          # Remove build artifacts
```

Each target build has three steps: TypeScript compilation, platform file resolution (copies `.node.ts` or `.rbx.ts` implementations over the ambient `.ts` declarations), and post-processing.

### Test

```bash
npm test
```

Tests use `node:test` and `node:assert/strict`, run via `tsx`. A `pretest` step builds the Node target first because spec files use package imports (`@mindcraft-lang/core/brain/compiler`, etc.) that resolve against `dist/node/`.

## Development Guide

### Platform Abstraction Pattern

Shared code must avoid Node-only or browser-only APIs. Several modules in `platform/` use a three-file pattern:

- `module.ts` -- `declare` types only (ambient)
- `module.node.ts` -- JavaScript implementation
- `module.rbx.ts` -- Luau implementation

Build scripts copy the right platform file over the generic one per target.

### Conventions

- **Use `List` and `Dict`** from `platform/` instead of native `Array` and `Map`
- **Use `unknown`** instead of `any` (required for Roblox compatibility)
- **Use `Error` from `platform/error`** instead of the global `Error` class
- **Use `TypeUtils.isString()`** etc. instead of `typeof x === "string"`
- **Avoid Luau reserved words** as identifiers (`and`, `end`, `not`, `repeat`, `then`, `nil`, etc.)
- **No `globalThis`** in shared code (allowed in `.node.ts` files only)

### Import Rules

| Layer | Can import from |
|-------|----------------|
| `primitives/` | Nothing |
| `platform/` | `primitives` |
| `util/` | `platform`, `primitives` |
| `systems/` | `util`, `platform`, `primitives` |
| `brain/` | All lower layers |

Breaking these rules creates circular dependencies that fail the Roblox build.

### Adding a Platform Abstraction

1. Create `platform/module.ts` with `declare` types
2. Create `platform/module.node.ts` with the JavaScript implementation
3. Create `platform/module.rbx.ts` with the Luau implementation
4. Add to platform mappings in all three post-build scripts
5. Export from `platform/index.ts`

### Adding Tests

Tests are colocated as `*.spec.ts` files next to the code they test.

1. Create `<module>.spec.ts` beside the source file
2. Import from package exports (`@mindcraft-lang/core/brain/compiler`), not relative paths
3. Use `describe`/`it` from `node:test` and `assert` from `node:assert/strict`
4. `npm test` picks up new files automatically via the glob `src/**/*.spec.ts`

### Package Exports

```typescript
import { List } from "@mindcraft-lang/core/platform";
import { fourCC } from "@mindcraft-lang/core/primitives";
import * as brainModel from "@mindcraft-lang/core/brain/model";
import * as brainTiles from "@mindcraft-lang/core/brain/tiles";
import * as brainCompiler from "@mindcraft-lang/core/brain/compiler";
import * as brainRuntime from "@mindcraft-lang/core/brain/runtime";
```

## Where to Start Reading

- **Brain architecture** -- [brain/index.ts](src/brain/index.ts), then [brain/interfaces/brain.ts](src/brain/interfaces/brain.ts) for the `IBrainDef` contract
- **Tile definitions** -- [brain/interfaces/tiles.ts](src/brain/interfaces/tiles.ts) for `IBrainTileDef` and call specs, [brain/tiles/](src/brain/tiles/) for concrete implementations
- **Parser/compiler** -- [brain/compiler/parser.ts](src/brain/compiler/parser.ts) (Pratt parser), [brain/compiler/types.ts](src/brain/compiler/types.ts) (AST), [brain/compiler/rule-compiler.ts](src/brain/compiler/rule-compiler.ts) (bytecode emitter)
- **Runtime** -- [brain/runtime/vm.ts](src/brain/runtime/vm.ts) (bytecode VM), [brain/runtime/brain.ts](src/brain/runtime/brain.ts) (brain execution)
- **Platform abstractions** -- [platform/index.ts](src/platform/index.ts) for `List`/`Dict`, then `stream.ts`, `error.ts`, `string.ts`
