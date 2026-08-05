/**
 * Pins where a closing dialog hands the keyboard back to: the chain it records
 * from the element that opened it, the link of that chain the document still
 * renders, and the landmark that stands in when none of them survived. Also
 * pins that a container is made focusable only for as long as it holds the
 * keyboard.
 *
 * Every case installs stand-in elements the functions can only tell apart by
 * identity, so nothing here depends on a DOM being present.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  editorContentStands,
  kEditorContentAttribute,
  returnFocusChain,
  returnFocusTarget,
  takeReturnFocus,
} from "./editor-return-focus";

/** A stand-in element: the ancestor link and the connection the pass reads. */
interface FakeElement {
  parentElement: FakeElement | null;
  isConnected: boolean;
}

/** An element whose ancestor is `parent`, rendered unless `isConnected` says otherwise. */
function element(parent: FakeElement | null, isConnected = true): FakeElement {
  return { parentElement: parent, isConnected };
}

/**
 * A stand-in document whose body is `body` and whose main landmark is
 * `landmark`, or which renders no landmark when that is null.
 */
function documentWith(body: FakeElement, landmark: FakeElement | null) {
  return { body, querySelector: () => landmark } as unknown as Document;
}

/** Hand a stand-in element to a function typed on the real DOM. */
function asElement(fake: FakeElement | null): HTMLElement | null {
  return fake as unknown as HTMLElement | null;
}

const body = element(null);

describe("return focus chain", () => {
  test("nothing holding the keyboard records no chain", () => {
    assert.deepEqual(returnFocusChain(null, documentWith(body, null)), []);
  });

  test("the body holding the keyboard records no chain", () => {
    assert.deepEqual(returnFocusChain(asElement(body), documentWith(body, null)), []);
  });

  test("the chain runs from the opener out to the last container below the body", () => {
    const region = element(body);
    const card = element(region);
    const opener = element(card);
    const chain = returnFocusChain(asElement(opener), documentWith(body, null));
    assert.equal(chain.length, 3);
    assert.equal(chain[0], asElement(opener));
    assert.equal(chain[1], asElement(card));
    assert.equal(chain[2], asElement(region));
  });
});

describe("return focus target", () => {
  test("an opener that still renders takes the keyboard", () => {
    const card = element(body);
    const opener = element(card);
    const chain = returnFocusChain(asElement(opener), documentWith(body, null));
    assert.equal(returnFocusTarget(chain, documentWith(body, null)), asElement(opener));
  });

  test("an opener that stopped rendering gives way to the container it stood in", () => {
    const card = element(body);
    const opener = element(card);
    const chain = returnFocusChain(asElement(opener), documentWith(body, null));
    opener.isConnected = false;
    assert.equal(returnFocusTarget(chain, documentWith(body, null)), asElement(card));
  });

  test("a chain none of whose links still render gives way to the main landmark", () => {
    const card = element(body);
    const opener = element(card);
    const chain = returnFocusChain(asElement(opener), documentWith(body, null));
    opener.isConnected = false;
    card.isConnected = false;
    const landmark = element(body);
    assert.equal(returnFocusTarget(chain, documentWith(body, landmark)), asElement(landmark));
  });

  test("an empty chain takes the main landmark", () => {
    const landmark = element(body);
    assert.equal(returnFocusTarget([], documentWith(body, landmark)), asElement(landmark));
  });

  test("a document rendering no main landmark leaves the keyboard where it stands", () => {
    assert.equal(returnFocusTarget([], documentWith(body, null)), null);
  });
});

describe("an editor content still standing", () => {
  /** A stand-in document that renders `content` for the editor content selector alone. */
  function documentRendering(content: FakeElement | null) {
    return {
      querySelector: (selector: string) => (selector === `[${kEditorContentAttribute}]` ? content : null),
    } as unknown as Document;
  }

  test("a replacement content standing is read as a swap", () => {
    assert.equal(editorContentStands(documentRendering(element(body))), true);
  });

  test("no content standing is read as the editor having closed", () => {
    assert.equal(editorContentStands(documentRendering(null)), false);
  });
});

/** A stand-in focus target recording what was done to it. */
function focusTarget(tabIndex: number, declaredTabindex: boolean) {
  const record = {
    tabIndex,
    attributes: declaredTabindex ? ["tabindex"] : ([] as string[]),
    focused: 0,
    scrolled: true,
    blur: undefined as (() => void) | undefined,
    hasAttribute: (name: string) => record.attributes.includes(name),
    setAttribute: (name: string) => {
      record.attributes.push(name);
    },
    removeAttribute: (name: string) => {
      record.attributes = record.attributes.filter((held) => held !== name);
    },
    addEventListener: (_type: string, listener: () => void) => {
      record.blur = listener;
    },
    focus: (options: { preventScroll: boolean }) => {
      record.focused += 1;
      record.scrolled = !options.preventScroll;
    },
  };
  return record;
}

describe("taking return focus", () => {
  test("a container is made focusable, takes the keyboard, and does not move the view", () => {
    const container = focusTarget(-1, false);
    takeReturnFocus(container as unknown as HTMLElement);
    assert.deepEqual(container.attributes, ["tabindex"]);
    assert.equal(container.focused, 1);
    assert.equal(container.scrolled, false);
  });

  test("a container gives the tabindex back when it loses the keyboard", () => {
    const container = focusTarget(-1, false);
    takeReturnFocus(container as unknown as HTMLElement);
    assert.notEqual(container.blur, undefined);
    container.blur?.();
    assert.deepEqual(container.attributes, []);
  });

  test("an element focusable by nature gains no tabindex", () => {
    const control = focusTarget(0, false);
    takeReturnFocus(control as unknown as HTMLElement);
    assert.deepEqual(control.attributes, []);
    assert.equal(control.focused, 1);
  });

  test("an element carrying its own tabindex keeps the one it declared", () => {
    const control = focusTarget(-1, true);
    takeReturnFocus(control as unknown as HTMLElement);
    assert.equal(control.blur, undefined);
    control.removeAttribute("nothing");
    assert.deepEqual(control.attributes, ["tabindex"]);
    assert.equal(control.focused, 1);
  });
});
