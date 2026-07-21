/**
 * LoweringDiagCode member names that have no test asserting their emission, each
 * mapped to the reason no emission test exists: a TypeScript error shadows the
 * trigger before lowering runs, a defensive guard fires only on a state valid
 * user code cannot reach, or no code path emits the diagnostic at all.
 *
 * The coverage gate in diag-coverage-check.ts enforces a one-way ratchet: it
 * fails if a code outside this map has no test, and fails if a code in the map
 * gains a test without being deleted. The map only shrinks -- add a test that
 * asserts the diagnostic, then delete its entry.
 */
const UNTESTED_WITH_REASON: Record<string, string> = {
  ArrayFromRequiresOneOrTwoArgs:
    "TypeScript rejects Array.from() with 0 or 3+ args (ambient overloads are 1-2 args) before lowering.",
  ArrayMethodNotSupported:
    "Ambient Array omits fill/copyWithin, so calling them is a TypeScript error before lowering's branch runs.",
  ArrayToStringTakesNoArgs:
    "TypeScript rejects args to Array.toString() (ambient arity 0) before lowering's arg-count check.",
  BreakOutsideLoop:
    "A break outside a loop is a TypeScript error before lowering; a labeled break lowers to UnsupportedStatement.",
  BufferMethodWrongArgCount:
    "Ambient Buffer methods are fixed-arity, so a wrong arg count is a TypeScript error before lowering.",
  CannotConvertListElementToString:
    "Defensive guard: the number->string conversion is always registered, so it never fires.",
  CannotDetermineTypeForObjectLiteral:
    "Defensive guard: the checker always types an object literal; the genuine failure emits ObjectLiteralTypeUnresolvable.",
  CannotInstantiateNativeBackedStruct:
    "Native-backed struct interfaces carry a unique-symbol brand, so no object literal typechecks against one (TypeScript error first).",
  ContinueOutsideLoop:
    "A continue outside a loop is a TypeScript error before lowering (the loop stack is always pushed first).",
  DestructuringMissingInitializer:
    "TypeScript grammar requires a destructuring initializer (TS1182), so this never reaches lowering.",
  ForInCannotResolveOperator: "Defensive guard: the number < and + operators are always registered, so it never fires.",
  ForInRequiresSingleIdentifier:
    "TypeScript rejects a destructuring or multi-declaration for-in binding before lowering.",
  ForOfCannotResolveOperator: "Defensive guard: the number < and + operators are always registered, so it never fires.",
  JoinTakesAtMostOneArg:
    "TypeScript rejects a 2-arg join() (ambient arity 0-1); a spread arg lowers to SpreadElement first.",
  MapConstructorTooManyArgs:
    "Ambient Map has only 0- and 1-arg constructors, so extra args are a TypeScript error before lowering.",
  MapMethodWrongArgCount:
    "Ambient Map methods are fixed-arity, so a wrong arg count is a TypeScript error before lowering.",
  MathMethodWrongArgCount:
    "Ambient Math methods are fixed-arity, so a wrong arg count is a TypeScript error; variadic max/min route to MathMinMaxRequiresTwoArgs.",
  NoOverloadForStringConcat: "Defensive guard: the string + operator is always registered, so it never fires.",
  PopTakesNoArgs: "TypeScript rejects args to Array.pop() (ambient arity 0) before lowering.",
  ReadOnlyFieldAssignment:
    "A readOnly struct field is `readonly` in the ambient .d.ts, so assigning it is a TypeScript error first.",
  ReduceRequiresOneOrTwoArgs:
    "TypeScript rejects reduce() with 0 or 3+ args (ambient overloads are 1-2 args) before lowering.",
  RestElementMustBeLast: "A non-last rest element is a TypeScript grammar error (TS1014) before lowering.",
  SpliceRequiresAtLeastOneArg: "TypeScript rejects a 0-arg splice() (ambient start is required) before lowering.",
  SystemBindingUnresolvable:
    "Defensive guard: a declared `const X = System(...)` name always resolves to a symbol in valid TypeScript.",
  UnknownStructMethod:
    "Defensive guard: every struct method reachable from user code has a registered host or user function.",
  UnsupportedArrayMethod:
    "Ambient Array is closed and every declared method is handled; any other name is a TypeScript error first.",
  UnsupportedBufferMethod:
    "Ambient Buffer is closed and every declared member is handled; any other name is a TypeScript error first.",
  UnsupportedMapMethod:
    "Ambient Map is closed and every declared method is handled; any other name is a TypeScript error first.",
  UnsupportedMathMethod:
    "Ambient Math is closed and every declared method is handled; any other name is a TypeScript error first.",
  UnsupportedStringMethod:
    "Ambient String is closed and every declared method is handled; any other name is a TypeScript error first.",
};

/** Member names with no emission test (the keys of {@link UNTESTED_WITH_REASON}). */
export const KNOWN_UNTESTED: readonly string[] = Object.keys(UNTESTED_WITH_REASON);
