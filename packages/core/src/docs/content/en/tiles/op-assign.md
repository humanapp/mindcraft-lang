```brain noframe do
{
  "tileId": "tile.op->assign",
  "catalog": []
}
```

# Gets

Assigns a value a variable.

---

Place the variable on the left, the `tile:tile.op->assign` in the middle, and the value on the right.

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [
        "tile.sensor->sensor.timeout"
      ],
      "do": [
        "tile.var->ibWFtpaeKzpyyB6b",
        "tile.op->assign",
        "tile.var->ibWFtpaeKzpyyB6b",
        "tile.op->sub",
        "tile.literal->number:<number>->1"
      ],
      "children": [],
      "comment": "Once per second, subtract `1` from `countdown`."
    }
  ],
  "catalog": [
    {
      "version": 1,
      "kind": "variable",
      "tileId": "tile.var->ibWFtpaeKzpyyB6b",
      "varName": "countdown",
      "varType": "number:<number>",
      "uniqueId": "ibWFtpaeKzpyyB6b"
    },
    {
      "version": 2,
      "kind": "literal",
      "tileId": "tile.literal->number:<number>->1",
      "valueType": "number:<number>",
      "value": 1,
      "valueLabel": "1",
      "displayFormat": "default"
    }
  ]
}
```

The `tile:tile.op->assign` operator works with all variable types -- numbers, booleans, strings, even custom types defined by the application.

## See Also

`tile:tile.op->eq`
`tile:tile.op->ne`
