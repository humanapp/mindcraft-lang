import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTUATOR_SCAFFOLD, findUniqueFolderName, SENSOR_SCAFFOLD } from "./tile-scaffold";

describe("findUniqueFolderName", () => {
  it("uses the base name when free and counts up from 2 on collisions", () => {
    assert.equal(findUniqueFolderName("my-sensor", new Set()), "my-sensor");
    assert.equal(findUniqueFolderName("my-sensor", new Set(["my-sensor"])), "my-sensor-2");
    assert.equal(findUniqueFolderName("my-sensor", new Set(["my-sensor", "my-sensor-2"])), "my-sensor-3");
  });
});

describe("tile scaffolds", () => {
  it("declare a default-exported tile matching their base name kind", () => {
    assert.equal(SENSOR_SCAFFOLD.baseName, "my-sensor");
    assert.match(SENSOR_SCAFFOLD.content, /export default Sensor\(/);
    assert.equal(ACTUATOR_SCAFFOLD.baseName, "my-actuator");
    assert.match(ACTUATOR_SCAFFOLD.content, /export default Actuator\(/);
  });
});
