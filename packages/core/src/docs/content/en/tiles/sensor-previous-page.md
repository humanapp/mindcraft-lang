```brain noframe do
{
  "tileId": "tile.sensor->previous-page",
  "catalog": []
}
```

# Previous Page

Returns the `Page ID` of the page that was active before switching to the current page.

---

Use on either side of a rule wherever you would use a page tile, but want it to resolve dynamically to whichever page was previously active. If no page switch has occurred yet (e.g., the brain just started), this returns the current page.

## Example

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [],
      "do": [
        "tile.actuator->switch-page",
        "tile.sensor->previous-page"
      ],
      "children": [],
      "comment": "Switch back to the page we came from."
    }
  ],
  "catalog": []
}
```

## See Also

`tile:tile.sensor->current-page`
`tile:tile.actuator->switch-page`
`tile:tile.sensor->on-page-entered`
