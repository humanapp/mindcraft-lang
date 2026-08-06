/**
 * Pins the inset a dialog subtracts to stay clear of the soft keyboard, and
 * where the publisher writes it.
 *
 * The viewport reports its metrics for far more than a keyboard, so the cases
 * here cover the movements that must read as no occlusion at all: a pinch-zoom,
 * which shrinks the visual viewport without covering anything, and a panned
 * visual viewport, which moves it without covering anything either.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { attachKeyboardInsetPublisher, keyboardInsetPx, kKeyboardInsetVar } from "./keyboard-inset";
import { attachInsetSurface, type InsetSurface } from "./surface-insets";

/** A 768px-tall layout viewport with nothing covering it and no zoom. */
const unoccluded = { layoutHeight: 768, visualHeight: 768, offsetTop: 0, scale: 1 };

describe("keyboardInsetPx", () => {
  test("reads zero when the whole layout viewport is reachable", () => {
    assert.equal(keyboardInsetPx(unoccluded), 0);
  });

  test("reads the covered height when a keyboard takes the bottom of the viewport", () => {
    assert.equal(keyboardInsetPx({ ...unoccluded, visualHeight: 768 - 336 }), 336);
  });

  test("reads zero under a pinch-zoom, which shrinks the visual viewport without covering anything", () => {
    assert.equal(keyboardInsetPx({ ...unoccluded, visualHeight: 384, scale: 2 }), 0);
  });

  test("reads the covered height under a pinch-zoom with the keyboard also up", () => {
    assert.equal(keyboardInsetPx({ layoutHeight: 768, visualHeight: (768 - 336) / 2, offsetTop: 0, scale: 2 }), 336);
  });

  test("reads zero once the visual viewport has been scrolled onto the layout viewport's bottom edge", () => {
    assert.equal(keyboardInsetPx({ layoutHeight: 768, visualHeight: 384, offsetTop: 384, scale: 1 }), 0);
  });

  test("clamps to zero when the reachable height exceeds the layout viewport", () => {
    assert.equal(keyboardInsetPx({ ...unoccluded, visualHeight: 820 }), 0);
  });
});

/** A surface recording the inset writes it receives. */
function recordingSurface(): InsetSurface & { readonly written: Map<string, string> } {
  const written = new Map<string, string>();
  return {
    written,
    style: {
      setProperty: (property, value) => void written.set(property, value),
      removeProperty: (property) => {
        const previous = written.get(property) ?? "";
        written.delete(property);
        return previous;
      },
    },
  };
}

/**
 * Runs `body` with a window reporting a keyboard covering 336px of a 768px
 * layout viewport, and a document root that records any write reaching it.
 */
function withStubbedViewport(body: (documentRootWrites: string[]) => void): void {
  const documentRootWrites: string[] = [];
  const globals = globalThis as Record<string, unknown>;
  const priorWindow = globals.window;
  const priorDocument = globals.document;
  globals.window = {
    innerHeight: 768,
    visualViewport: { height: 432, offsetTop: 0, scale: 1, addEventListener: () => {}, removeEventListener: () => {} },
  };
  globals.document = {
    documentElement: {
      style: {
        setProperty: (property: string, value: string) => void documentRootWrites.push(`set ${property}=${value}`),
        removeProperty: (property: string) => void documentRootWrites.push(`remove ${property}`),
      },
    },
  };
  try {
    body(documentRootWrites);
  } finally {
    globals.window = priorWindow;
    globals.document = priorDocument;
  }
}

describe("the soft keyboard inset publisher", () => {
  test("writes the inset onto attached surfaces and nothing onto the document root", () => {
    withStubbedViewport((documentRootWrites) => {
      const surface = recordingSurface();
      const releaseSurface = attachInsetSurface(surface);

      const releasePublisher = attachKeyboardInsetPublisher();
      assert.equal(surface.written.get(kKeyboardInsetVar), "336px");
      assert.deepEqual(documentRootWrites, []);

      releasePublisher();
      assert.equal(surface.written.get(kKeyboardInsetVar), undefined);
      assert.deepEqual(documentRootWrites, []);

      releaseSurface();
    });
  });
});
