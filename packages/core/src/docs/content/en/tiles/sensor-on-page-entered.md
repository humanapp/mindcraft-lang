```brain noframe when
{
  "tileId": "tile.sensor->on-page-entered",
  "catalog": []
}
```

# On Page Entered

Fires once when the brain first enters the current page.

---

Use on the WHEN side to run initialization logic when switching to a new page.
This sensor produces true only on the first frame after page entry, then false on subsequent frames.

## See Also

`tile:tile.actuator->switch-page`
`tile:tile.sensor->current-page`
`tile:tile.sensor->sensor.timeout`
