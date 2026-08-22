// Tests that each lowering diagnostic is emitted for a minimal triggering fixture.

import { describe, test } from "node:test";
import { compileTileDiagnostics } from "../testsupport/compile-tile.js";
import { expectDiagnostic } from "../testsupport/diag-coverage.js";
import { LoweringDiagCode } from "./diag-codes.js";

describe("lowering diagnostics: list and array operations", () => {
  test("ArrayFromNonListSource: Array.from over a non-list value", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const xs: string[] = Array.from("abc");
    return xs.length;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.ArrayFromNonListSource);
  });

  test("CannotDetermineArrayFromResultListType: Array.from mapping to object elements", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const src: number[] = [1, 2, 3];
    const xs = Array.from(src, (n) => ({ v: n }));
    return xs.length;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.CannotDetermineArrayFromResultListType);
  });

  test("CannotDetermineListType: array literal of object elements", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const xs = [{ a: 1 }];
    return xs.length;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.CannotDetermineListType);
  });

  test("CannotDetermineMapResultListType: .map() callback returning `any`", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const arr = [1, 2, 3];
    const r = arr.map((x): any => x);
    return r.length;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.CannotDetermineMapResultListType);
  });

  test("CannotResolveOperatorForArrayMethod: .includes() over a struct array", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

class P {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
}

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const arr = [new P(1), new P(2)];
    const found = arr.includes(new P(1));
    return found ? 1 : 0;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.CannotResolveOperatorForArrayMethod);
  });

  test("ElementAccessOnNonListType: indexing an `any` value", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const v: any = 5;
    return v[0];
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.ElementAccessOnNonListType);
  });

  test("ElementAccessAssignOnNonListType: index-assign to an `any` value", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const v: any = 5;
    v[0] = 1;
    return 0;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.ElementAccessAssignOnNonListType);
  });

  test("EveryRequiresOneArg: .every() called with two arguments", () => {
    const source = `
import { Sensor, type Context, type AnyList } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): boolean {
    const nums: AnyList = [1, 2, 3];
    return nums.every(() => true, {});
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.EveryRequiresOneArg);
  });

  test("FilterRequiresOneArg: .filter() called with two arguments", () => {
    const source = `
import { Sensor, type Context, type AnyList } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): AnyList {
    const nums: AnyList = [1, 2, 3];
    return nums.filter(() => true, {});
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.FilterRequiresOneArg);
  });

  test("FindIndexRequiresOneArg: .findIndex() called with two arguments", () => {
    const source = `
import { Sensor, type Context, type AnyList } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const nums: AnyList = [1, 2, 3];
    return nums.findIndex(() => true, {});
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.FindIndexRequiresOneArg);
  });

  test("FindRequiresOneArg: .find() called with two arguments (thisArg)", () => {
    const source = `
import { Sensor, type Context, type AnyList } from "wendoo";

export default Sensor({
  name: "find-two-args",
  onExecute(ctx: Context): number {
    const nums: AnyList = [1, 2, 3];
    nums.find((x): boolean => x === 1, nums);
    return 0;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.FindRequiresOneArg);
  });

  test("ForEachRequiresOneArg: .forEach() called with two arguments (thisArg)", () => {
    const source = `
import { Sensor, type Context, type AnyList } from "wendoo";

export default Sensor({
  name: "foreach-two-args",
  onExecute(ctx: Context): number {
    const nums: AnyList = [1, 2, 3];
    nums.forEach((x): void => {}, nums);
    return 0;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.ForEachRequiresOneArg);
  });

  test("IncludesRequiresOneArg: .includes() with two arguments", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const nums: number[] = [10, 20, 30];
    return nums.includes(20, 1) ? 1 : 0;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.IncludesRequiresOneArg);
  });

  test("IndexOfRequiresOneArg: .indexOf() with two arguments", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const nums: number[] = [10, 20, 30];
    return nums.indexOf(20, 1);
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.IndexOfRequiresOneArg);
  });

  test("LastIndexOfRequiresOneArg: .lastIndexOf() with two arguments", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const nums: number[] = [10, 20, 30];
    return nums.lastIndexOf(20, 2);
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.LastIndexOfRequiresOneArg);
  });

  test("MapRequiresOneArg: .map() called with two arguments", () => {
    // The ambient `.map(callbackfn, thisArg?)` signature makes the second
    // argument optional, so TypeScript accepts two args; lowering requires one.
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const arr: number[] = [1, 2, 3];
    const out: number[] = arr.map((x) => x + 1, arr);
    return out.length;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.MapRequiresOneArg);
  });

  test("PushRequiresOneArg: `.push()` called with zero arguments", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const a: number[] = [1, 2];
    a.push();
    return a.length;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.PushRequiresOneArg);
  });

  test("ReverseTakesNoArgs: .reverse() with a spread argument", () => {
    expectDiagnostic(
      compileTileDiagnostics(`
import { Sensor, type Context } from "wendoo";
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const nums = [1, 2, 3];
    const src = [1, 2, 3];
    nums.reverse(...(src as unknown as []));
    return nums[0];
  },
});
`),
      LoweringDiagCode.ReverseTakesNoArgs
    );
  });

  test("ShiftTakesNoArgs: .shift() with a spread argument", () => {
    expectDiagnostic(
      compileTileDiagnostics(`
import { Sensor, type Context } from "wendoo";
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const nums = [1, 2, 3];
    const src = [1, 2, 3];
    const v = nums.shift(...(src as unknown as []));
    return v ?? 0;
  },
});
`),
      LoweringDiagCode.ShiftTakesNoArgs
    );
  });

  test("SomeRequiresOneArg: .some() called with two arguments", () => {
    expectDiagnostic(
      compileTileDiagnostics(`
