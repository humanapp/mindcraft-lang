import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AssistantStatus, emptySessions, sessionStatus, withSessionStatus } from "./sessions";

describe("where a brain's session stands", () => {
  test("is idle for a brain holding none", () => {
    assert.equal(sessionStatus(emptySessions(), "brain-a"), AssistantStatus.Idle);
  });

  test("is idle where no brain is named at all", () => {
    assert.equal(sessionStatus(emptySessions(), undefined), AssistantStatus.Idle);
  });

  test("is what it was last stood at", () => {
    const sessions = withSessionStatus(emptySessions(), "brain-a", AssistantStatus.Connecting);

    assert.equal(
      sessionStatus(withSessionStatus(sessions, "brain-a", AssistantStatus.Ready), "brain-a"),
      AssistantStatus.Ready
    );
  });
});

describe("standing one brain's session", () => {
  test("leaves every other brain's where it was", () => {
    const both = withSessionStatus(
      withSessionStatus(emptySessions(), "brain-a", AssistantStatus.Ready),
      "brain-b",
      AssistantStatus.TurnActive
    );

    const moved = withSessionStatus(both, "brain-a", AssistantStatus.Failed);

    assert.equal(sessionStatus(moved, "brain-a"), AssistantStatus.Failed);
    assert.equal(sessionStatus(moved, "brain-b"), AssistantStatus.TurnActive);
  });

  test("leaves what it was given untouched", () => {
    const before = withSessionStatus(emptySessions(), "brain-a", AssistantStatus.Ready);

    withSessionStatus(before, "brain-a", AssistantStatus.Failed);

    assert.equal(sessionStatus(before, "brain-a"), AssistantStatus.Ready);
  });
});
