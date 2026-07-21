import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSupportedVersionRange, satisfiesRange } from "@mindcraft-lang/app-host";

describe("satisfiesRange", () => {
  it("evaluates the supported comparator dialect", () => {
    assert.equal(satisfiesRange("1.2.3", "1.2.3"), true);
    assert.equal(satisfiesRange("1.2.3", "=1.2.3"), true);
    assert.equal(satisfiesRange("1.4.0", "^1.2.3"), true);
    assert.equal(satisfiesRange("2.0.0", "^1.2.3"), false);
    assert.equal(satisfiesRange("1.2.9", "~1.2.0"), true);
    assert.equal(satisfiesRange("1.3.0", "~1.2.0"), false);
    assert.equal(satisfiesRange("1.5.0", ">=1.0.0 <2.0.0"), true);
    assert.equal(satisfiesRange("2.0.0", ">=1.0.0 <2.0.0"), false);
    assert.equal(satisfiesRange("0.2.0", ">=0.2.0 <=0.4.0"), true);
    assert.equal(satisfiesRange("0.4.0", ">=0.2.0 <=0.4.0"), true);
    assert.equal(satisfiesRange("0.1.9", ">=0.2.0 <=0.4.0"), false);
    assert.equal(satisfiesRange("0.4.1", ">=0.2.0 <=0.4.0"), false);
    assert.equal(satisfiesRange("9.9.9", "*"), true);
  });
});

describe("isSupportedVersionRange", () => {
  it("accepts every comparator form the evaluator implements", () => {
    for (const range of ["1.2.3", "=1.2.3", "^0.2.0", "~1.2.0", ">=1.0.0 <2.0.0", ">=0.2.0 <=0.4.0", "*", "x"]) {
      assert.equal(isSupportedVersionRange(range), true, range);
    }
  });

  it("rejects empty ranges and forms outside the grammar", () => {
    for (const range of ["", "  ", ">=1.0", "1.x.0", "1.0.0 || 2.0.0", "latest", "^1"]) {
      assert.equal(isSupportedVersionRange(range), false, range);
    }
  });
});
