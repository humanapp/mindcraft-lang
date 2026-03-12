---
applyTo: "packages/core/src/brain/**"
---

<!-- Last reviewed: 2026-03-12 -->

# Brain Language -- Rules & Patterns

The brain module (`packages/core/src/brain/`) implements a tile-based visual programming
language with a Pratt parser, bytecode compiler, and stack-based VM. Read the source for
architecture details; this file captures rules and patterns for making changes.

## Pipeline

```
Tiles -> Parser (Pratt + grammar) -> AST (Expr) -> Type Inference -> Bytecode Compiler -> Program -> VM (fiber-based)
```

## Key Conventions

- Tile IDs follow the pattern `tile.<area>-><id>`, built via `mkTileId(area, id)`
- Call spec grammar helpers: `mod()`, `param()`, `bag()`, `choice()`, `seq()`, `optional()`, `repeated()`, `conditional()` from `interfaces/call-spec.ts`
- `mkCallDef(callSpec)` flattens specs into `BrainActionArgSlot[]` keyed by `slotId`
- **Inline sensors** must use an empty call spec -- arguments would create grammar ambiguities with the Pratt parser
- All operators are implemented as HOST_CALLs
- Runtime values are tagged unions with `.t: NativeType`; use singletons (`NIL_VALUE`, `TRUE_VALUE`, etc.) and builders (`mkNumberValue`, etc.)
- **Runtime registration happens BEFORE tile registration.** `registerCoreRuntimeComponents()` runs first; tile defs then look up `fnEntry` from the function registry
- VM runtime details are in `vm.instructions.md` (loaded only for `runtime/` files)

## Adding New Sensors / Actuators

Follow the existing pattern (3 files + 2 wiring changes):

1. **Runtime function** (e.g., `runtime/sensors/my-sensor.ts`): Define `callSpec`, `callDef`, host function, export descriptor `{ fnId, tileId, isAsync, fn, callDef }`
2. **Register runtime function** in `runtime/sensors/index.ts` (or `runtime/actuators/index.ts`): `fns.register(id, isAsync, fn, callDef)`
3. **Register tile def** in `tiles/sensors.ts` (or `tiles/actuators.ts`): Create `BrainTileSensorDef` / `BrainTileActuatorDef`, pass `fnEntry` from function registry
4. **Add ID** to `CoreSensorId` / `CoreActuatorId` enum in `interfaces/tiles.ts`

For **inline sensors** (no arguments, participate in Pratt expressions): set `placement: TilePlacement.EitherSide | TilePlacement.Inline` and use an empty call spec.

## Adding New Operators

1. Add operator ID to the `CoreOpId` const object in `interfaces/operators.ts`
2. Register operator spec in `runtime/operators.ts` (precedence, fixity, associativity)
3. Register overloads for type combinations (each overload is a HOST_CALL)
4. Register operator tile def in `tiles/operators.ts`

## Serialization

Both binary and JSON formats use distributed ownership -- each entity owns its own
`serialize`/`deserialize` and `toJson`/`fromJson` methods. Key rules:

- Each entity declares a file-level `const kVersion` shared by both formats; bump the single constant to advance both
- JSON schema interfaces are co-located in the same file as the producing class (not separate type files)
- Serialization delegates downward: `BrainDef -> TileCatalog -> [tile defs]` and `BrainDef -> BrainPageDef -> BrainRuleDef -> BrainTileSet`