import { Sensor, type Context } from "wendoo";
export default Sensor({
  name: "t",
  onExecute(ctx: Context): boolean {
    const nums = [1, 2, 3];
    return nums.some((x: number): boolean => x > 1, undefined);
  },
});
`),
      LoweringDiagCode.SomeRequiresOneArg
    );
  });

  test("SliceTakesAtMostTwoArgs: .slice() with a trailing spread argument", () => {
    expectDiagnostic(
      compileTileDiagnostics(`
import { Sensor, type Context } from "wendoo";
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const nums = [1, 2, 3];
    const src = [1, 2, 3];
    const r = nums.slice(0, 1, ...(src as unknown as []));
    return r[0];
  },
});
`),
      LoweringDiagCode.SliceTakesAtMostTwoArgs
    );
  });

  test("UnshiftRequiresOneArg: .unshift() with two arguments", () => {
    const source = `
import { Sensor, type Context, type AnyList } from "wendoo";
export default Sensor({
  name: "t",
  onExecute(ctx: Context): AnyList {
    const nums: AnyList = [1, 2];
    nums.unshift(3, 4);
    return nums;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.UnshiftRequiresOneArg);
  });
});

describe("lowering diagnostics: map literals and constructors", () => {
  test("MapConstructorBadArgument: constructor argument is not an array literal", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const entries: [string, number][] = [["a", 1]];
    const m = new Map<string, number>(entries);
    return m.size;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.MapConstructorBadArgument);
  });

  test("MapConstructorUnresolvableType: new Map with unresolvable value type", () => {
    // `new Map<K, V>()` typechecks for any K/V, but a `symbol` value type has
    // no VM type id, so lowering cannot resolve the map type.
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const m = new Map<string, symbol>();
    return m.size;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.MapConstructorUnresolvableType);
  });

  test("UnsupportedPropertyInMapLiteral: getter in a map literal", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const m: { [k: string]: number } = { get foo() { return 1; } };
    return m.foo;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.UnsupportedPropertyInMapLiteral);
  });

  test("UnsupportedPropertyNameInMapLiteral: computed property name in a map literal", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const m: { [k: string]: number } = { ["foo"]: 1 };
    return m.foo;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.UnsupportedPropertyNameInMapLiteral);
  });
});

