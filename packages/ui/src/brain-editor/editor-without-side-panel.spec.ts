/**
 * Pins that the brain editor stands in a host that configures no side region,
 * and in one that configures a region standing closed. Asserts the render
 * completes, not what it draws.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainEditorDialog } from "./BrainEditorDialog";

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

describe("the editor without a side region", () => {
  test("renders with no side panel configured at all", () => {
    assert.equal(typeof renderEditor(hostConfig()), "string");
  });

  test("renders with a side panel configured and closed", () => {
    const config = hostConfig({ isOpen: false, toggle: () => {}, content: null });
    assert.equal(typeof renderEditor(config), "string");
  });
});
