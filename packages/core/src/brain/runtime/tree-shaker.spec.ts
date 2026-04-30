import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { Dict, List, UniqueSet } from "@mindcraft-lang/core";
import {
  type BrainServices,
  BYTECODE_VERSION,
  type BytecodeExecutableAction,
  type ExecutableAction,
  type ExecutableBrainProgram,
  type ExecutionContext,
  FALSE_VALUE,
  type FunctionBytecode,
  HandleTable,
  type Instr,
  isFunctionValue,
  mkFunctionValue,
  mkNumberValue,
  mkStringValue,
  NativeType,
  NIL_VALUE,
  Op,
  type PageMetadata,
  TRUE_VALUE,
  UNKNOWN_VALUE,
  type Value,
  VmStatus,
  VOID_VALUE,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { treeshakeProgram, VM } from "@mindcraft-lang/core/brain/runtime";

function mkInstr(op: Op, a?: number, b?: number, c?: number): Instr {
  const ins: Instr = { op };
  if (a !== undefined) ins.a = a;
  if (b !== undefined) ins.b = b;
  if (c !== undefined) ins.c = c;
  return ins;
}

function mkFunc(code: Instr[], numParams = 0, name?: string): FunctionBytecode {
  return { code: List.from(code), numParams, name };
}

function mkPage(pageIndex: number, rootRuleFuncIds: number[]): PageMetadata {
  return {
    pageIndex,
    pageId: `page-${pageIndex}`,
    pageName: `Page ${pageIndex}`,
    rootRuleFuncIds: List.from(rootRuleFuncIds),
    actionCallSites: List.empty(),
    sensors: new UniqueSet(),
    actuators: new UniqueSet(),
  };
}

function mkBytecodeAction(entryFuncId: number, activationFuncId?: number): BytecodeExecutableAction {
  const action: BytecodeExecutableAction = {
    binding: "bytecode",
    descriptor: { key: "test-action", kind: "action" } as never,
    entryFuncId,
    numStateSlots: 0,
  };
  if (activationFuncId !== undefined) {
    action.activationFuncId = activationFuncId;
  }
  return action;
}

function mkProgram(opts: {
  functions: FunctionBytecode[];
  constants?: Value[];
  variableNames?: string[];
  entryPoint?: number;
  pages?: PageMetadata[];
  actions?: ExecutableAction[];
  ruleIndex?: [string, number][];
}): ExecutableBrainProgram {
  return {
    version: BYTECODE_VERSION,
    functions: List.from(opts.functions),
    constants: List.from(opts.constants ?? []),
    variableNames: List.from(opts.variableNames ?? []),
    entryPoint: opts.entryPoint,
    ruleIndex: new Dict(opts.ruleIndex ?? []),
    pages: List.from(opts.pages ?? []),
    actions: List.from(opts.actions ?? []),
  };
}

describe("treeshakeProgram", () => {
  test("program with no dead functions returns unchanged", () => {
    const prog = mkProgram({
      functions: [mkFunc([mkInstr(Op.CALL, 1), mkInstr(Op.RET)], 0, "main"), mkFunc([mkInstr(Op.RET)], 0, "helper")],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result, prog);
  });

  test("unreachable functions are removed", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.RET)], 0, "dead"),
        mkFunc([mkInstr(Op.RET)], 0, "also-dead"),
      ],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.functions.size(), 1);
    assert.equal(result.functions.get(0).name, "main");
    assert.equal(result.entryPoint, 0);
  });

  test("CALL operands are remapped correctly", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.CALL, 2), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.RET)], 0, "dead"),
        mkFunc([mkInstr(Op.RET)], 0, "target"),
      ],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.functions.size(), 2);
    assert.equal(result.functions.get(0).name, "main");
    assert.equal(result.functions.get(1).name, "target");
    const callInstr = result.functions.get(0).code.get(0);
    assert.equal(callInstr.op, Op.CALL);
    assert.equal(callInstr.a, 1);
  });

  test("MAKE_CLOSURE operands are remapped correctly", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.MAKE_CLOSURE, 2, 0), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.RET)], 0, "dead"),
        mkFunc([mkInstr(Op.RET)], 0, "closure-target"),
      ],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.functions.size(), 2);
    const closureInstr = result.functions.get(0).code.get(0);
    assert.equal(closureInstr.op, Op.MAKE_CLOSURE);
    assert.equal(closureInstr.a, 1);
  });

  test("FunctionValue constants have funcIds remapped", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.RET)], 0, "dead"),
        mkFunc([mkInstr(Op.RET)], 0, "const-ref"),
      ],
      constants: [mkFunctionValue(2)],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.functions.size(), 2);
    const constVal = result.constants.get(0);
    assert.ok(isFunctionValue(constVal));
    assert.equal(constVal.funcId, 1);
  });

  test("FunctionValue constants with captures have nested funcIds remapped", () => {
    const innerCapture = mkFunctionValue(3);
    const outerConst = mkFunctionValue(2, List.from<Value>([innerCapture]));
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.RET)], 0, "dead"),
        mkFunc([mkInstr(Op.RET)], 0, "outer"),
        mkFunc([mkInstr(Op.RET)], 0, "inner"),
      ],
      constants: [outerConst],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.functions.size(), 3);
    const remappedConst = result.constants.get(0);
    assert.ok(isFunctionValue(remappedConst));
    assert.equal(remappedConst.funcId, 1);
    assert.ok(remappedConst.captures);
    const capturedVal = remappedConst.captures.get(0);
    assert.ok(isFunctionValue(capturedVal));
    assert.equal(capturedVal.funcId, 2);
  });

  test("rootRuleFuncIds are remapped", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.RET)], 0, "dead"),
        mkFunc([mkInstr(Op.RET)], 0, "rule-a"),
        mkFunc([mkInstr(Op.RET)], 0, "rule-b"),
      ],
      pages: [mkPage(0, [1, 2])],
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.functions.size(), 2);
    assert.equal(result.functions.get(0).name, "rule-a");
    assert.equal(result.functions.get(1).name, "rule-b");
    const page = result.pages.get(0);
    assert.equal(page.rootRuleFuncIds.get(0), 0);
    assert.equal(page.rootRuleFuncIds.get(1), 1);
  });

  test("ruleIndex values are remapped", () => {
    const prog = mkProgram({
      functions: [mkFunc([mkInstr(Op.RET)], 0, "dead"), mkFunc([mkInstr(Op.RET)], 0, "rule-fn")],
      pages: [mkPage(0, [1])],
      ruleIndex: [["0/0", 1]],
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.ruleIndex.get("0/0"), 0);
  });

  test("entryPoint is remapped", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.RET)], 0, "dead-0"),
        mkFunc([mkInstr(Op.RET)], 0, "dead-1"),
        mkFunc([mkInstr(Op.RET)], 0, "entry"),
      ],
      entryPoint: 2,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.functions.size(), 1);
    assert.equal(result.entryPoint, 0);
  });

  test("bytecode action entryFuncId and activationFuncId are remapped", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.RET)], 0, "dead"),
        mkFunc([mkInstr(Op.RET)], 0, "entry-fn"),
        mkFunc([mkInstr(Op.RET)], 0, "activation-fn"),
      ],
      actions: [mkBytecodeAction(1, 2)],
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.functions.size(), 2);
    const action = result.actions.get(0) as BytecodeExecutableAction;
    assert.equal(action.binding, "bytecode");
    assert.equal(action.entryFuncId, 0);
    assert.equal(action.activationFuncId, 1);
  });

  test("function reachable only through FunctionValue constant is retained", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.RET)], 0, "dead"),
        mkFunc([mkInstr(Op.RET)], 0, "only-via-const"),
      ],
      constants: [mkFunctionValue(2)],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.functions.size(), 2);
    assert.equal(result.functions.get(0).name, "main");
    assert.equal(result.functions.get(1).name, "only-via-const");
  });

  test("function reachable only through closure capture chain is retained", () => {
    const deepCapture = mkFunctionValue(3);
    const midCapture = mkFunctionValue(2, List.from<Value>([deepCapture]));
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.RET)], 0, "dead"),
        mkFunc([mkInstr(Op.RET)], 0, "mid"),
        mkFunc([mkInstr(Op.RET)], 0, "deep"),
      ],
      constants: [midCapture],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.functions.size(), 3);
    assert.equal(result.functions.get(0).name, "main");
    assert.equal(result.functions.get(1).name, "mid");
    assert.equal(result.functions.get(2).name, "deep");
  });

  test("non-FunctionValue constants are left untouched", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.PUSH_CONST, 1), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.RET)], 0, "dead"),
      ],
      constants: [mkNumberValue(42), mkStringValue("hello")],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.constants.size(), 2);
    assert.equal(result.constants.get(0).t, NativeType.Number);
    assert.equal(result.constants.get(1).t, NativeType.String);
  });

  test("host actions are preserved as-is", () => {
    const hostAction: ExecutableAction = {
      binding: "host",
      descriptor: { key: "host-action", kind: "action" } as never,
    };
    const prog = mkProgram({
      functions: [mkFunc([mkInstr(Op.RET)], 0, "main")],
      entryPoint: 0,
      actions: [hostAction],
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.actions.get(0).binding, "host");
  });

  test("unreferenced variable names are removed", () => {
    const prog = mkProgram({
      functions: [mkFunc([mkInstr(Op.RET)], 0, "main"), mkFunc([mkInstr(Op.RET)], 0, "dead")],
      variableNames: ["x", "y", "z"],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.variableNames.size(), 0);
  });

  test("transitive call reachability is tracked", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.CALL, 1), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.CALL, 3), mkInstr(Op.RET)], 0, "helper1"),
        mkFunc([mkInstr(Op.RET)], 0, "dead"),
        mkFunc([mkInstr(Op.RET)], 0, "helper2"),
      ],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.functions.size(), 3);
    assert.equal(result.functions.get(0).name, "main");
    assert.equal(result.functions.get(1).name, "helper1");
    assert.equal(result.functions.get(2).name, "helper2");
  });

  test("constants only referenced by dead functions are removed", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.PUSH_CONST, 1), mkInstr(Op.RET)], 0, "dead"),
      ],
      constants: [mkNumberValue(42), mkStringValue("dead-only")],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.functions.size(), 1);
    assert.equal(result.constants.size(), 1);
    assert.equal((result.constants.get(0) as { v: number }).v, 42);
  });

  test("constants referenced by surviving functions are retained", () => {
    const prog = mkProgram({
      functions: [
        mkFunc(
          [mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.PUSH_CONST, 1), mkInstr(Op.PUSH_CONST, 2), mkInstr(Op.RET)],
          0,
          "main"
        ),
      ],
      constants: [mkNumberValue(1), mkNumberValue(2), mkNumberValue(3)],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.constants.size(), 3);
  });

  test("typeId constants referenced via LIST_NEW b are retained", () => {
    const prog = mkProgram({
      functions: [mkFunc([mkInstr(Op.LIST_NEW, 0, 0), mkInstr(Op.RET)], 0, "main")],
      constants: [mkStringValue("List<number>"), mkStringValue("unused-type")],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.constants.size(), 1);
    assert.equal((result.constants.get(0) as { v: string }).v, "List<number>");
  });

  test("typeId constants referenced via STRUCT_NEW b are retained", () => {
    const prog = mkProgram({
      functions: [mkFunc([mkInstr(Op.STRUCT_NEW, 2, 0), mkInstr(Op.RET)], 0, "main")],
      constants: [mkStringValue("MyStruct"), mkStringValue("unused-type")],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.constants.size(), 1);
    assert.equal((result.constants.get(0) as { v: string }).v, "MyStruct");
  });

  test("typeId constants referenced via MAP_NEW b are retained", () => {
    const prog = mkProgram({
      functions: [mkFunc([mkInstr(Op.MAP_NEW, 0, 0), mkInstr(Op.RET)], 0, "main")],
      constants: [mkStringValue("Map<string,number>"), mkStringValue("unused")],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.constants.size(), 1);
  });

  test("typeId constants referenced via STRUCT_COPY_EXCEPT b are retained", () => {
    const prog = mkProgram({
      functions: [mkFunc([mkInstr(Op.STRUCT_COPY_EXCEPT, 1, 0), mkInstr(Op.RET)], 0, "main")],
      constants: [mkStringValue("CopiedStruct"), mkStringValue("unused")],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.constants.size(), 1);
  });

  test("PUSH_CONST operands are remapped after constant shaking", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.PUSH_CONST, 2), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.PUSH_CONST, 1), mkInstr(Op.RET)], 0, "dead"),
      ],
      constants: [mkNumberValue(10), mkNumberValue(20), mkNumberValue(30)],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.functions.size(), 1);
    assert.equal(result.constants.size(), 1);
    assert.equal((result.constants.get(0) as { v: number }).v, 30);
    const pushInstr = result.functions.get(0).code.get(0);
    assert.equal(pushInstr.op, Op.PUSH_CONST);
    assert.equal(pushInstr.a, 0);
  });

  test("LIST_NEW / MAP_NEW / STRUCT_NEW / STRUCT_COPY_EXCEPT b operands are remapped", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.LIST_NEW, 0, 1), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.RET)], 0, "dead"),
      ],
      constants: [mkStringValue("dead-type"), mkStringValue("List<number>")],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.constants.size(), 1);
    assert.equal((result.constants.get(0) as { v: string }).v, "List<number>");
    const listInstr = result.functions.get(0).code.get(0);
    assert.equal(listInstr.op, Op.LIST_NEW);
    assert.equal(listInstr.b, 0);
  });

  test("INSTANCE_OF a operand is remapped after constant shaking", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.INSTANCE_OF, 1), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.RET)], 0, "dead"),
      ],
      constants: [mkStringValue("dead-type"), mkStringValue("MyClass")],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.constants.size(), 1);
    assert.equal((result.constants.get(0) as { v: string }).v, "MyClass");
    const instOfInstr = result.functions.get(0).code.get(0);
    assert.equal(instOfInstr.op, Op.INSTANCE_OF);
    assert.equal(instOfInstr.a, 0);
  });

  test("variable names only referenced by dead functions are removed", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.LOAD_VAR, 0), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.LOAD_VAR, 1), mkInstr(Op.STORE_VAR, 2), mkInstr(Op.RET)], 0, "dead"),
      ],
      variableNames: ["x", "y", "z"],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.functions.size(), 1);
    assert.equal(result.variableNames.size(), 1);
    assert.equal(result.variableNames.get(0), "x");
  });

  test("LOAD_VAR / STORE_VAR operands are remapped", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.LOAD_VAR, 2), mkInstr(Op.STORE_VAR, 2), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.LOAD_VAR, 0), mkInstr(Op.STORE_VAR, 1), mkInstr(Op.RET)], 0, "dead"),
      ],
      variableNames: ["a", "b", "c"],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.variableNames.size(), 1);
    assert.equal(result.variableNames.get(0), "c");
    const loadInstr = result.functions.get(0).code.get(0);
    assert.equal(loadInstr.op, Op.LOAD_VAR);
    assert.equal(loadInstr.a, 0);
    const storeInstr = result.functions.get(0).code.get(1);
    assert.equal(storeInstr.op, Op.STORE_VAR);
    assert.equal(storeInstr.a, 0);
  });

  test("program with no dead constants or variables returns unchanged", () => {
    const prog = mkProgram({
      functions: [
        mkFunc(
          [mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.LOAD_VAR, 0), mkInstr(Op.STORE_VAR, 1), mkInstr(Op.RET)],
          0,
          "main"
        ),
      ],
      constants: [mkNumberValue(42)],
      variableNames: ["x", "y"],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result, prog);
  });

  test("constants and variable names are shaken even when no functions are dead", () => {
    const prog = mkProgram({
      functions: [mkFunc([mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.LOAD_VAR, 0), mkInstr(Op.RET)], 0, "main")],
      constants: [mkNumberValue(1), mkNumberValue(2)],
      variableNames: ["used", "unused"],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.functions.size(), 1);
    assert.equal(result.constants.size(), 1);
    assert.equal(result.variableNames.size(), 1);
    assert.equal(result.variableNames.get(0), "used");
  });

  test("duplicate number constants are collapsed to one", () => {
    const prog = mkProgram({
      functions: [
        mkFunc(
          [mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.PUSH_CONST, 1), mkInstr(Op.PUSH_CONST, 2), mkInstr(Op.RET)],
          0,
          "main"
        ),
      ],
      constants: [mkNumberValue(42), mkNumberValue(42), mkNumberValue(99)],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.constants.size(), 2);
    assert.equal((result.constants.get(0) as { v: number }).v, 42);
    assert.equal((result.constants.get(1) as { v: number }).v, 99);
    const code = result.functions.get(0).code;
    assert.equal(code.get(0).a, 0);
    assert.equal(code.get(1).a, 0);
    assert.equal(code.get(2).a, 1);
  });

  test("duplicate string constants including typeId strings are collapsed", () => {
    const prog = mkProgram({
      functions: [
        mkFunc(
          [mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.PUSH_CONST, 1), mkInstr(Op.LIST_NEW, 0, 2), mkInstr(Op.RET)],
          0,
          "main"
        ),
      ],
      constants: [mkStringValue("hello"), mkStringValue("hello"), mkStringValue("List<number>")],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.constants.size(), 2);
    assert.equal((result.constants.get(0) as { v: string }).v, "hello");
    assert.equal((result.constants.get(1) as { v: string }).v, "List<number>");
    const code = result.functions.get(0).code;
    assert.equal(code.get(0).a, 0);
    assert.equal(code.get(1).a, 0);
    assert.equal(code.get(2).b, 1);
  });

  test("duplicate boolean/nil/void constants are collapsed", () => {
    const prog = mkProgram({
      functions: [
        mkFunc(
          [
            mkInstr(Op.PUSH_CONST, 0),
            mkInstr(Op.PUSH_CONST, 1),
            mkInstr(Op.PUSH_CONST, 2),
            mkInstr(Op.PUSH_CONST, 3),
            mkInstr(Op.PUSH_CONST, 4),
            mkInstr(Op.PUSH_CONST, 5),
            mkInstr(Op.RET),
          ],
          0,
          "main"
        ),
      ],
      constants: [NIL_VALUE, NIL_VALUE, TRUE_VALUE, TRUE_VALUE, VOID_VALUE, VOID_VALUE],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.constants.size(), 3);
    assert.equal(result.constants.get(0).t, NativeType.Nil);
    assert.equal(result.constants.get(1).t, NativeType.Boolean);
    assert.equal(result.constants.get(2).t, NativeType.Void);
    const code = result.functions.get(0).code;
    assert.equal(code.get(0).a, 0);
    assert.equal(code.get(1).a, 0);
    assert.equal(code.get(2).a, 1);
    assert.equal(code.get(3).a, 1);
    assert.equal(code.get(4).a, 2);
    assert.equal(code.get(5).a, 2);
  });

  test("duplicate FunctionValue constants with same funcId and no captures are collapsed", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.PUSH_CONST, 1), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.RET)], 0, "target"),
      ],
      constants: [mkFunctionValue(1), mkFunctionValue(1)],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.constants.size(), 1);
    const fv = result.constants.get(0);
    assert.ok(isFunctionValue(fv));
    assert.equal(fv.funcId, 1);
    const code = result.functions.get(0).code;
    assert.equal(code.get(0).a, 0);
    assert.equal(code.get(1).a, 0);
  });

  test("non-deduplicable complex constants are preserved as separate entries", () => {
    const listVal1: Value = {
      t: NativeType.List,
      typeId: "List<number>" as never,
      v: List.from<Value>([mkNumberValue(1)]),
    };
    const listVal2: Value = {
      t: NativeType.List,
      typeId: "List<number>" as never,
      v: List.from<Value>([mkNumberValue(1)]),
    };
    const prog = mkProgram({
      functions: [mkFunc([mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.PUSH_CONST, 1), mkInstr(Op.RET)], 0, "main")],
      constants: [listVal1, listVal2],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.constants.size(), 2);
  });

  test("all instruction operands referencing deduplicated constant point to surviving entry", () => {
    const prog = mkProgram({
      functions: [
        mkFunc(
          [
            mkInstr(Op.PUSH_CONST, 0),
            mkInstr(Op.PUSH_CONST, 1),
            mkInstr(Op.LIST_NEW, 0, 2),
            mkInstr(Op.STRUCT_NEW, 2, 3),
            mkInstr(Op.INSTANCE_OF, 4),
            mkInstr(Op.RET),
          ],
          0,
          "main"
        ),
      ],
      constants: [
        mkNumberValue(42),
        mkNumberValue(42),
        mkStringValue("MyType"),
        mkStringValue("MyType"),
        mkStringValue("MyType"),
      ],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.constants.size(), 2);
    assert.equal((result.constants.get(0) as { v: number }).v, 42);
    assert.equal((result.constants.get(1) as { v: string }).v, "MyType");
    const code = result.functions.get(0).code;
    assert.equal(code.get(0).a, 0);
    assert.equal(code.get(1).a, 0);
    assert.equal(code.get(2).b, 1);
    assert.equal(code.get(3).b, 1);
    assert.equal(code.get(4).a, 1);
  });

  test("program with no duplicate constants is unchanged", () => {
    const prog = mkProgram({
      functions: [
        mkFunc(
          [mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.PUSH_CONST, 1), mkInstr(Op.PUSH_CONST, 2), mkInstr(Op.RET)],
          0,
          "main"
        ),
      ],
      constants: [mkNumberValue(1), mkStringValue("hello"), mkNumberValue(2)],
      entryPoint: 0,
    });
    const result = treeshakeProgram(prog);
    assert.equal(result.constants.size(), 3);
    assert.equal(result, prog);
  });
});