describe("lowering diagnostics: object literals", () => {
  test("ObjectLiteralTypeUnresolvable: object literal typed as `any`", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const x: any = { a: 1 };
    return 0;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.ObjectLiteralTypeUnresolvable);
  });

  test("UnsupportedPropertyInObjectLiteral: getter in an object literal", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
interface Point { x: number; y: number; }
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const p: Point = { get x() { return 1; }, y: 2 };
    return p.x + p.y;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.UnsupportedPropertyInObjectLiteral);
  });

  test("UnsupportedPropertyNameInObjectLiteral: computed property name in an object literal", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
interface Point { x: number; y: number; }
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const p: Point = { ["x"]: 10, ["y"]: 20 };
    return p.x + p.y;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.UnsupportedPropertyNameInObjectLiteral);
  });
});

describe("lowering diagnostics: operators, conversions, and assignments", () => {
  test("CannotDetermineTypesForBinaryOp: binary op on `any` operands", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const a: any = 1;
    const b: any = 2;
    const c = a - b;
    return 0;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.CannotDetermineTypesForBinaryOp);
  });

  test("CannotDetermineTypesForCompoundAssign: compound assign on `any`", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    let a: any = 1;
    a += 2;
    return 0;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.CannotDetermineTypesForCompoundAssign);
  });

  test("CannotDetermineTypeForNotOperand: `!` on an `any` operand", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const a: any = 1;
    const b = !a;
    return b ? 1 : 0;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.CannotDetermineTypeForNotOperand);
  });

  test("CompoundAssignRequiresGetterAndSetter: compound assign to a setter-only property", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

class C {
  _v: number = 0;
  set val(x: number) { this._v = x; }
}

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const c = new C();
    c.val += 1;
    return 0;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.CompoundAssignRequiresGetterAndSetter);
  });

  test("IncrDecrTargetNotVariable: increment on element access", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const nums: number[] = [10, 20, 30];
    nums[0]++;
    return nums[0];
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.IncrDecrTargetNotVariable);
  });

  test("UnsupportedOperator: unsigned right shift", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const a = 5;
    const b = 1;
    return a >>> b;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.UnsupportedOperator);
  });

  test("UnsupportedPrefixOperator: unary plus", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const a = 5;
    return +a;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.UnsupportedPrefixOperator);
  });

  test("UnsupportedCompoundAssignOperator: logical-or-assign on element access", () => {
    const source = `
import { Sensor, type Context, type AnyList } from "wendoo";
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const nums: AnyList = [1, 2, 3];
    nums[0] ||= 5;
    return 0;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.UnsupportedCompoundAssignOperator);
  });

  test("UnsupportedPropertyAccess: property access on the argument bag", () => {
    const source = `
import { Sensor, param, type Context } from "wendoo";

export default Sensor({
  name: "t",
  args: [
    param("speed", { type: "number" }),
  ],
  onExecute(ctx: Context, args: { speed: number }): number {
    const bag = args;
    return bag.speed;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.UnsupportedPropertyAccess);
  });
});

describe("lowering diagnostics: control flow", () => {
  test("ForOfOnNonListType: for...of over a string", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "forof-string",
  onExecute(ctx: Context): number {
    let count = 0;
    for (const ch of "abc") {
      count = count + 1;
    }
    return count;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.ForOfOnNonListType);
  });

  test("ForOfRequiresSingleIdentifier: for...of with array destructuring binding", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "forof-destructure",
  onExecute(ctx: Context): number {
    const rows: number[][] = [[1, 2], [3, 4]];
    for (const [a, b] of rows) {
    }
    return 0;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.ForOfRequiresSingleIdentifier);
  });

  test("ForInRequiresVariableDeclaration: for...in with pre-declared binding", () => {
    const source = `
import { Sensor, type Context, type AnyList } from "wendoo";

export default Sensor({
  name: "forin-predeclared",
  onExecute(ctx: Context): number {
    const nums: AnyList = [1, 2, 3];
    let key = "";
    for (key in nums) {
    }
    return 0;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.ForInRequiresVariableDeclaration);
  });

  test("ForOfRequiresVariableDeclaration: for...of with pre-declared binding", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "forof-predeclared",
  onExecute(ctx: Context): number {
    const nums: number[] = [1, 2, 3];
    let item = 0;
    for (item of nums) {
    }
    return 0;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.ForOfRequiresVariableDeclaration);
  });
});

describe("lowering diagnostics: destructuring, spread, and rest", () => {
  test("CannotResolveRestParamListType: rest parameter typed `any[]`", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

function f(...args: any[]): number {
  return args.length;
}

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    return f(1, 2, 3);
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.CannotResolveRestParamListType);
  });

  test("SpreadMustBeLastArgument: spread argument followed by a positional argument", () => {
    expectDiagnostic(
      compileTileDiagnostics(`
import { Sensor, type Context } from "wendoo";
function sumAll(...xs: number[]): number {
  let s = 0;
  for (const x of xs) {
    s = s + x;
  }
  return s;
}
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const args = [1, 2];
    return sumAll(...(args as unknown as number[]), 3);
  },
});
`),
      LoweringDiagCode.SpreadMustBeLastArgument
    );
  });

  test("SpreadRequiresRestTarget: spread into a callee without a rest parameter", () => {
    expectDiagnostic(
      compileTileDiagnostics(`
