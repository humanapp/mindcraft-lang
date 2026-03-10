```brain noframe do
{
  "tileId": "tile.actuator->switch-page",
  "catalog": []
}
```

# Switch Page

Switches brain execution to a different page.

---

Place on the **DO** side to navigate to another page when a rule fires. The brain stops evaluating the current page and begins the new page on the next frame. Pass a page tile to go to a specific page, or pass the `tile:tile.sensor->current-page` tile to restart execution of the current page.

## Examples

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [],
      "do": [
        "tile.actuator->switch-page",
        "tile.page->1KQvjJVmrZZ2BqOd"
      ],
      "children": []
    }
  ],
  "catalog": [
    {
      "version": 2,
      "kind": "page",
      "tileId": "tile.page->1KQvjJVmrZZ2BqOd",
      "pageId": "1KQvjJVmrZZ2BqOd",
      "label": "Hunt"
    }
  ]
}
```

_Switch execution to the 'Hunt' page._

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

## Parameters & Modifiers

| Parameter | Type | Description |
|-----------|------|-------------|
| (anonymous) | `Page`, `String`, or `Number` | A page tile, the page's string name, or its 1-based numeric index. Use `tile:tile.sensor->current-page` to restart the current page. |

## See Also

`tile:tile.sensor->current-page`
`tile:tile.sensor->on-page-entered`
