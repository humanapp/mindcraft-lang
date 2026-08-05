import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PROJECT_ACTIONS } from "./projectActions";

describe("PROJECT_ACTIONS", () => {
  it("launches the desktop commands in order", () => {
    assert.deepStrictEqual(
      PROJECT_ACTIONS.map((action) => action.commandId),
      [
        "mindcraft.createSensor",
        "mindcraft.createActuator",
        "mindcraft.importProject",
        "mindcraft.openEditor",
        "mindcraft.openSettings",
      ]
    );
  });

  it("assigns each action its codicon", () => {
    assert.deepStrictEqual(
      PROJECT_ACTIONS.map((action) => action.icon),
      ["eye", "zap", "cloud-download", "window", "settings-gear"]
    );
  });

  it("gives every action a label for its tree item and command title", () => {
    for (const action of PROJECT_ACTIONS) {
      assert.ok(action.label.length > 0);
    }
  });
});
