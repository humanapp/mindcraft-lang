```brain noframe when
{
  "tileId": "tile.sensor->current-page",
  "catalog": []
}
```

# Current Page

Returns the Page ID of the currently executing brain page.

---

Use on either side of a rule wherever you would use a page tile, but want it to resolve dynamically to whichever page is currently executing. For example, pass it to `tile:tile.actuator->switch-page` to restart the current page, or compare it against a page tile to check which page is active.

## Example

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [],
      "do": [
        "tile.actuator->switch-page",
        "tile.sensor->current-page"
      ],
      "children": []
    }
  ],
  "catalog": []
}
```

_Restart execution of the current page._

## See Also

`tile:tile.actuator->switch-page`
`tile:tile.sensor->on-page-entered`
