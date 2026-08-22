/**
 * Pins that the brain editor stands in a host that installs no documentation
 * provider, and in one that installs a panel but asks for no mode reporting.
 *
 * `docsIntegration` and its `reportMode` are both optional on
 * `BrainEditorConfig`. The dialog reads them at render, so a host that omits
 * either must still render; the report itself is an optional call and reaches
 * nothing when there is nothing to call. `packages/ui` has no jsdom and the
 * dialog's content is portaled, so this asserts the render completes, not what
 * it draws.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import { BrainEditorDialog } from "./BrainEditorDialog";

/** A host configuration carrying only what the editor requires. */
function hostConfig(docsIntegration?: BrainEditorConfig["docsIntegration"]): BrainEditorConfig {
  return {
    dataTypeIcons: new Map(),
    dataTypeNames: new Map(),
    customLiteralTypes: [],
    brainServices: __test__createBrainServices(),
    resolveTileVisual: () => ({ label: "", colorDef: { when: "#123456", do: "#abcdef" } }),
    docsIntegration,
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

describe("the editor without a docs provider", () => {
  test("renders with no docs integration at all", () => {
    assert.equal(typeof renderEditor(hostConfig()), "string");
  });

  test("renders with a docs integration that reports no mode", () => {
    const config = hostConfig({ isOpen: false, toggle: () => {}, close: () => {} });
    assert.equal(typeof renderEditor(config), "string");
  });
});
