```brain noframe when
{
  "tileId": "tile.sensor->random",
  "catalog": []
}
```

# Random

Produces a random number between 0 and 1.

---

Use on either side of a rule to inject randomness into behavior.
Combine with comparison operators to create probabilistic conditions.

## Examples

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [
        "tile.sensor->random",
        "tile.op->gt",
        "tile.literal->number:<number>->0.5[percent]"
      ],
      "do": [
      ],
      "children": []
    }
  ],
  "catalog": [
    {
      "version": 2,
      "kind": "literal",
      "tileId": "tile.literal->number:<number>->0.5[percent]",
      "valueType": "number:<number>",
      "value": 0.5,
      "valueLabel": "0.5",
      "displayFormat": "percent"
    }
  ]
}
```

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [],
      "do": [
        "tile.var->PUztoo66YJfI6Mgr",
        "tile.op->assign",
        "tile.sensor->random"
      ],
      "children": []
    }
  ],
  "catalog": [
    {
      "version": 1,
      "kind": "variable",
      "tileId": "tile.var->PUztoo66YJfI6Mgr",
      "varName": "$value",
      "varType": "number:<number>",
      "uniqueId": "PUztoo66YJfI6Mgr"
    }
  ]
}
```

## See Also

`tile:tile.op->gt`
`tile:tile.op->lt`
`tile:tile.op->eq`
