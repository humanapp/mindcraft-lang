/**
 * Unit tests for ProgramTypeTableBuilder, exercised through ConstantPool (its
 * production host, which delegates addType -> intern, addOther -> internValue,
 * and typeEntries -> entriesList).
 *
 * Covers: atom interning and dedup, children-before-parents ordering for
 * list/map/union/function/nullable entries, registry-canonical union member
 * order, program-local struct maxFieldId (sparse and fieldless), enum symbol
 * order, nested constant-value interning, and the unregistered-typeId throw.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { List } from "@wendoo-lang/core";
import type { BrainServices } from "@wendoo-lang/core/brain";
import { __test__createBrainServices } from "@wendoo-lang/core/brain/__test__";
import { ConstantPool } from "@wendoo-lang/core/brain/compiler";
import type { ITypeRegistry, ProgramTypeEntry, TypeId, UnionTypeDef, Value } from "@wendoo-lang/core/runtime";
import { CoreTypeIds, mkListValue, NativeType } from "@wendoo-lang/core/runtime";

let services: BrainServices;
let registry: ITypeRegistry;

function mkPool(): ConstantPool {
  return new ConstantPool(registry);
}

function entryAt<T extends ProgramTypeEntry["tag"]>(
  pool: ConstantPool,
  idx: number,
  tag: T
): Extract<ProgramTypeEntry, { tag: T }> {
  const entry = pool.typeEntries().at(idx);
  assert.ok(entry, `expected a type entry at index ${idx}`);
  assert.equal(entry.tag, tag);
  return entry as Extract<ProgramTypeEntry, { tag: T }>;
}

describe("ProgramTypeTableBuilder", () => {
  before(() => {
    services = __test__createBrainServices();
    registry = services.runtime.types;
  });

  test("interning a core atom yields one atom entry and dedups on re-intern", () => {
    const pool = mkPool();
    const idx = pool.addType(CoreTypeIds.Number);
    assert.equal(idx, 0);
    assert.equal(pool.typeEntries().size(), 1);

    const entry = entryAt(pool, idx, "atom");
    assert.equal(entry.typeId, CoreTypeIds.Number);
    assert.equal(entry.atomId, registry.get(CoreTypeIds.Number)?.atomId);

    assert.equal(pool.addType(CoreTypeIds.Number), idx);
    assert.equal(pool.typeEntries().size(), 1);
  });

  test("a parameterized list interns its element before itself", () => {
    const pool = mkPool();
    const listTypeId = registry.instantiate("List", List.from([CoreTypeIds.Number]));
    const listIdx = pool.addType(listTypeId);

    const listEntry = entryAt(pool, listIdx, "list");
    assert.equal(listEntry.typeId, listTypeId);
    assert.ok(listEntry.elem < listIdx, "element entry must precede the list entry");

    const elemEntry = entryAt(pool, listEntry.elem, "atom");
    assert.equal(elemEntry.typeId, CoreTypeIds.Number);
  });

  test("a parameterized map interns key and value children", () => {
    const pool = mkPool();
    const mapTypeId = registry.instantiate("Map", List.from([CoreTypeIds.String, CoreTypeIds.Number]));
    const mapIdx = pool.addType(mapTypeId);

    const mapEntry = entryAt(pool, mapIdx, "map");
    assert.equal(mapEntry.typeId, mapTypeId);
    assert.ok(mapEntry.key < mapIdx);
    assert.ok(mapEntry.value < mapIdx);
    assert.equal(entryAt(pool, mapEntry.key, "atom").typeId, CoreTypeIds.String);
    assert.equal(entryAt(pool, mapEntry.value, "atom").typeId, CoreTypeIds.Number);
  });

  test("union members follow the registry's canonical sorted order", () => {
    const pool = mkPool();
    // Members supplied out of sorted order; the registry canonicalizes them.
    const unionTypeId = registry.getOrCreateUnionType(
      List.from([CoreTypeIds.String, CoreTypeIds.Boolean, CoreTypeIds.Number])
    );
    const def = registry.get(unionTypeId) as UnionTypeDef;
    assert.ok(def);
    assert.equal(def.memberTypeIds.size(), 3);

    const unionIdx = pool.addType(unionTypeId);
    const unionEntry = entryAt(pool, unionIdx, "union");
    assert.equal(unionEntry.members.size(), def.memberTypeIds.size());
    for (let i = 0; i < unionEntry.members.size(); i++) {
      const memberIdx = unionEntry.members.get(i);
      assert.ok(memberIdx !== undefined && memberIdx < unionIdx);
      const memberEntry = pool.typeEntries().get(memberIdx);
      assert.equal(memberEntry.typeId, def.memberTypeIds.get(i));
    }
  });

  test("a nullable entry points at its base entry", () => {
    const pool = mkPool();
    const nullableTypeId = registry.addNullableType(CoreTypeIds.Boolean);
    const nullableIdx = pool.addType(nullableTypeId);

    const nullableEntry = entryAt(pool, nullableIdx, "nullable");
    assert.equal(nullableEntry.typeId, nullableTypeId);
    assert.ok(nullableEntry.base < nullableIdx);
    assert.equal(entryAt(pool, nullableEntry.base, "atom").typeId, CoreTypeIds.Boolean);
  });

  test("a function entry carries param and result child indices", () => {
    const pool = mkPool();
    const fnTypeId = registry.getOrCreateFunctionType({
      paramTypeIds: List.from([CoreTypeIds.Number, CoreTypeIds.String]),
      returnTypeId: CoreTypeIds.Boolean,
    });
    const fnIdx = pool.addType(fnTypeId);

    const fnEntry = entryAt(pool, fnIdx, "function");
    assert.equal(fnEntry.typeId, fnTypeId);
    assert.equal(fnEntry.params.size(), 2);
    const param0 = fnEntry.params.get(0);
    const param1 = fnEntry.params.get(1);
    assert.ok(param0 !== undefined && param1 !== undefined);
    assert.equal(entryAt(pool, param0, "atom").typeId, CoreTypeIds.Number);
    assert.equal(entryAt(pool, param1, "atom").typeId, CoreTypeIds.String);
    assert.ok(fnEntry.result < fnIdx);
    assert.equal(entryAt(pool, fnEntry.result, "atom").typeId, CoreTypeIds.Boolean);
  });

  test("a program-local struct carries its name and maxFieldId", () => {
    const pool = mkPool();
    const sparseTypeId = registry.withOwner("dynamic", () =>
      registry.addStructType("/type-table.spec.ts::Sparse", {
        fields: List.from([
          { name: "first", typeId: CoreTypeIds.Number, fieldIndex: 0 },
          { name: "fourth", typeId: CoreTypeIds.Number, fieldIndex: 3 },
        ]),
      })
    );
    const sparseIdx = pool.addType(sparseTypeId);
    const sparseEntry = entryAt(pool, sparseIdx, "struct");
    assert.equal(sparseEntry.typeId, sparseTypeId);
    assert.equal(sparseEntry.name, "/type-table.spec.ts::Sparse");
    assert.equal(sparseEntry.maxFieldId, 3);

    const emptyTypeId = registry.withOwner("dynamic", () =>
      registry.addStructType("/type-table.spec.ts::Fieldless", { fields: List.empty() })
    );
    const emptyIdx = pool.addType(emptyTypeId);
    const emptyEntry = entryAt(pool, emptyIdx, "struct");
    assert.equal(emptyEntry.name, "/type-table.spec.ts::Fieldless");
    assert.equal(emptyEntry.maxFieldId, -1);
  });

  test("a program-local enum carries its symbols in declared order", () => {
    const pool = mkPool();
    const colorTypeId = registry.withOwner("dynamic", () =>
      registry.addEnumType("/type-table.spec.ts::Color", {
        symbols: List.from([
          { key: "Red", label: "Red", value: 0 },
          { key: "Green", label: "Green", value: 1 },
          { key: "Blue", label: "Blue", value: 2 },
        ]),
        defaultKey: "Red",
      })
    );
    const colorIdx = pool.addType(colorTypeId);
    const colorEntry = entryAt(pool, colorIdx, "enum");
    assert.equal(colorEntry.typeId, colorTypeId);
    assert.equal(colorEntry.name, "/type-table.spec.ts::Color");
    assert.deepEqual(colorEntry.symbols.toArray(), [
      { key: "Red", value: 0 },
      { key: "Green", value: 1 },
      { key: "Blue", value: 2 },
    ]);
  });

  test("interning a nested constant value interns every nested typeId", () => {
    const pool = mkPool();
    const flavorTypeId = registry.withOwner("dynamic", () =>
      registry.addEnumType("/type-table.spec.ts::Flavor", {
        symbols: List.from([
          { key: "Sweet", label: "Sweet", value: 0 },
          { key: "Sour", label: "Sour", value: 1 },
        ]),
        defaultKey: "Sweet",
      })
    );
    const flavorListTypeId = registry.instantiate("List", List.from([flavorTypeId]));

    const sweet: Value = { t: NativeType.Enum, typeId: flavorTypeId, v: "Sweet" };
    pool.addOther(mkListValue(flavorListTypeId, List.from([sweet])));

    const interned: TypeId[] = [];
    pool.typeEntries().forEach((entry) => {
      interned.push(entry.typeId);
    });
    assert.ok(interned.includes(flavorListTypeId), "expected the list typeId to be interned");
    assert.ok(interned.includes(flavorTypeId), "expected the nested enum typeId to be interned");
  });

  test("interning an unregistered typeId throws", () => {
    const pool = mkPool();
    assert.throws(() => pool.addType("struct:</type-table.spec.ts::NotRegistered>"), /unregistered type/);
  });
});
