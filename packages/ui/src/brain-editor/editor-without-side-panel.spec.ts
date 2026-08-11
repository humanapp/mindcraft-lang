/**
 * Pins that the brain editor stands in a host that configures no side region,
 * in one that configures a region standing closed, and in one whose content
 * reads the brain being edited. Asserts the render completes, not what it
 * draws.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainEditorDialog } from "./BrainEditorDialog";
import { useEditedBrain } from "./EditedBrainContext";

/** A host configuration carrying only what the editor requires. */
function hostConfig(sidePanel?: BrainEditorConfig["sidePanel"]): BrainEditorConfig {
  return {
    dataTypeIcons: new Map(),
    dataTypeNames: new Map(),
    customLiteralTypes: [],
    brainServices: __test__createBrainServices(),
    resolveTileVisual: () => ({ label: "", colorDef: { when: "#123456", do: "#abcdef" } }),
    sidePanel,
  };
}

/** Renders an open editor under `config` and returns its markup. */
function renderEditor(config: BrainEditorConfig): string {
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config },
      createElement(BrainEditorDialog, { isOpen: true, onOpenChange: () => {}, onSubmit: () => {} })
    )
  );
}

/** A tenant reading the brain being edited, recording what it was handed. */
function readingContent(read: { brain?: unknown }) {
  return createElement(function Tenant() {
    read.brain = useEditedBrain();
    return null;
  });
}

describe("the editor without a side region", () => {
  test("renders with no side panel configured at all", () => {
    assert.equal(typeof renderEditor(hostConfig()), "string");
  });

  test("renders with a side panel configured and closed", () => {
    const config = hostConfig({ isOpen: false, toggle: () => {}, content: null });
    assert.equal(typeof renderEditor(config), "string");
  });

  test("renders with content that reads the brain being edited", () => {
    const read: { brain?: unknown } = {};
    const config = hostConfig({ isOpen: true, toggle: () => {}, content: readingContent(read) });

    assert.equal(typeof renderEditor(config), "string");
    assert.equal(read.brain, undefined, "portaled content stands nothing in a server render");
  });
});

const dialogSource = readFileSync(fileURLToPath(new URL("./BrainEditorDialog.tsx", import.meta.url)), "utf8");

describe("what the editor stands over its side region", () => {
  test("stands the working copy and the history its own undo runs through", () => {
    assert.match(dialogSource, /brainDef,\s*history:\s*commandHistory/);
  });

  test("stands the way back to the page's own keyboard, taken from the standing document", () => {
    assert.match(dialogSource, /takeKeyboard\s*=\s*useCallback\(\(\)\s*=>\s*takePageGridKeyboard\(document\)/);
    assert.match(dialogSource, /reveal,\s*takeKeyboard\s*\}/);
  });

  test("wraps the region the host's content is put in", () => {
    assert.match(dialogSource, /<EditedBrainProvider[^>]*>\s*<BrainEditorSidePanel/);
  });

  test("stands the rules, then the region, then the buttons, which is the order a stacked editor reads in", () => {
    const box = dialogSource.indexOf("kSidePanelLayoutClasses}>");
    const rules = dialogSource.indexOf("{rulesRegion}", box);
    const region = dialogSource.indexOf("<BrainEditorSidePanel", box);
    const buttons = dialogSource.indexOf("<DialogFooter", box);

    assert.ok(box >= 0, "the rules and the region share one box");
    assert.ok(rules > box, "the rules stand first in it");
    assert.ok(region > rules, "the region stands after the rules");
    assert.ok(buttons > region, "the buttons stand after both");
  });
});
