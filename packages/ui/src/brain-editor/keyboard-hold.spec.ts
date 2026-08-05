/**
 * Pins which elements the editor reads as holding the keyboard, and which of
 * them the candidate strip counts as its own. Only three landings count as
 * nowhere -- no element, the document body, and the editor's own dialog
 * container -- and everything else, including a popup a portal renders outside
 * the editor's subtree, is left holding what it has. The strip's own elements
 * are its filter box, the offering panel, and a popup one of the panel's
 * controls opened.
 *
 * Both predicates read the live document, so each case installs a stand-in
 * document whose elements they can only tell apart by identity.
 */

import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { isCandidateStripElement, keyboardIsInCandidateStrip, keyboardIsUnheld } from "./BrainCandidateStrip";
import { kPageGridCellAttribute } from "./page-grid-model";

/** A stand-in element: identity, plus the one ancestor lookup the predicate makes. */
interface FakeElement {
  closest(selector: string): FakeElement | null;
}

/** The dialog container the editor's rules stand in. */
const dialogRoot: FakeElement = { closest: () => null };

/** A cell of the page's selection grid, which reports `dialogRoot` as its dialog. */
const gridCell: FakeElement = { closest: () => dialogRoot };

/** The document body. */
const body: FakeElement = { closest: () => null };

/** Content a portal renders outside the editor's subtree, such as a menu or a nested dialog. */
const portaledPopup: FakeElement = { closest: () => null };

/**
 * Make `active` the focused element of a document that renders the page grid
 * when `hasGrid`, and leave it installed for the predicate to read.
 */
function installDocument(active: FakeElement | null, hasGrid = true): void {
  const stand = {
    activeElement: active,
    body,
    querySelector: (selector: string) => (hasGrid && selector === `[${kPageGridCellAttribute}]` ? gridCell : null),
  };
  (globalThis as { document?: unknown }).document = stand;
}

afterEach(() => {
  (globalThis as { document?: unknown }).document = undefined;
});

describe("keyboard hold", () => {
  test("no focused element is nowhere", () => {
    installDocument(null);
    assert.equal(keyboardIsUnheld(), true);
  });

  test("the document body is nowhere", () => {
    installDocument(body);
    assert.equal(keyboardIsUnheld(), true);
  });

  test("the editor's dialog container is nowhere", () => {
    installDocument(dialogRoot);
    assert.equal(keyboardIsUnheld(), true);
  });

  test("a portaled popup holds the keyboard", () => {
    installDocument(portaledPopup);
    assert.equal(keyboardIsUnheld(), false);
  });

  test("a cell of the page's selection grid holds the keyboard", () => {
    installDocument(gridCell);
    assert.equal(keyboardIsUnheld(), false);
  });

  test("an element holds the keyboard while the document renders no page grid", () => {
    installDocument(portaledPopup, false);
    assert.equal(keyboardIsUnheld(), false);
  });
});

/** The marked ancestor a stand-in element reports, standing for the strip element it sits in. */
const markedAncestor: FakeElement = { closest: () => null };

/**
 * A stand-in element sitting inside an element marked `marker`, or under no
 * marked ancestor at all when `marker` is null.
 */
function elementUnder(marker: string | null): FakeElement {
  return { closest: (selector) => (marker !== null && selector.includes(`[${marker}]`) ? markedAncestor : null) };
}

describe("candidate strip elements", () => {
  test("no element is not the strip's", () => {
    assert.equal(isCandidateStripElement(null), false);
  });

  test("the filter box is the strip's", () => {
    assert.equal(isCandidateStripElement(elementUnder("data-strip-filter") as unknown as Element), true);
  });

  test("what the offering panel holds is the strip's", () => {
    assert.equal(isCandidateStripElement(elementUnder("data-strip-panel") as unknown as Element), true);
  });

  test("what a popup the strip opened holds is the strip's", () => {
    assert.equal(isCandidateStripElement(elementUnder("data-strip-popup") as unknown as Element), true);
  });

  test("an element under none of the strip's markers is not the strip's", () => {
    assert.equal(isCandidateStripElement(elementUnder(null) as unknown as Element), false);
  });

  test("the keyboard is in the strip when it stands on one of the strip's elements", () => {
    installDocument(elementUnder("data-strip-panel"));
    assert.equal(keyboardIsInCandidateStrip(), true);
  });

  test("the keyboard is outside the strip when it stands anywhere else", () => {
    installDocument(elementUnder(null));
    assert.equal(keyboardIsInCandidateStrip(), false);
  });
});
