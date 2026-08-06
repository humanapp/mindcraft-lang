/**
 * Pins the inset seam: which elements a published inset reaches, what a surface
 * mounting after a publish reads, and the registration each inset property
 * carries in `ui.css`.
 *
 * The surfaces here are stand-ins recording the writes they receive.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  attachInsetSurface,
  type InsetSurface,
  kDocsPanelInsetVar,
  publishInset,
  withdrawInset,
} from "./surface-insets";

/** A surface recording every write it receives, newest last. */
interface RecordingSurface extends InsetSurface {
  readonly writes: string[];
  value(property: string): string | undefined;
}

function recordingSurface(): RecordingSurface {
  const values = new Map<string, string>();
  const writes: string[] = [];
  return {
    writes,
    value: (property) => values.get(property),
    style: {
      setProperty(property, value) {
        values.set(property, value);
        writes.push(`set ${property}=${value}`);
      },
      removeProperty(property) {
        const previous = values.get(property) ?? "";
        values.delete(property);
        writes.push(`remove ${property}`);
        return previous;
      },
    },
  };
}

describe("the inset seam", () => {
  test("a published inset reaches every attached surface", () => {
    const first = recordingSurface();
    const second = recordingSurface();
    const releases = [attachInsetSurface(first), attachInsetSurface(second)];

    publishInset(kDocsPanelInsetVar, "26%");

    assert.equal(first.value(kDocsPanelInsetVar), "26%");
    assert.equal(second.value(kDocsPanelInsetVar), "26%");

    withdrawInset(kDocsPanelInsetVar);
    for (const release of releases) release();
  });

  test("a surface attached after a publish carries the value that stands", () => {
    const early = recordingSurface();
    const releaseEarly = attachInsetSurface(early);
    publishInset(kDocsPanelInsetVar, "31%");

    const late = recordingSurface();
    const releaseLate = attachInsetSurface(late);

    assert.equal(late.value(kDocsPanelInsetVar), "31%");

    withdrawInset(kDocsPanelInsetVar);
    releaseEarly();
    releaseLate();
  });

  test("withdrawing clears the property from attached surfaces and from later ones", () => {
    const attached = recordingSurface();
    const release = attachInsetSurface(attached);
    publishInset(kDocsPanelInsetVar, "26%");

    withdrawInset(kDocsPanelInsetVar);
    assert.equal(attached.value(kDocsPanelInsetVar), undefined);

    const late = recordingSurface();
    const releaseLate = attachInsetSurface(late);
    assert.equal(late.writes.length, 0);

    release();
    releaseLate();
  });

  test("a released surface takes no further writes", () => {
    const surface = recordingSurface();
    attachInsetSurface(surface)();

    publishInset(kDocsPanelInsetVar, "26%");

    assert.equal(surface.writes.length, 0);
    withdrawInset(kDocsPanelInsetVar);
  });
});

// ---------------------------------------------------------------------------
// The registration behind the seam
// ---------------------------------------------------------------------------

const uiCss = readFileSync(fileURLToPath(new URL("../ui.css", import.meta.url)), "utf8");

/** The `@property` block registering `name`, with its whitespace collapsed. */
function registrationOf(name: string): string {
  const match = uiCss.match(new RegExp(`@property\\s+${name}\\s*\\{[^}]*\\}`));
  assert.ok(match, `${name} is registered in ui.css`);
  return match[0].replace(/\s+/g, " ");
}

describe("the inset custom properties registered in ui.css", () => {
  test("the documentation panel's inset does not inherit and starts at zero percent", () => {
    const registration = registrationOf("--docs-panel-inset");
    assert.match(registration, /inherits: false;/);
    assert.match(registration, /initial-value: 0%;/);
    assert.match(registration, /syntax: "<percentage>";/);
  });

  test("the soft keyboard's inset does not inherit and starts at zero pixels", () => {
    const registration = registrationOf("--keyboard-inset");
    assert.match(registration, /inherits: false;/);
    assert.match(registration, /initial-value: 0px;/);
    assert.match(registration, /syntax: "<length>";/);
  });
});
