import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AppHostErrorCode, appHostError } from "@wendoo/app-host";
import { toBrainLoadFailure } from "./brain-load-failure";

describe("classifying a failed brain load", () => {
  test("an app-host rejection keeps its stable code and message", () => {
    const failure = toBrainLoadFailure(appHostError(AppHostErrorCode.NO_ACTIVE_PROJECT, "no active project"));

    assert.equal(failure.code, AppHostErrorCode.NO_ACTIVE_PROJECT);
    assert.equal(failure.message, "no active project");
  });

  test("a plain error rejection keeps its message and carries no code", () => {
    const failure = toBrainLoadFailure(new Error("quota exceeded"));

    assert.equal(failure.code, undefined);
    assert.equal(failure.message, "quota exceeded");
  });

  test("a non-error rejection still yields a message", () => {
    const failure = toBrainLoadFailure("thrown string");

    assert.equal(failure.code, undefined);
    assert.equal(failure.message, "thrown string");
  });
});