// -- Integration tests --

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

function mkCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    brain: undefined as never,
    getVariable: () => undefined,
    setVariable: () => {},
    clearVariable: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
    ...overrides,
  };
}

function runProgramToResult(prog: ExecutableBrainProgram): Value | undefined {
  const handles = new HandleTable(100);
  const vm = new VM(services, prog, handles);
  const fiber = vm.spawnFiber(1, prog.entryPoint ?? 0, List.empty(), mkCtx());
  fiber.instrBudget = 10000;
  const result = vm.runFiber(fiber, {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  });
  assert.equal(result.status, VmStatus.DONE);
  if (result.status === VmStatus.DONE) {
    return result.result;
  }
  return undefined;
}

describe("treeshakeProgram -- integration", () => {
  test("tree-shaken program with dead functions executes correctly", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.CALL, 2, 1), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.PUSH_CONST, 1), mkInstr(Op.RET)], 0, "dead-unused"),
        mkFunc([mkInstr(Op.PUSH_CONST, 2), mkInstr(Op.RET)], 1, "doubler"),
        mkFunc([mkInstr(Op.PUSH_CONST, 3), mkInstr(Op.RET)], 0, "dead-also-unused"),
      ],
      constants: [mkNumberValue(5), mkNumberValue(999), mkNumberValue(42), mkStringValue("never-used")],
      entryPoint: 0,
    });

    assert.equal(prog.functions.size(), 4);
    assert.equal(prog.constants.size(), 4);

    const shaken = treeshakeProgram(prog);

    assert.equal(shaken.functions.size(), 2);
    assert.equal(shaken.functions.get(0).name, "main");
    assert.equal(shaken.functions.get(1).name, "doubler");

    assert.ok(shaken.constants.size() < prog.constants.size());

    const result = runProgramToResult(shaken);
    assert.ok(result !== undefined);
    assert.equal(result!.t, NativeType.Number);
    assert.equal((result as { v: number }).v, 42);
  });

  test("tree-shaken program with dead actions executes correctly via page roots", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.RET)], 0, "rule-root"),
        mkFunc([mkInstr(Op.PUSH_CONST, 1), mkInstr(Op.RET)], 0, "dead-action-entry"),
        mkFunc([mkInstr(Op.RET)], 0, "dead-action-activation"),
      ],
      constants: [mkNumberValue(7), mkNumberValue(100)],
      pages: [mkPage(0, [0])],
      actions: [mkBytecodeAction(1, 2)],
    });

    assert.equal(prog.functions.size(), 3);

    const shaken = treeshakeProgram(prog);

    assert.equal(shaken.functions.size(), 3, "all functions are reachable through pages and actions");
    assert.equal(shaken.pages.get(0).rootRuleFuncIds.get(0), 0);

    const result = runProgramToResult(shaken);
    assert.ok(result !== undefined);
    assert.equal((result as { v: number }).v, 7);
  });

  test("tree-shaken program via MAKE_CLOSURE executes correctly", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.MAKE_CLOSURE, 2, 0), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.RET)], 0, "dead"),
        mkFunc([mkInstr(Op.PUSH_CONST, 1), mkInstr(Op.RET)], 0, "closure-target"),
      ],
      constants: [mkNumberValue(111), mkNumberValue(77)],
      entryPoint: 0,
    });

    assert.equal(prog.functions.size(), 3);
    const shaken = treeshakeProgram(prog);

    assert.equal(shaken.functions.size(), 2);
    assert.equal(shaken.functions.get(0).name, "main");
    assert.equal(shaken.functions.get(1).name, "closure-target");

    const closureInstr = shaken.functions.get(0).code.get(0);
    assert.equal(closureInstr.op, Op.MAKE_CLOSURE);
    assert.equal(closureInstr.a, 1);
  });

  test("tree-shaken program runs without faulting", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.CALL, 2), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.RET)], 0, "dead"),
        mkFunc([mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.RET)], 0, "helper"),
      ],
      constants: [mkNumberValue(42)],
      entryPoint: 0,
    });

    const shaken = treeshakeProgram(prog);

    const handles = new HandleTable(100);
    const vm = new VM(services, shaken, handles);
    const fiber = vm.spawnFiber(1, 0, List.empty(), mkCtx());
    fiber.instrBudget = 100;

    const result = vm.runFiber(fiber, {
      onHandleCompleted: () => {},
      enqueueRunnable: () => {},
      getFiber: () => undefined,
    });
    assert.equal(result.status, VmStatus.DONE);
  });

  test("no dead code produces functionally identical program", () => {
    const prog = mkProgram({
      functions: [
        mkFunc(
          [
            mkInstr(Op.PUSH_CONST, 0),
            mkInstr(Op.STORE_VAR, 0),
            mkInstr(Op.PUSH_CONST, 0),
            mkInstr(Op.CALL, 1, 1),
            mkInstr(Op.RET),
          ],
          0,
          "main"
        ),
        mkFunc([mkInstr(Op.PUSH_CONST, 1), mkInstr(Op.RET)], 1, "helper"),
      ],
      constants: [mkNumberValue(10), mkNumberValue(99)],
      variableNames: ["x"],
      entryPoint: 0,
    });

    const shaken = treeshakeProgram(prog);

    assert.equal(shaken.functions.size(), prog.functions.size());
    assert.equal(shaken.constants.size(), prog.constants.size());
    assert.equal(shaken.variableNames.size(), prog.variableNames.size());
    assert.equal(shaken, prog);

    const originalResult = runProgramToResult(prog);
    const shakenResult = runProgramToResult(shaken);

    assert.ok(originalResult !== undefined);
    assert.ok(shakenResult !== undefined);
    assert.equal(originalResult!.t, shakenResult!.t);
    assert.equal((originalResult as { v: number }).v, (shakenResult as { v: number }).v);
  });

  test("tree-shaking produces same execution result as unshaken program", () => {
    const prog = mkProgram({
      functions: [
        mkFunc([mkInstr(Op.PUSH_CONST, 0), mkInstr(Op.CALL, 3, 1), mkInstr(Op.RET)], 0, "main"),
        mkFunc([mkInstr(Op.PUSH_CONST, 1), mkInstr(Op.RET)], 0, "unused-export-a"),
        mkFunc([mkInstr(Op.PUSH_CONST, 2), mkInstr(Op.RET)], 0, "unused-export-b"),
        mkFunc([mkInstr(Op.PUSH_CONST, 3), mkInstr(Op.RET)], 1, "used-func"),
      ],
      constants: [mkNumberValue(5), mkNumberValue(100), mkStringValue("unused"), mkNumberValue(25)],
      entryPoint: 0,
    });

    const originalResult = runProgramToResult(prog);

    const shaken = treeshakeProgram(prog);

    assert.ok(shaken.functions.size() < prog.functions.size());
    assert.ok(shaken.constants.size() < prog.constants.size());

    const shakenResult = runProgramToResult(shaken);

    assert.ok(originalResult !== undefined);
    assert.ok(shakenResult !== undefined);
    assert.equal(originalResult!.t, shakenResult!.t);
    assert.equal((originalResult as { v: number }).v, (shakenResult as { v: number }).v);
    assert.equal((shakenResult as { v: number }).v, 25);
  });
});
