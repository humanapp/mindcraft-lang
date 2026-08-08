import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { TargetAdapter } from "./adapter.js";
import {
  ADAPTER_CONTRACT_VERSION,
  AdapterNonconformanceCode,
  adapterMethods,
  adapterNonconformance,
  readAdapterArtifact,
} from "./adapter.js";

/** Target identity the fixture artifact claims. */
const expected = { targetIdentity: "example-org/trg-fixture" };

/** A conforming adapter stand-in, with `overrides` applied. */
function adapter(overrides: Partial<TargetAdapter> = {}): unknown {
  const base: Record<string, unknown> = {
    contractVersion: ADAPTER_CONTRACT_VERSION,
    targetIdentity: expected.targetIdentity,
  };
  for (const name of adapterMethods) base[name] = () => undefined;
  return { ...base, ...overrides };
}

describe("adapter conformance", () => {
  test("accepts an artifact matching the interface, the contract, and the expected target identity", () => {
    const nonconformance = adapterNonconformance(expected, adapter());

    assert.equal(nonconformance, undefined);
  });

  test("reports each way an artifact can fail with its own code", () => {
    const cases: readonly [unknown, string][] = [
      [undefined, AdapterNonconformanceCode.NotAnObject],
      [adapter({ run: undefined }), AdapterNonconformanceCode.MissingMembers],
      [adapter({ contractVersion: ADAPTER_CONTRACT_VERSION + 1 }), AdapterNonconformanceCode.ContractVersionMismatch],
      [adapter({ targetIdentity: "example-org/trg-other" }), AdapterNonconformanceCode.IdentityMismatch],
    ];

    for (const [candidate, code] of cases) {
      const nonconformance = adapterNonconformance(expected, candidate);
      assert.equal(nonconformance?.code, code, JSON.stringify(nonconformance));
    }
  });
});

describe("reading an adapter artifact", () => {
  test("returns the adapter a conforming module publishes", () => {
    const result = readAdapterArtifact({ createTargetAdapter: () => adapter() }, expected);

    assert.equal(result.ok, true);
  });

  test("reports a module exporting no adapter factory", () => {
    const result = readAdapterArtifact({}, expected);

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.nonconformance.code, AdapterNonconformanceCode.MissingFactory);
  });
});
