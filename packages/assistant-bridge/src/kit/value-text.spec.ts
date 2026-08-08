/**
 * How a rehearsal renders the values a brain dispatches: two values that differ
 * read differently, a value a literal tile bakes reads by that tile's label, and
 * every rendering stays inside the bound a trace summary allows it.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MindcraftModule, MindcraftModuleApi, Value } from "@mindcraft-lang/core/app";
import {
  BrainTileLiteralDef,
  CoreTypeIds,
  List,
  mkClosedStructValue,
  mkListValue,
  mkNativeStructValue,
  mkNumberValue,
  mkTypeId,
  NativeType,
} from "@mindcraft-lang/core/app";
import { mkBufferValueFromHex, TARGET_TYPE_ATOM_BASE } from "@mindcraft-lang/core/runtime";
import { createRehearsalEnvironment, createSeededRng } from "./environment.js";
import type { NumberText } from "./value-text.js";
import { createValueLabeler, renderValue } from "./value-text.js";

/** Longest rendering the trace summary allows one value. */
const maxLength = 48;

/** Struct type the fixture's values carry: a step count and a byte pattern. */
const kToneTypeId = mkTypeId(NativeType.Struct, "Tone");

/** List-of-tone type the fixture's container values carry. */
const kToneListTypeId = mkTypeId(NativeType.List, "List<struct:<Tone>>");

/** The host object one fixture literal tile is backed by. */
const kLiveSource = { source: "live" };

/** A second host object, backed by no tile. */
const kOtherSource = { source: "other" };

/** A tone of `steps` steps carrying `pattern` as its bytes. */
function tone(steps: number, pattern: string): Value {
  return mkClosedStructValue(kToneTypeId, List.from<Value>([mkNumberValue(steps), mkBufferValueFromHex(pattern)]));
}

/** Numbers render as their plain decimal form, the host's own precision. */
const numberText: NumberText = (value) => String(value);

/**
 * A module registering the tone struct type and three literal tiles over it:
 * two baking tone contents, one baking a host object.
 */
function toneModule(): MindcraftModule {
  return {
    id: "mindcraft.assistant-bridge.tone",
    install(api: MindcraftModuleApi): void {
      api.defineType({
        coreType: NativeType.Struct,
        typeId: kToneTypeId,
        name: "Tone",
        atomId: TARGET_TYPE_ATOM_BASE,
        fields: List.from([
          { name: "steps", typeId: CoreTypeIds.Number, fieldIndex: 0 },
          { name: "pattern", typeId: CoreTypeIds.Buffer, fieldIndex: 1 },
        ]),
      });
      const tiles: readonly [string, Value][] = [
        ["high", tone(2, "00ff")],
        ["low", tone(2, "ff00")],
        ["live", mkNativeStructValue(kToneTypeId, kLiveSource)],
      ];
      for (const [valueLabel, value] of tiles) {
        api.registerTile(
          new BrainTileLiteralDef(kToneTypeId, value, { valueLabel, persist: false }, api.brainServices)
        );
      }
    },
  };
}

/** Render `value` against the catalogs the tone module installs. */
function rendered(value: Value): string {
  const environment = createRehearsalEnvironment({ modules: [toneModule()], rng: createSeededRng(1) });
  const labelOf = createValueLabeler(() => environment.tileCatalogs(), numberText);
  return renderValue(value, numberText, labelOf);
}

/** A list of `count` tones, the one at `oddIndex` carrying a different pattern. */
function tones(count: number, oddIndex: number): Value {
  const items: Value[] = [];
  for (let i = 0; i < count; i++) items.push(tone(10 + i, i === oddIndex ? "abcd" : "0f0f"));
  return mkListValue(kToneListTypeId, List.from(items));
}

describe("rendering a dispatched value", () => {
  test("names a struct by the label of the literal tile baking its contents", () => {
    assert.equal(rendered(tone(2, "00ff")), "high");
  });

  test("tells apart two structs of one type differing only in their bytes", () => {
    assert.equal(rendered(tone(2, "00ff")), "high");
    assert.equal(rendered(tone(2, "ff00")), "low");
  });

  test("tells apart two structs no literal tile bakes", () => {
    const first = rendered(tone(9, "1111"));
    const second = rendered(tone(9, "2222"));

    assert.notEqual(first, second);
    assert.ok(first.startsWith(`${kToneTypeId}(9,`), first);
  });

  test("names a native-backed struct by the tile baking that same host object", () => {
    assert.equal(rendered(mkNativeStructValue(kToneTypeId, kLiveSource)), "live");
  });

  test("marks a native-backed struct no tile bakes as opaque rather than naming it", () => {
    assert.equal(rendered(mkNativeStructValue(kToneTypeId, kOtherSource)), `${kToneTypeId}(opaque)`);
  });

  test("shows the identity of a list's elements", () => {
    assert.equal(
      rendered(mkListValue(kToneListTypeId, List.from<Value>([tone(2, "00ff")]))),
      `${kToneListTypeId}[high]`
    );
  });

  test("keeps a container too large to spell out inside the bound, and still distinct", () => {
    const first = rendered(tones(12, 3));
    const second = rendered(tones(12, 4));

    assert.ok(first.length <= maxLength, first);
    assert.ok(second.length <= maxLength, second);
    assert.notEqual(first, second);
  });

  test("renders one value the same way every time", () => {
    assert.equal(rendered(tones(12, 3)), rendered(tones(12, 3)));
  });
});
