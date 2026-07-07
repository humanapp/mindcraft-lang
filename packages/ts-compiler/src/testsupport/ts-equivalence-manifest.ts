import { CompileDiagCode, DescriptorDiagCode, LoweringDiagCode, ValidatorDiagCode } from "../compiler/diag-codes.js";

/**
 * Classification ledger for the ts-equivalence conformance corpus in
 * `src/compiler/ts-equivalence.spec.ts`. Every corpus entry is pinned to
 * exactly one classification:
 *
 * - WORKS: the entry compiles clean through the project harness and its
 *   observable outcome matches regular TypeScript semantics.
 * - BLOCKED: the entry fails with the exact diagnostic code recorded here.
 *   Entries recorded as `CompileDiagCode.TypeScriptError` are constructs
 *   TypeScript itself rejects; the suite asserts TypeScript's own error
 *   message surfaces.
 * - QUARANTINED: the entry is in neither state today (it compiles but
 *   diverges from TypeScript semantics, or fails without its own precise
 *   diagnostic). Each entry maps to a one-line description of the current
 *   divergence.
 *
 * The suite enforces a one-way ratchet:
 *
 * - A WORKS entry that stops compiling or stops behaving fails the suite.
 *   Never delete a WORKS entry.
 * - A BLOCKED entry whose diagnostic changes or disappears fails the suite.
 *   When a blocked construct gains support, delete it from BLOCKED and add
 *   it to WORKS.
 * - A QUARANTINED entry that starts conforming fails the suite until it is
 *   deleted from QUARANTINED and classified. The list only shrinks.
 *
 * Compiler changes that add or change construct support ship their corpus
 * classifications in the same change.
 */

/** Corpus entries pinned as compiling clean with TypeScript semantics. */
export const WORKS: readonly string[] = [
  "class-field-type-declared-above",
  "class-field-type-declared-below",
  "entry-class-composes-imported-class",
  "class-field-typed-by-alias-below",
  "class-field-typed-by-same-module-interface",
  "nullable-self-reference-class-field",
  "class-instance-method-call",
  "local-enum-member-value",
  "imported-enum-member-value",
  "imported-enum-member-in-expression",
  "enum-inequality-via-params",
  "enum-ternary-of-enum-literals",
  "enum-alias-members-compare-equal",
  "enum-member-arithmetic-with-number",
  "template-literal-embeds-enum-value",
  "enum-into-number-variable-store",
  "enum-declared-below-referencing-class",
  "enum-declared-below-sensor-return",
  "sensor-returns-renamed-imported-enum",
  "sensor-return-type-by-local-enum-ref",
  "sensor-return-type-by-imported-enum-ref",
  "sensor-param-typed-by-imported-enum-ref",
  "sensor-output-typed-by-imported-enum-ref",
  "consumes-when-result-imported-enum-ref",
  "sensor-returns-imported-class",
  "sensor-returns-imported-interface",
  "sensor-returns-imported-alias",
  "system-state-typed-by-imported-enum",
  "struct-type-factory-and-field-read",
  "nested-struct-across-modules",
  "module-private-same-name-structs-coexist",
  "module-let-state-is-per-callsite",
  "arg-shadowing-local-resolves-to-local",
  "shadowing-local-captured-by-nested-function",
  "optional-buffer-arg-presence-guard",
  "buffer-isbuffer-type-guard",
  "typeof-narrows-union",
  "instanceof-narrows-class-union",
  "optional-chaining-nullable-field",
  "generic-interface-concrete-instantiation",
  "generic-class-concrete-instantiation",
  "generic-alias-concrete-instantiation",
  "partial-utility-type-concrete-use",
  "array-rest-destructuring",
  "object-rest-destructuring",
  "nested-destructuring",
  "conversion-declaration-resolves-pair",
  "recompile-against-warm-registry",
  "system-state-typed-by-imported-class",
  "helper-function-declared-below-class",
  "helper-function-declared-between-classes",
  "class-method-calls-helper-declared-below",
  "helpers-and-classes-interleaved",
  "helper-declared-below-enum-struct-and-system",
  "imported-helper-below-imported-class",
  "imported-helper-with-local-class",
  "setter-declared-before-unrelated-getter",
  "switch-statement",
  "static-class-member",
  "class-getter-setter",
];

/** Corpus entries pinned as failing with the recorded diagnostic code. */
export const BLOCKED: Readonly<Record<string, number>> = {
  "use-before-declaration-const": CompileDiagCode.TypeScriptError,
  "type-error-string-to-number": CompileDiagCode.TypeScriptError,
  "class-inheritance": ValidatorDiagCode.ClassInheritanceNotSupported,
  "private-hash-field": ValidatorDiagCode.PrivateFieldsNotSupported,
  "var-declaration": ValidatorDiagCode.VarNotAllowed,
  "labeled-statement": ValidatorDiagCode.LabeledStatementsNotSupported,
  "delete-expression": ValidatorDiagCode.DeleteNotSupported,
  "regex-literal": ValidatorDiagCode.RegularExpressionsNotSupported,
  "generator-function": ValidatorDiagCode.GeneratorsNotSupported,
  "class-expression": ValidatorDiagCode.ClassExpressionsNotSupported,
  "enum-relational-compare": LoweringDiagCode.NoOperatorOverload,
  "string-global-converts-enum": LoweringDiagCode.UndefinedVariable,
  "not-on-nullable-primitive-arg": LoweringDiagCode.NotOnNullablePrimitive,
  "struct-type-config-not-inline-literal": LoweringDiagCode.StructTypeConfigNotObjectLiteral,
  "struct-type-recursive-field": LoweringDiagCode.StructTypeRecursiveField,
  "conversion-same-type": CompileDiagCode.ConversionSameType,
  "consumes-when-result-any": CompileDiagCode.ConsumesWhenResultIsAny,
  "destructured-onexecute-args-param": LoweringDiagCode.DestructuringInOnExecuteNotSupported,
  "enum-object-as-value": LoweringDiagCode.EnumObjectUsageNotSupported,
  "class-object-as-value": LoweringDiagCode.ClassObjectUsageNotSupported,
  "duplicate-symbol-across-modules": CompileDiagCode.DuplicateImportedSymbol,
  "duplicate-stable-id": CompileDiagCode.DuplicateActionId,
  "actuator-param-imported-enum-by-name": CompileDiagCode.ParameterUnresolvedType,
  "sensor-returns-nullable-enum": DescriptorDiagCode.SensorReturnTypeRequired,
  "sensor-returns-undefined-union-enum": CompileDiagCode.UnknownOutputType,
  "sensor-returns-imported-struct-instance-alias": CompileDiagCode.UnknownOutputType,
  "conversion-from-enum-ref": CompileDiagCode.TypeScriptError,
  "struct-field-typed-by-enum-binding": CompileDiagCode.TypeScriptError,
  "shared-modifier-label-conflict": CompileDiagCode.SharedModifierLabelConflict,
};

/**
 * Corpus entries in the forbidden third state, each mapped to a one-line
 * description of the current divergence.
 */
export const QUARANTINED: Readonly<Record<string, string>> = {
  "separate-statement-export-class":
    "A class exported by a separate `export { X }` statement is not collected as an exported class, so an importer's `new X()` fails 3143 Unknown class even though TypeScript accepts the import.",
};
