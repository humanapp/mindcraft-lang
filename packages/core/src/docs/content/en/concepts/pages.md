# Pages and Navigation

A brain is organized into **pages**. Each page contains its own set of rules.
Only one page is active at a time.

## Switching Pages

Use `tile:tile.actuator->switch-page` on the DO side to navigate to a different page.
The current page stops evaluating and the new page begins on the next frame.

Use `tile:tile.actuator->restart-page` to restart the current page from scratch,
resetting any timers or state that depend on page entry.

## On Page Entered

The `tile:tile.sensor->on-page-entered` sensor fires once on the first frame after
entering a page. Use it to run setup logic when arriving on a new page.

## When to Use Pages

Pages are useful for organizing distinct behavioral states:

- A "forage" page with rules for finding and eating food
- A "flee" page with rules for escaping predators
- An "idle" page with wandering and resting behavior

Switch between pages based on environmental conditions to create complex behavior
from simple per-page rules.
