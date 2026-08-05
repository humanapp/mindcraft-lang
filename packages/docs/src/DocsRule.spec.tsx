/**
 * Pins that the chips documentation prose renders inline read their label ink
 * from the token contract, and hold no palette literal of their own.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainTileSensorDef } from "@mindcraft-lang/core/brain/tiles";
import { bag, CoreTypeIds, mkActionDescriptor, mkCallDef, NIL_VALUE } from "@mindcraft-lang/core/runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { InlineTileIcon } from "./DocsRule";
import { DocsSidebarProvider } from "./DocsSidebarContext";

const INLINE_INK_TOKEN = "var(--color-brain-inline-ink)";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

/** A sensor tile with no argument slot, enough for the inline chip to render. */
function sensorTile(tileId: string): BrainTileSensorDef {
  const fnEntry = services.runtime.functions.register(
    5900,
    `${tileId}#5900`,
    false,
    { exec: () => NIL_VALUE },
    mkCallDef(bag())
  );
  return new BrainTileSensorDef(tileId, mkActionDescriptor("sensor", fnEntry, CoreTypeIds.Boolean), {
    metadata: { label: tileId },
  });
}

describe("the inline chip a tile reference renders as", () => {
  test("takes its label ink from the token contract", () => {
    const html = renderToStaticMarkup(
      <DocsSidebarProvider>
        <InlineTileIcon tileDef={sensorTile("token-inline-ink")} />
      </DocsSidebarProvider>
    );
    assert.ok(html.includes(INLINE_INK_TOKEN), html);
    assert.ok(!/#e2e8f0/i.test(html), html);
  });
});