import { Sensor, type Context } from "wendoo";
function addTwo(a: number, b: number): number {
  return a + b;
}
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const args = [1, 2];
    return addTwo(...(args as unknown as [number, number]));
  },
});
`),
      LoweringDiagCode.SpreadRequiresRestTarget
    );
  });

  test("SpreadSourceUnresolvable: object spread of an unresolvable source", () => {
    expectDiagnostic(
      compileTileDiagnostics(`
import { Sensor, type Context } from "wendoo";
interface Point { x: number; y: number; }
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const empty = {} as unknown as {};
    const p: Point = { x: 1, y: 2, ...empty };
    return p.x;
  },
});
`),
      LoweringDiagCode.SpreadSourceUnresolvable
    );
  });
});

describe("lowering diagnostics: classes, structs, and constructors", () => {
  test("ComputedClassMemberNameNotSupported: class member with a computed name", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

class C {
  ["foo"]: number = 1;
  m(): number { return this["foo"]; }
}

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const c = new C();
    return c.m();
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.ComputedClassMemberNameNotSupported);
  });

  test("NewExpressionNotIdentifier: new via a property-access target", () => {
    // `new ns.Foo()` is valid TypeScript, but lowering only supports a bare
    // identifier as the new target.
    const source = `
import { Sensor, type Context } from "wendoo";

class Foo {
  value: number;
  constructor() {
    this.value = 1;
  }
}
const ns = { Foo };

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const f = new ns.Foo();
    return f.value;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.NewExpressionNotIdentifier);
  });

  test("NewExpressionUnknownClass: new on a locally-declared class", () => {
    // A class declared inside the function body typechecks and is constructable,
    // but lowering only collects module-level class declarations, so its
    // constructor is not in the function table.
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    class C {
      value: number = 1;
    }
    const c = new C();
    return c.value;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.NewExpressionUnknownClass);
  });

  test("NoSuchStaticMember: static member declared with a computed name", () => {
    // TypeScript resolves `Foo.count` to the computed-name static field, but
    // lowering only collects identifier-named static members, so it sees no
    // such static member.
    const source = `
import { Sensor, type Context } from "wendoo";

class Foo {
  static ["count"]: number = 0;
  value: number;
  constructor() {
    this.value = 1;
  }
}

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    return Foo.count;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.NoSuchStaticMember);
  });

  test("PropertyNotOnStruct: accessing a constructor parameter property", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
class Pt {
  constructor(public a: number) {}
}
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const p = new Pt(3);
    return p.a;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.PropertyNotOnStruct);
  });

  test("ThisOutsideClassContext: `this` referenced in a tile body", () => {
    expectDiagnostic(
      compileTileDiagnostics(`
import { Sensor, type Context } from "wendoo";
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const self = this;
    return self ? 1 : 0;
  },
});
`),
      LoweringDiagCode.ThisOutsideClassContext
    );
  });

  test("UnresolvableInterfaceFieldType: interface field typed `symbol`", () => {
    expectDiagnostic(
      compileTileDiagnostics(`
