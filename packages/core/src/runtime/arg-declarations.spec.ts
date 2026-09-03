import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { BrainActionCallChoiceSpec } from "@wendoo/core/runtime";
import { bag, CoreParameterId, choice, mkCallDef, mkNumberValue, mkStringValue, param } from "@wendoo/core/runtime";

/** Build a call def holding one declared slot, as a thunk that runs the check when called. */
function declare(opts: Parameters<typeof param>[1]) {
  return () => mkCallDef(bag(param(CoreParameterId.AnonymousNumber, opts)));
}

describe("what an argument declaration may say", () => {
  test("takes a name, a unit, a default and a range together", () => {
    const callDef = declare({
      name: "seconds",
      anonymous: true,
      unit: "s",
      default: mkNumberValue(1),
      range: { min: 0, max: 60, onExceed: "clamp" },
    })();

    const argSpec = callDef.argSlots.get(0).argSpec;
    assert.equal(argSpec.name, "seconds");
    assert.equal(argSpec.unit, "s");
    assert.deepEqual(argSpec.default, mkNumberValue(1));
    assert.deepEqual(argSpec.range, { min: 0, max: 60, onExceed: "clamp" });
  });

  test("takes derived in place of a default", () => {
    const callDef = declare({ name: "target", anonymous: true, derived: true })();

    assert.equal(callDef.argSlots.get(0).argSpec.derived, true);
  });

  test("leaves an undeclared slot carrying none of the fields", () => {
    const callDef = declare({ anonymous: true })();

    const argSpec = callDef.argSlots.get(0).argSpec;
    assert.equal(argSpec.default, undefined);
    assert.equal(argSpec.derived, undefined);
    assert.equal(argSpec.range, undefined);
    assert.equal(argSpec.unit, undefined);
  });
});

describe("the declarations a call def refuses", () => {
  test("refuses a slot declaring both a default and derived", () => {
    assert.throws(declare({ default: mkNumberValue(1), derived: true }), /both a default and derived/);
  });

  test("refuses a slot that is required and declares what an empty slot means", () => {
    assert.throws(
      declare({ required: true, default: mkNumberValue(1) }),
      /required and declares what an empty slot means/
    );
    assert.throws(declare({ required: true, derived: true }), /required and declares what an empty slot means/);
  });

  test("takes a required slot declaring neither", () => {
    assert.doesNotThrow(declare({ required: true, unit: "s" }));
    assert.doesNotThrow(declare({ range: { min: 0, max: 255, onExceed: "wrap" } }));
  });

  test("refuses a range carrying neither bound", () => {
    assert.throws(declare({ range: { onExceed: "clamp" } }), /range carrying neither bound/);
  });

  test("refuses a range whose min is above its max", () => {
    assert.throws(declare({ range: { min: 5, max: 1, onExceed: "clamp" } }), /min 5 is above its max 1/);
  });

  test("takes a range bounded on one side only", () => {
    assert.doesNotThrow(declare({ range: { min: 0, onExceed: "drop" } }));
    assert.doesNotThrow(declare({ range: { max: 9, onExceed: "clamp" } }));
  });

  test("refuses a range on a slot whose default is not a number", () => {
    assert.throws(
      declare({ default: mkStringValue("hello"), range: { min: 0, max: 1, onExceed: "clamp" } }),
      /range on a non-numeric slot/
    );
  });
});

describe("the names a call spec carries", () => {
  test("takes an arg name beside a differing choice name", () => {
    assert.doesNotThrow(() =>
      mkCallDef(
        bag(
          choice(param(CoreParameterId.AnonymousNumber, { name: "targeted" })),
          param(CoreParameterId.AnonymousString, { name: "target" })
        )
      )
    );
  });

  test("refuses two specs carrying the same name", () => {
    assert.throws(
      () =>
        mkCallDef(
          bag(
            param(CoreParameterId.AnonymousNumber, { name: "amount" }),
            param(CoreParameterId.AnonymousString, { name: "amount" })
          )
        ),
      /names amount twice/
    );
  });

  test("refuses an arg repeating the name of the choice around it", () => {
    const named: BrainActionCallChoiceSpec = {
      type: "choice",
      name: "pick",
      options: [param(CoreParameterId.AnonymousNumber, { name: "pick" })],
    };

    assert.throws(() => mkCallDef(bag(named)), /names pick twice/);
  });
});
