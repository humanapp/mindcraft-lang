/**
 * Pins the editor's side region: when its content is put in, what a closed
 * region does with the space and the keyboard, and the width the region lays
 * out from.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { sidePanelRegionClasses, standsSidePanelContent } from "./side-panel";

describe("what the side region holds", () => {
  test("holds nothing until it has stood open", () => {
    assert.equal(standsSidePanelContent(false, false), false);
  });

  test("takes its content in when it opens", () => {
    assert.equal(standsSidePanelContent(true, false), true);
  });

  test("keeps what it holds once it has stood open", () => {
    assert.equal(standsSidePanelContent(false, true), true);
  });
});

describe("the closed side region", () => {
  test("is laid out nowhere rather than moved out of view", () => {
    const closed = sidePanelRegionClasses(false);
    assert.match(closed, /(^|\s)hidden(\s|$)/);
    assert.doesNotMatch(closed, /translate|opacity|invisible/);
  });

  test("claims no width the rules could have had", () => {
    assert.doesNotMatch(sidePanelRegionClasses(false), /(^|\s)lg:flex(\s|$)/);
  });
});

describe("the open side region", () => {
  test("lays out only from the width the editor has room for both at", () => {
    const open = sidePanelRegionClasses(true);
    assert.match(open, /(^|\s)hidden(\s|$)/);
    assert.match(open, /(^|\s)lg:flex(\s|$)/);
  });
});

const regionSource = readFileSync(fileURLToPath(new URL("./BrainEditorSidePanel.tsx", import.meta.url)), "utf8");

describe("the side region and the keyboard", () => {
  test("moves the keyboard nowhere as it opens or closes", () => {
    assert.doesNotMatch(regionSource, /focus/i);
  });

  test("listens for no key of its own", () => {
    assert.doesNotMatch(regionSource, /addEventListener/);
  });
});