import { Sensor, type Context } from "wendoo";
interface HasSym { s: symbol; }
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`),
      LoweringDiagCode.UnresolvableInterfaceFieldType
    );
  });

  test("StructurallyIncompatibleTypes: assigning between structurally incompatible interfaces", () => {
    expectDiagnostic(
      compileTileDiagnostics(`
import { Sensor, type Context } from "wendoo";
interface A { x?: number; }
interface B { x: number; }
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const b: B = { x: 1 };
    const a: A = b;
    return a.x ?? 0;
  },
});
`),
      LoweringDiagCode.StructurallyIncompatibleTypes
    );
  });
});

describe("lowering diagnostics: tile structure and outputs", () => {
  test("FunctionHasNoBody: overload signature has no body", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

function twice(x: number): number;
function twice(x: number): number {
  return x + x;
}

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    return twice(2);
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.FunctionHasNoBody);
  });

  test("OnExecuteHasNoBody: onExecute as an arrow with an expression body", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
export default Sensor({
  name: "t",
  onExecute: (ctx: Context): number => 1,
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.OnExecuteHasNoBody);
  });

  test("OnPageEnteredHasNoBody: onPageEntered as an arrow with an expression body", () => {
    const source = `
import { Actuator, type Context } from "wendoo";
export default Actuator({
  name: "t",
  onExecute(ctx: Context): void {},
  onPageEntered: (ctx: Context) => 1,
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.OnPageEnteredHasNoBody);
  });

  test("SetOutputWrongArgCount: setOutput() with a trailing spread argument", () => {
    expectDiagnostic(
      compileTileDiagnostics(`
import { Sensor, setOutput, type Context } from "wendoo";
export default Sensor({
  name: "t",
  outputs: [{ name: "o", type: "number" }],
  onExecute(ctx: Context): number {
    const src = [1, 2, 3];
    setOutput(ctx, "o", 5, ...(src as unknown as []));
    return 0;
  },
});
`),
      LoweringDiagCode.SetOutputWrongArgCount
    );
  });

  test("SystemStateNotObject: reading a System member off a non-object state", () => {
    expectDiagnostic(
      compileTileDiagnostics(`
import { System, Sensor, type Context } from "wendoo";
const state = { count: 0 };
const S = System({ name: "s", state, think() {} });
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    return S.count;
  },
});
`),
      LoweringDiagCode.SystemStateNotObject
    );
  });
});

describe("lowering diagnostics: statements, expressions, and references", () => {
  test("UndefinedVariable: reference to an undefined global", () => {
    expectDiagnostic(
      compileTileDiagnostics(`
import { Sensor, type Context } from "wendoo";
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    return NaN;
  },
});
`),
      LoweringDiagCode.UndefinedVariable
    );
  });

  test("UnsupportedStatement: throw statement", () => {
    const source = `
import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    throw "boom";
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.UnsupportedStatement);
  });

  test("UnsupportedExpression: void expression", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const x = void 0;
    return 0;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.UnsupportedExpression);
  });

  test("UnsupportedFunctionCall: static function-typed field called as a method", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
class Helper {
  static fn: () => number = (): number => 5;
}
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    return Helper.fn();
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.UnsupportedFunctionCall);
  });

  test("UnsupportedBindingPattern: numeric-literal property name in destructuring", () => {
    const source = `
import { Sensor, type Context } from "wendoo";
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const obj = { 0: 5 };
    const { 0: renamed } = obj;
    return 0;
  },
});
`;
    expectDiagnostic(compileTileDiagnostics(source), LoweringDiagCode.UnsupportedBindingPattern);
  });

  test("StringMethodWrongArgCount: string method called with a spread argument", () => {
    expectDiagnostic(
      compileTileDiagnostics(`
import { Sensor, type Context } from "wendoo";
export default Sensor({
  name: "t",
  onExecute(ctx: Context): number {
    const s = "hello";
    const src = [1];
    const u = s.toLowerCase(...(src as unknown as []));
    return u.length;
  },
});
`),
      LoweringDiagCode.StringMethodWrongArgCount
    );
  });
});
