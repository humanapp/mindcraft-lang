import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { migrateBrainKeyNamespaces } from "./key-namespace-migration.js";

const NS = "p1";
const OLD_STRUCT = "struct:</gamepad/position.ts::Position>";
const NEW_STRUCT = `struct:<${NS}:/gamepad/position.ts::Position>`;

interface PlainRule {
  version: number;
  when: string[];
  do: string[];
  children: PlainRule[];
}

function rule(when: string[], doTiles: string[]): PlainRule {
  return { version: 1, when, do: doTiles, children: [] };
}

function brain(catalog: unknown[], rules: PlainRule[]): Record<string, unknown> {
  return {
    version: 1,
    id: "brain00000000001",
    name: "Test Brain",
    catalog,
    pages: [{ version: 2, pageId: "page000000000001", name: "Page 1", rules }],
  };
}

describe("migrateBrainKeyNamespaces", () => {
  test("prefixes every old-shape user reference with the project namespace", () => {
    const json = brain(
      [
        {
          version: 1,
          kind: "variable",
          tileId: "tile.var->posvar0000000001",
          varName: "pos",
          varType: OLD_STRUCT,
          uniqueId: "posvar0000000001",
        },
        {
          version: 2,
          kind: "literal",
          tileId: "tile.literal->enum:</colors.ts::Color>->red",
          valueType: "enum:</colors.ts::Color>",
          value: "red",
          valueLabel: "red",
          displayFormat: "default",
        },
        {
          version: 1,
          kind: "missing",
          tileId: "tile.actuator->user.actuator.steerActuator123",
          originalKind: "actuator",
          label: "steer",
        },
      ],
      [
        rule(
          ["tile.sensor->user.sensor.stickSensor12345", `tile.accessor->${OLD_STRUCT}->x`],
          [
            "tile.actuator->user.actuator.steerActuator123",
            "tile.modifier->user.steerActuator123.hold",
            "tile.parameter->user.steerActuator123.speed",
            "tile.literal->number:<number>->50",
            `tile.var.factory->${OLD_STRUCT}`,
            `tile.out->${OLD_STRUCT}.stick`,
          ]
        ),
      ]
    );

    const report = migrateBrainKeyNamespaces(json, NS);

    assert.equal(report.changed, true);
    assert.deepEqual(report.unknownKeys, []);

    const catalog = json.catalog as Array<Record<string, unknown>>;
    assert.equal(catalog[0].varType, NEW_STRUCT);
    assert.equal(catalog[1].tileId, `tile.literal->enum:<${NS}:/colors.ts::Color>->red`);
    assert.equal(catalog[1].valueType, `enum:<${NS}:/colors.ts::Color>`);
    assert.equal(catalog[2].tileId, `tile.actuator->${NS}:user.actuator.steerActuator123`);

    const migratedRule = (json.pages as Array<{ rules: PlainRule[] }>)[0].rules[0];
    assert.deepEqual(migratedRule.when, [
      `tile.sensor->${NS}:user.sensor.stickSensor12345`,
      `tile.accessor->${NEW_STRUCT}->x`,
    ]);
    assert.deepEqual(migratedRule.do, [
      `tile.actuator->${NS}:user.actuator.steerActuator123`,
      `tile.modifier->${NS}:user.steerActuator123.hold`,
      `tile.parameter->${NS}:user.steerActuator123.speed`,
      "tile.literal->number:<number>->50",
      `tile.var.factory->${NEW_STRUCT}`,
      `tile.out->${NEW_STRUCT}.stick`,
    ]);
  });

  test("a platform-only brain passes through byte-identical", () => {
    const json = brain(
      [
        {
          version: 2,
          kind: "literal",
          tileId: "tile.literal->number:<number>->7",
          valueType: "number:<number>",
          value: 7,
          valueLabel: "7",
          displayFormat: "default",
        },
        {
          version: 2,
          kind: "page",
          tileId: "tile.page->page000000000001",
          pageId: "page000000000001",
          label: "Page 1",
        },
      ],
      [
        rule(
          ["tile.sensor->microbit-v2.button-a"],
          [
            "tile.actuator->microbit-v2.display-scroll",
            "tile.modifier->modifier.speed.slowly",
            "tile.parameter->anon.number",
            "tile.parameter->parameter.shared-count",
            "tile.op->assign",
            "tile.var->uid0000000000001",
            "tile.var.factory->number.list",
            "tile.out->number:<number>.strength",
            "tile.cf->group",
          ]
        ),
      ]
    );
    const before = JSON.stringify(json);

    const report = migrateBrainKeyNamespaces(json, NS);

    assert.equal(report.changed, false);
    assert.deepEqual(report.unknownKeys, []);
    assert.equal(JSON.stringify(json), before);
  });

  test("running the migration twice is a no-op", () => {
    const json = brain([], [rule(["tile.sensor->user.sensor.stickSensor12345"], [`tile.accessor->${OLD_STRUCT}->x`])]);

    const first = migrateBrainKeyNamespaces(json, NS);
    assert.equal(first.changed, true);
    const afterFirst = JSON.stringify(json);

    const second = migrateBrainKeyNamespaces(json, NS);
    assert.equal(second.changed, false);
    assert.deepEqual(second.unknownKeys, []);
    assert.equal(JSON.stringify(json), afterFirst);
  });

  test("already-namespaced references are never re-prefixed", () => {
    const json = brain(
      [
        {
          version: 1,
          kind: "variable",
          tileId: "tile.var->posvar0000000001",
          varName: "pos",
          varType: NEW_STRUCT,
          uniqueId: "posvar0000000001",
        },
      ],
      [rule([`tile.sensor->${NS}:user.sensor.stickSensor12345`], [`tile.accessor->${NEW_STRUCT}->x`])]
    );
    const before = JSON.stringify(json);

    const report = migrateBrainKeyNamespaces(json, NS);

    assert.equal(report.changed, false);
    assert.deepEqual(report.unknownKeys, []);
    assert.equal(JSON.stringify(json), before);
  });

  test("unclassifiable user-marked strings are left untouched and reported", () => {
    const json = brain(
      [],
      [
        rule(
          ["tile.widget->user.mystery", "/weird.ts::Thing"],
          ["tile.accessor->broken::name", "tile.sensor->user.sensor.stickSensor12345"]
        ),
      ]
    );

    const report = migrateBrainKeyNamespaces(json, NS);

    assert.equal(report.changed, true);
    assert.deepEqual([...report.unknownKeys].sort(), [
      "/weird.ts::Thing",
      "tile.accessor->broken::name",
      "tile.widget->user.mystery",
    ]);
    const migratedRule = (json.pages as Array<{ rules: PlainRule[] }>)[0].rules[0];
    assert.deepEqual(migratedRule.when, ["tile.widget->user.mystery", "/weird.ts::Thing"]);
    assert.deepEqual(migratedRule.do, [
      "tile.accessor->broken::name",
      `tile.sensor->${NS}:user.sensor.stickSensor12345`,
    ]);
  });
});
