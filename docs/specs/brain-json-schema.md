# BrainJson Schema

JSON schema for the BrainJson serialization format. This is the canonical reference for
the data structure produced by `BrainDef.toJson()` and consumed by `BrainDef.fromJson()`
/ `brainJsonFromPlain()`.

Source types are defined in `packages/core/src/brain/model/` and
`packages/core/src/brain/tiles/`.

---

## Root: BrainJson

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://mindcraft-lang/schemas/brain-json.schema.json",
  "title": "BrainJson",
  "description": "Serialized representation of a brain definition (tile-based visual program).",
  "type": "object",
  "required": ["version", "name", "catalog", "pages"],
  "additionalProperties": false,
  "properties": {
    "version": {
      "type": "integer",
      "const": 1,
      "description": "Schema version. Currently always 1."
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100,
      "description": "Display name of the brain."
    },
    "catalog": {
      "type": "array",
      "description": "Tile catalog -- all persistent tile definitions (literals, variables, page refs, missing placeholders). Operators, sensors, actuators, modifiers, and parameters are NOT stored here; they are referenced by global tile ID in rule arrays.",
      "items": {
        "$ref": "#/$defs/CatalogTileJson"
      }
    },
    "pages": {
      "type": "array",
      "description": "Ordered list of pages. Each page contains an ordered list of rules.",
      "items": {
        "$ref": "#/$defs/PageJson"
      }
    }
  },

  "$defs": {
    "CatalogTileJson": {
      "description": "Discriminated union of tile types that live in the catalog. The `kind` field determines the variant.",
      "oneOf": [
        { "$ref": "#/$defs/LiteralTileJson" },
        { "$ref": "#/$defs/VariableTileJson" },
        { "$ref": "#/$defs/PageTileJson" },
        { "$ref": "#/$defs/MissingTileJson" }
      ],
      "discriminator": {
        "propertyName": "kind"
      }
    },

    "LiteralTileJson": {
      "type": "object",
      "description": "A constant value tile (number, string, boolean, nil, or app-defined type).",
      "required": ["version", "kind", "tileId", "valueType", "value", "valueLabel", "displayFormat"],
      "additionalProperties": false,
      "properties": {
        "version": {
          "type": "integer",
          "const": 2,
          "description": "Tile version. Currently always 2."
        },
        "kind": {
          "type": "string",
          "const": "literal"
        },
        "tileId": {
          "type": "string",
          "description": "Unique tile identifier. Format: tile.literal-><valueType>-><valueStr> with an optional [displayFormat] suffix.",
          "pattern": "^tile\\.literal->.+"
        },
        "valueType": {
          "$ref": "#/$defs/TypeId",
          "description": "Type identifier for this literal's value."
        },
        "value": {
          "description": "The literal value. Type depends on valueType: number for number:<number>, string for string:<string>, boolean for boolean:<boolean>, null for nil:<nil>."
        },
        "valueLabel": {
          "type": "string",
          "description": "Human-readable display label for the value."
        },
        "displayFormat": {
          "type": "string",
          "description": "Display formatting hint.",
          "examples": ["default", "percent", "thousands", "time_seconds", "time_ms"]
        }
      }
    },

    "VariableTileJson": {
      "type": "object",
      "description": "A named mutable storage tile.",
      "required": ["version", "kind", "tileId", "varName", "varType", "uniqueId"],
      "additionalProperties": false,
      "properties": {
        "version": {
          "type": "integer",
          "const": 1,
          "description": "Tile version. Currently always 1."
        },
        "kind": {
          "type": "string",
          "const": "variable"
        },
        "tileId": {
          "type": "string",
          "description": "Unique tile identifier. Format: tile.var-><uniqueId>.",
          "pattern": "^tile\\.var->.+"
        },
        "varName": {
          "type": "string",
          "description": "User-visible variable name."
        },
        "varType": {
          "$ref": "#/$defs/TypeId",
          "description": "Type identifier for this variable's value."
        },
        "uniqueId": {
          "type": "string",
          "description": "Stable unique identifier for this variable. Used to construct the tileId (tile.var-><uniqueId>)."
        }
      }
    },

    "PageTileJson": {
      "type": "object",
      "description": "A tile referencing a brain page (used in switch-page actuator arguments).",
      "required": ["version", "kind", "tileId", "pageId"],
      "additionalProperties": false,
      "properties": {
        "version": {
          "type": "integer",
          "const": 2,
          "description": "Tile version. Currently always 2."
        },
        "kind": {
          "type": "string",
          "const": "page"
        },
        "tileId": {
          "type": "string",
          "description": "Unique tile identifier. Format: tile.page-><pageId>.",
          "pattern": "^tile\\.page->.+"
        },
        "pageId": {
          "type": "string",
          "description": "Stable page UUID that this tile references."
        },
        "label": {
          "type": "string",
          "description": "Non-authoritative display label. When the pageId matches a living page, the page's current name takes precedence."
        }
      }
    },

    "MissingTileJson": {
      "type": "object",
      "description": "A placeholder tile for a reference that could not be resolved (e.g., after paste from another brain).",
      "required": ["version", "kind", "tileId", "originalKind", "label"],
      "additionalProperties": false,
      "properties": {
        "version": {
          "type": "integer",
          "const": 1,
          "description": "Tile version. Currently always 1."
        },
        "kind": {
          "type": "string",
          "const": "missing"
        },
        "tileId": {
          "type": "string",
          "description": "Original tile identifier that could not be resolved."
        },
        "originalKind": {
          "type": "string",
          "description": "The tile's original kind before it went missing.",
          "enum": [
            "literal",
            "variable",
            "page",
            "sensor",
            "actuator",
            "operator",
            "parameter",
            "modifier",
            "controlFlow",
            "factory",
            "accessor"
          ]
        },
        "label": {
          "type": "string",
          "description": "Display label for the missing tile."
        }
      }
    },

    "PageJson": {
      "type": "object",
      "description": "A single page in the brain. Pages are the top-level organizational unit; execution starts on the first page.",
      "required": ["version", "pageId", "name", "rules"],
      "additionalProperties": false,
      "properties": {
        "version": {
          "type": "integer",
          "const": 2,
          "description": "Page version. Currently always 2."
        },
        "pageId": {
          "type": "string",
          "description": "Stable unique page identifier (UUID)."
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100,
          "description": "Display name of the page."
        },
        "rules": {
          "type": "array",
          "description": "Ordered list of rules on this page.",
          "items": {
            "$ref": "#/$defs/RuleJson"
          }
        }
      }
    },

    "RuleJson": {
      "type": "object",
      "description": "A single rule. Each rule has a WHEN side (condition) and a DO side (action). Rules can nest via `children` -- child rules only execute when their parent's WHEN condition is true.",
      "required": ["version", "when", "do", "children"],
      "additionalProperties": false,
      "properties": {
        "version": {
          "type": "integer",
          "const": 1,
          "description": "Rule version. Currently always 1."
        },
        "when": {
          "type": "array",
          "description": "Ordered list of tile IDs forming the WHEN (condition) expression. Tile IDs reference either catalog entries (literals, variables, pages) or global tile definitions (operators, sensors, actuators, modifiers, parameters, control flow).",
          "items": {
            "$ref": "#/$defs/TileId"
          }
        },
        "do": {
          "type": "array",
          "description": "Ordered list of tile IDs forming the DO (action) expression.",
          "items": {
            "$ref": "#/$defs/TileId"
          }
        },
        "children": {
          "type": "array",
          "description": "Nested child rules. Children execute only when this rule's WHEN condition is true.",
          "items": {
            "$ref": "#/$defs/RuleJson"
          }
        }
      }
    },

    "TileId": {
      "type": "string",
      "description": "A tile identifier. All tile IDs follow the pattern `tile.<area>-><id>`. Catalog tiles use area prefixes `literal`, `var`, `page`. Global tiles use prefixes like `op`, `sensor`, `actuator`, `modifier`, `param`, `cf`.",
      "pattern": "^tile\\..+->.+",
      "examples": [
        "tile.op->add",
        "tile.op->subtract",
        "tile.op->equals",
        "tile.op->not-equals",
        "tile.op->less-than",
        "tile.op->greater-than",
        "tile.op->and",
        "tile.op->or",
        "tile.op->not",
        "tile.sensor->see",
        "tile.sensor->random",
        "tile.actuator->move",
        "tile.actuator->switch-page",
        "tile.actuator->say",
        "tile.literal->number:<number>->42",
        "tile.var->some-unique-id",
        "tile.page->some-page-uuid"
      ]
    },

    "TypeId": {
      "type": "string",
      "description": "A type identifier. Format: `<nativeType>:<typeName>`. Core types: number:<number>, string:<string>, boolean:<boolean>, nil:<nil>, void:<void>, unknown:<unknown>.",
      "pattern": "^[a-z]+:<.+>$",
      "examples": [
        "number:<number>",
        "string:<string>",
        "boolean:<boolean>",
        "nil:<nil>",
        "void:<void>",
        "unknown:<unknown>"
      ]
    }
  }
}
```
