/**
 * Pins the editor's side region: when its content is put in, what a closed
 * region does with the space and the keyboard, and where an open one lays out
 * at a narrow editor and at a wide one.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  kSidePanelLayoutClasses,
  sidePanelRegionClasses,
  sidePanelToggleLabel,
  standsSidePanelContent,
} from "./side-panel";

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

  test("claims no space the rules could have had, at any width", () => {
    assert.doesNotMatch(sidePanelRegionClasses(false), /(^|\s)(lg:)?(flex|basis-\[|w-80)(\s|$)/);
  });
});

describe("the open side region", () => {
  test("stands at every width, narrow ones included", () => {
    const open = sidePanelRegionClasses(true);
    assert.match(open, /(^|\s)flex(\s|$)/);
    assert.doesNotMatch(open, /(^|\s)hidden(\s|$)/);
  });

  test("takes a bounded share of the height it is stacked in, rather than growing with what it holds", () => {
    const open = sidePanelRegionClasses(true);
    assert.match(open, /(^|\s)basis-\[\d+%\](\s|$)/);
    assert.match(open, /(^|\s)grow-0(\s|$)/);
    assert.match(open, /(^|\s)shrink-0(\s|$)/);
  });

  test("takes its own column at its side of the rules once there is room for both across", () => {
    const open = sidePanelRegionClasses(true);
    assert.match(open, /(^|\s)lg:w-80(\s|$)/);
    assert.match(open, /(^|\s)lg:basis-auto(\s|$)/);
    assert.match(open, /(^|\s)lg:order-first(\s|$)/);
  });

  test("scrolls nothing of its own, leaving that to what it holds", () => {
    assert.match(sidePanelRegionClasses(true), /(^|\s)overflow-hidden(\s|$)/);
  });
});

describe("the box holding the rules and the side region", () => {
  test("stacks them until there is room for both across, and stands them in a row from there", () => {
    assert.match(kSidePanelLayoutClasses, /(^|\s)flex-col(\s|$)/);
    assert.match(kSidePanelLayoutClasses, /(^|\s)lg:flex-row(\s|$)/);
  });

  test("is the editor's one growing box, and shrinks under what it holds", () => {
    assert.match(kSidePanelLayoutClasses, /(^|\s)grow(\s|$)/);
    assert.match(kSidePanelLayoutClasses, /(^|\s)min-h-0(\s|$)/);
  });
});

describe("what the control toggling the side region is called", () => {
  test("carries the name the host gave the region", () => {
    assert.match(sidePanelToggleLabel("Herbivore Brain"), /Herbivore Brain/);
  });

  test("names the region itself when the host named it nothing", () => {
    const generic = sidePanelToggleLabel(undefined);
    assert.equal(generic, sidePanelToggleLabel(""));
    assert.ok(generic.length > 0, "the control is never left unnamed");
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
