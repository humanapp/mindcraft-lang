import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ADAPTER_CONTRACT_VERSION, AdapterNonconformanceCode } from "../target/adapter.js";
import { createTargetAdapter, FAKE_INPUT_KIND, FAKE_SUBJECT, FAKE_TARGET_IDENTITY } from "../testing/index.js";
import { proposeEdit } from "../tools/propose-edit.js";
import type { AuthoringWorkspace } from "../tools/workspace.js";
import { createAuthoringWorkspace } from "../tools/workspace.js";
import { ConformanceCheckCode, checkAdapterConformance, checkArtifactLoads } from "./conformance.js";
import { ScenarioRejection, ScenarioRejectionCode } from "./rehearsal-adapter.js";

/** The built artifact the fake adapter is published from. */
const artifactUrl = new URL("../../dist/testing/fake-adapter.js", import.meta.url);

/** A workspace carrying one rule that senses the signal and emits. */
function authoredWorkspace(): AuthoringWorkspace {
  const workspace = createAuthoringWorkspace(createTargetAdapter(), "conformance brain");
  proposeEdit(workspace, {
    op: "placeTiles",
    ruleId: "0/0",
    side: "when",
    tileIds: ["tile.sensor->sensor.fake.signal"],
  });
  proposeEdit(workspace, {
    op: "placeTiles",
    ruleId: "0/0",
    side: "do",
    tileIds: ["tile.actuator->actuator.fake.emit", "tile.modifier->modifier:fake.loudly"],
  });
  return workspace;
}

/** The check `code` reports, asserted present. */
function checkOf(checks: readonly { code: string; ok: boolean; detail: string }[], code: string) {
  const check = checks.find((candidate) => candidate.code === code);
  assert.ok(check, `the report carries a ${code} check`);
  return check;
}

describe("the conformance suite", () => {
  test("passes an adapter built on the kit", async () => {
    const workspace = authoredWorkspace();

    const report = await checkAdapterConformance({
      adapter: workspace.adapter,
      brainDef: workspace.brainDef,
      scenario: { seed: 20260805, subject: FAKE_SUBJECT },
      thinks: 120,
    });

    assert.equal(report.ok, true, JSON.stringify(report.checks));
    for (const code of [
      ConformanceCheckCode.Determinism,
      ConformanceCheckCode.Boundedness,
      ConformanceCheckCode.GateEvents,
    ]) {
      assert.equal(checkOf(report.checks, code).ok, true, code);
    }
  });

  test("loads the built artifact in a fresh Node process", async () => {
    const check = await checkArtifactLoads(artifactUrl, { targetIdentity: FAKE_TARGET_IDENTITY });

    assert.equal(check.ok, true, check.detail);
    assert.equal(check.code, ConformanceCheckCode.HeadlessPurity);
  });

  test("reports an artifact reporting a target identity the entry does not expect", async () => {
    const check = await checkArtifactLoads(artifactUrl, { targetIdentity: "example-org/trg-other" });

    assert.equal(check.ok, false);
    assert.match(check.detail, new RegExp(AdapterNonconformanceCode.IdentityMismatch));
  });
});

describe("an adapter built on the kit", () => {
  test("reports the contract version it was built against", () => {
    assert.equal(createTargetAdapter().contractVersion, ADAPTER_CONTRACT_VERSION);
  });

  test("refuses a subject it does not offer", async () => {
    const workspace = authoredWorkspace();

    await assert.rejects(
      workspace.adapter.run({
        brainDef: workspace.brainDef,
        scenario: { seed: 1, subject: "nobody" },
        thinks: 4,
      }),
      (error: unknown) => error instanceof ScenarioRejection && error.code === ScenarioRejectionCode.UnknownSubject
    );
  });

  test("registers the input kinds its driver declares, each with what a level of it means", () => {
    const kinds = createTargetAdapter().inputKinds();

    assert.deepEqual(
      kinds.map((kind) => kind.name),
      [FAKE_INPUT_KIND]
    );
    for (const kind of kinds) assert.ok(kind.description.length > 0, kind.name);
  });

  test("delivers a scripted input to the world, holding its level until the next entry", async () => {
    const workspace = authoredWorkspace();
    const request = {
      brainDef: workspace.brainDef,
      scenario: {
        seed: 20260805,
        subject: FAKE_SUBJECT,
        inputs: [
          { kind: FAKE_INPUT_KIND, at: 0, value: true },
          { kind: FAKE_INPUT_KIND, at: 6, value: false },
        ],
      },
      thinks: 12,
    };

    const run = await workspace.adapter.run(request);

    const fired = run.observations.map((think) => think.gates.some((gate) => gate.fired));
    assert.deepEqual(fired, [true, true, true, true, true, true, false, false, false, false, false, false]);
  });

  test("refuses a scripted input of a kind its driver does not register", async () => {
    const workspace = authoredWorkspace();

    await assert.rejects(
      workspace.adapter.run({
        brainDef: workspace.brainDef,
        scenario: { seed: 1, subject: FAKE_SUBJECT, inputs: [{ kind: "no-such-kind", at: 0, value: true }] },
        thinks: 4,
      }),
      (error: unknown) => error instanceof ScenarioRejection && error.code === ScenarioRejectionCode.UnknownInputKind
    );
  });
});
