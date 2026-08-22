import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { coreModule, createWendooEnvironment, List, MathOps, type WendooEnvironment } from "@wendoo-lang/core";
import type { BrainServices } from "@wendoo-lang/core/brain";
import {
  type BrainSyncFunctionEntry,
  CoreFuncId,
  createEntropySeededRng,
  createProfileNumerics,
  type ExecutionContext,
  extractNumberValue,
  Rng,
  type Value,
} from "@wendoo-lang/core/runtime";

/** The first state seed 1 advances to, which pins the generator's constants. */
const firstStateFromSeedOne = 1015568748;

function draws(rng: Rng, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(rng.next());
  return out;
}

describe("Rng", () => {
  test("the same seed yields the same sequence", () => {
    assert.deepEqual(draws(new Rng(1234), 8), draws(new Rng(1234), 8));
  });

  test("different seeds yield different sequences", () => {
    assert.notDeepEqual(draws(new Rng(1234), 8), draws(new Rng(9999), 8));
  });

  test("two instances of one seed advance independently", () => {
    const first = new Rng(7);
    const second = new Rng(7);
    draws(first, 5);

    assert.deepEqual(draws(second, 3), draws(new Rng(7), 3));
  });

  test("an unseeded instance starts where seed 1 does", () => {
    assert.deepEqual(draws(new Rng(), 4), draws(new Rng(1), 4));
  });

  test("the first draw of seed 1 is the LCG state over 2^32", () => {
    assert.equal(new Rng(1).next(), firstStateFromSeedOne / 4294967296);
  });

  test("every draw lands in [0, 1)", () => {
    for (const value of draws(new Rng(20260812), 2000)) {
      assert.ok(value >= 0 && value < 1, `${value}`);
    }
  });

  test("a seed is taken modulo 2^32", () => {
    assert.deepEqual(draws(new Rng(1 + 4294967296), 4), draws(new Rng(1), 4));
  });
});

describe("createEntropySeededRng", () => {
  test("produces an unrelated stream on each call", () => {
    assert.notDeepEqual(draws(createEntropySeededRng(), 8), draws(createEntropySeededRng(), 8));
  });
});

/** Calls `$$math_random` on `environment` `count` times, as the VM's HOST_CALL does. */
function randomBuiltinDraws(environment: WendooEnvironment, count: number): number[] {
  const services: BrainServices = environment.withServices((brainServices) => brainServices);
  const entry = services.runtime.functions.getSyncById(CoreFuncId.MathRandom) as BrainSyncFunctionEntry | undefined;
  assert.ok(entry, "the core module registers $$math_random");
  const ctx = { services, fiberId: 0, time: 0, dt: 0, currentTick: 0 } as unknown as ExecutionContext;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const value = extractNumberValue(entry.fn.exec(ctx, List.empty<Value>()));
    assert.ok(value !== undefined, "$$math_random returns a number");
    out.push(value);
  }
  return out;
}

describe("the $$math_random builtin", () => {
  test("draws from the environment's own rng", () => {
    const environment = createWendooEnvironment({ modules: [coreModule()], rng: new Rng(4242) });

    assert.deepEqual(randomBuiltinDraws(environment, 5), draws(new Rng(4242), 5));
  });

  test("two environments of one seed do not share a stream", () => {
    const first = createWendooEnvironment({ modules: [coreModule()], rng: new Rng(31) });
    const second = createWendooEnvironment({ modules: [coreModule()], rng: new Rng(31) });

    randomBuiltinDraws(first, 10);

    assert.deepEqual(randomBuiltinDraws(second, 4), draws(new Rng(31), 4));
  });

  test("rounds its draw to the environment's number precision", () => {
    const environment = createWendooEnvironment({
      modules: [coreModule()],
      rng: new Rng(4242),
      numerics: createProfileNumerics("f32"),
    });

    assert.deepEqual(
      randomBuiltinDraws(environment, 5),
      draws(new Rng(4242), 5).map((value) => MathOps.fround(value))
    );
  });
});
