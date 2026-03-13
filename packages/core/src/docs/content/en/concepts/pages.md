# Pages and Navigation

A brain is organized into **pages**. Each page contains its own set of rules.
Only one page is active at a time.

## Switching Pages

Use `tile:tile.actuator->switch-page` on the DO side to navigate to a different page.
The current page stops executing and the new page begins on the next frame.

## Restarting the current page

If `tile:tile.sensor->current-page` is passed in, execution of the current page will be interrupted and will restart from the top on the next frame. This can be useful for conditionally skipping execution of rules below the current one.

## Previous Page

The `tile:tile.sensor->previous-page` sensor returns the Page ID of the page that was
active before the most recent page switch. If no switch has occurred, it returns the
current page. Use it to navigate back to the page you came from.

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
