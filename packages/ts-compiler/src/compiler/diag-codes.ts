/**
 * Diagnostic codes for the TypeScript user-tile compiler.
 *
 * Each diagnostic has a unique numeric code.
 * Codes are organized by compiler phase:
 * - 1000-1099: Validator diagnostics (forbidden syntax)
 * - 2000-2099: Descriptor extraction diagnostics
 * - 3000-3199: Lowering diagnostics
 * - 4000-4099: Emit diagnostics
 * - 5000-5099: Compile orchestration diagnostics
 */

/**
 * Validator diagnostic codes (1000-1099)
 *
 * Emitted when the AST contains syntax constructs that are not
 * supported by the user-tile runtime.
 */
export enum ValidatorDiagCode {
  /** Class expressions (inline) are not supported */
  ClassExpressionsNotSupported = 1000,
  /** Reserved legacy validator code for enum rejection */
  EnumsNotSupported = 1001,
  /** Reserved legacy validator code for validator-level for...in rejection */
  ForInNotSupported = 1002,
  /** with statements are not supported */
  WithNotSupported = 1003,
  /** switch statements are not supported */
  SwitchNotSupported = 1004,
  /** Generator functions (yield) are not supported */
  GeneratorsNotSupported = 1005,
  /** Computed property names (non-literal) are not supported */
  ComputedPropertyNamesNotSupported = 1006,
  /** debugger statements are not supported */
  DebuggerNotSupported = 1007,
  /** Labeled statements are not supported */
  LabeledStatementsNotSupported = 1008,
  /** delete expressions are not supported */
  DeleteNotSupported = 1009,
  /** Regular expression literals are not supported */
  RegularExpressionsNotSupported = 1010,
  /** var declarations are not allowed; use let or const */
  VarNotAllowed = 1011,
  /** Dynamic import() calls are not supported */
  DynamicImportNotSupported = 1012,
  /** Reference to a forbidden global identifier */
  ForbiddenGlobalAccess = 1013,
  /** Decorators are not supported */
  DecoratorsNotSupported = 1014,
  /** Class declaration must have a name */
  ClassMustBeNamed = 1015,
  /** Class inheritance (extends) is not supported */
  ClassInheritanceNotSupported = 1016,
  /** Static class members are not supported */
  StaticMembersNotSupported = 1017,
  /** Private fields (#name) are not supported */
  PrivateFieldsNotSupported = 1018,
  /** Class getters/setters are not supported */
  ClassGettersSettersNotSupported = 1019,
  /** Reference to an unsupported built-in type */
  UnsupportedTypeReference = 1020,
}

/**
 * Descriptor extraction diagnostic codes (2000-2099)
 *
 * Emitted when the default export does not conform to the
 * expected Sensor({...}) or Actuator({...}) structure.
 */
export enum DescriptorDiagCode {
  /** No default export found; expected Sensor({...}) or Actuator({...}) */
  MissingDefaultExport = 2000,
  /** Default export is not a call to Sensor or Actuator */
  InvalidDefaultExport = 2001,
  /** Sensor() or Actuator() called with wrong number of arguments */
  InvalidCalleeArgumentCount = 2002,
  /** Sensor() or Actuator() argument is not an object literal */
  CalleeArgumentNotObjectLiteral = 2003,
  /** name property value is not a string literal */
  NameMustBeStringLiteral = 2004,
  /** output property is only valid for sensors */
  OutputOnlyValidForSensors = 2005,
  /** output property value is not a string literal */
  OutputMustBeStringLiteral = 2006,
  /** onExecute property is not a function */
  OnExecuteMustBeFunction = 2007,
  /** onPageEntered property is not a function */
  OnPageEnteredMustBeFunction = 2008,
  /** Required name property is missing */
  NamePropertyRequired = 2009,
  /** Required output property is missing for sensors */
  OutputPropertyRequired = 2010,
  /** Required onExecute method is missing */
  OnExecuteRequired = 2011,
  /** params value is not an object literal */
  ParamsMustBeObjectLiteral = 2012,
  /** Param entry does not use property assignment syntax */
  ParamEntryMustUsePropertySyntax = 2013,
  /** Param key is not an identifier or string literal */
  ParamNameMustBeIdentifier = 2014,
  /** Param definition is not an object literal */
  ParamDefinitionMustBeObjectLiteral = 2015,
  /** Param type value is not a string literal */
  ParamTypeMustBeStringLiteral = 2016,
  /** Param default value is not a literal */
  ParamDefaultMustBeLiteral = 2017,
  /** Param anonymous value is not a boolean literal */
  ParamAnonymousMustBeBoolean = 2018,
  /** Param definition is missing the required type property */
  ParamDefinitionMissingType = 2019,
}

/**
 * Lowering diagnostic codes (3000-3199)
 *
 * Emitted during AST-to-IR lowering when a construct cannot be
 * translated to the user-tile instruction set.
 */
export enum LoweringDiagCode {
  /** Helper function declaration has no body */
  FunctionHasNoBody = 3000,
  /** onExecute function has no body */
  OnExecuteHasNoBody = 3001,
  /** onPageEntered function has no body */
  OnPageEnteredHasNoBody = 3002,
  /** Statement kind is not supported in user-tile programs */
  UnsupportedStatement = 3003,
  /** Expression kind is not supported in user-tile programs */
  UnsupportedExpression = 3004,
  /** Variable binding pattern is not supported */
  UnsupportedBindingPattern = 3005,
  /** Function call form is not supported */
  UnsupportedFunctionCall = 3006,
  /** Reference to an undeclared variable */
  UndefinedVariable = 3010,
  /** break used outside of a loop */
  BreakOutsideLoop = 3011,
  /** continue used outside of a loop */
  ContinueOutsideLoop = 3012,
  /** Destructuring declaration is missing an initializer */
  DestructuringMissingInitializer = 3020,
  /** Rest (...) patterns in destructuring are not supported */
  RestPatternsNotSupported = 3021,
  /** Destructuring in onExecute parameter position is not supported */
  DestructuringInOnExecuteNotSupported = 3024,
  /** Rest element must be the last element in an array destructuring pattern */
  RestElementMustBeLast = 3025,
  /** for...of is only supported on list-typed values */
  ForOfOnNonListType = 3030,
  /** for...of requires a variable declaration as its initializer */
  ForOfRequiresVariableDeclaration = 3031,
  /** for...of binding must be a single identifier */
  ForOfRequiresSingleIdentifier = 3032,
  /** Cannot resolve an operator needed to implement for...of iteration */
  ForOfCannotResolveOperator = 3033,
  /** for...in is only supported on list, map, and registered struct values */
  ForInOnUnsupportedType = 3034,
  /** for...in requires a variable declaration as its initializer */
  ForInRequiresVariableDeclaration = 3035,
  /** for...in binding must be a single identifier */
  ForInRequiresSingleIdentifier = 3036,
  /** Cannot resolve an operator needed to implement for...in iteration */
  ForInCannotResolveOperator = 3037,
  /** Binary operator is not supported */
  UnsupportedOperator = 3040,
  /** Cannot determine operand types for binary operator */
  CannotDetermineTypesForBinaryOp = 3041,
  /** No operator overload found for the given operand types */
  NoOperatorOverload = 3042,
  /** Prefix operator is not supported */
  UnsupportedPrefixOperator = 3043,
  /** Compound assignment operator is not supported */
  UnsupportedCompoundAssignOperator = 3044,
  /** Cannot determine operand types for compound assignment */
  CannotDetermineTypesForCompoundAssign = 3045,
  /** Increment or decrement target is not a variable */
  IncrDecrTargetNotVariable = 3046,
  /** Assignment target is not a simple variable */
  AssignmentTargetNotVariable = 3047,
  /** Cannot determine the type of the ! operand */
  CannotDetermineTypeForNotOperand = 3048,
  /** typeof comparison value is not a supported type string */
  UnsupportedTypeofComparison = 3049,
  /** Cannot convert an expression to string because its type is unknown */
  CannotConvertToString = 3050,
  /** No registered conversion from the given type to string */
  NoConversionToString = 3051,
  /** No operator overload for string concatenation */
  NoOverloadForStringConcat = 3052,
  /** Both implicit conversion directions are viable for a binary operator */
  AmbiguousImplicitBinaryConversion = 3053,
  /** No valid single-step conversion exists for a target-typed boundary */
  NoConversionToTargetType = 3054,
  /** Property access on a struct references a field that does not exist */
  PropertyNotOnStruct = 3060,
  /** Property access form is not supported */
  UnsupportedPropertyAccess = 3061,
  /** Method called on a struct is not registered */
  UnknownStructMethod = 3062,
  /** RHS struct type is not structurally compatible with LHS type */
  StructurallyIncompatibleTypes = 3063,
  /** Cannot determine the type expected for an object literal */
  CannotDetermineTypeForObjectLiteral = 3070,
  /** Cannot instantiate a native-backed struct type with an object literal */
  CannotInstantiateNativeBackedStruct = 3071,
  /** Object literal type does not resolve to a known struct or map type */
  ObjectLiteralTypeUnresolvable = 3072,
  /** Object literal property is not a simple property assignment */
  UnsupportedPropertyInObjectLiteral = 3073,
  /** Object literal property name is not an identifier or string literal */
  UnsupportedPropertyNameInObjectLiteral = 3074,
  /** Map literal property is not a simple property assignment */
  UnsupportedPropertyInMapLiteral = 3075,
  /** Map literal property name is not an identifier or string literal */
  UnsupportedPropertyNameInMapLiteral = 3076,
  /** Element access (bracket index) is only supported on list types */
  ElementAccessOnNonListType = 3080,
  /** Element access assignment is only supported on list types */
  ElementAccessAssignOnNonListType = 3081,
  /** await is used outside of an async host function call */
  AwaitOnNonAsyncHostCall = 3082,
  /** Cannot determine the element type for an array literal */
  CannotDetermineListType = 3083,
  /** Array method is recognized but not supported in user-tile programs */
  ArrayMethodNotSupported = 3090,
  /** Array method is not recognized */
  UnsupportedArrayMethod = 3091,
  /** .push() called with wrong number of arguments */
  PushRequiresOneArg = 3092,
  /** .pop() called with arguments */
  PopTakesNoArgs = 3093,
  /** .shift() called with arguments */
  ShiftTakesNoArgs = 3094,
  /** .unshift() called with wrong number of arguments */
  UnshiftRequiresOneArg = 3095,
  /** .splice() called without required start argument */
  SpliceRequiresAtLeastOneArg = 3096,
  /** .sort() called without a comparator function argument */
  SortRequiresComparatorFn = 3097,
  /** .indexOf() called with wrong number of arguments */
  IndexOfRequiresOneArg = 3098,
  /** .filter() called with wrong number of arguments */
  FilterRequiresOneArg = 3099,
  /** .map() called with wrong number of arguments */
  MapRequiresOneArg = 3100,
  /** Cannot determine result list type for .map() */
  CannotDetermineMapResultListType = 3101,
  /** .forEach() called with wrong number of arguments */
  ForEachRequiresOneArg = 3102,
  /** .includes() called with wrong number of arguments */
  IncludesRequiresOneArg = 3103,
  /** .some() called with wrong number of arguments */
  SomeRequiresOneArg = 3104,
  /** .every() called with wrong number of arguments */
  EveryRequiresOneArg = 3105,
  /** .find() called with wrong number of arguments */
  FindRequiresOneArg = 3106,
  /** .join() called with too many arguments */
  JoinTakesAtMostOneArg = 3107,
  /** .reverse() called with arguments */
  ReverseTakesNoArgs = 3108,
  /** .slice() called with too many arguments */
  SliceTakesAtMostTwoArgs = 3109,
  /** Cannot resolve an operator needed to implement an array method */
  CannotResolveOperatorForArrayMethod = 3110,
  /** Cannot convert a list element to string for .join() */
  CannotConvertListElementToString = 3111,
  /** .lastIndexOf() called with wrong number of arguments */
  LastIndexOfRequiresOneArg = 3112,
  /** .findIndex() called with wrong number of arguments */
  FindIndexRequiresOneArg = 3113,
  /** .reduce() called with wrong number of arguments */
  ReduceRequiresOneOrTwoArgs = 3114,
  /** .toString() called with arguments */
  ArrayToStringTakesNoArgs = 3115,
  /** Array.from() called with wrong number of arguments */
  ArrayFromRequiresOneOrTwoArgs = 3116,
  /** Array.from() called on a non-list type */
  ArrayFromNonListSource = 3117,
  /** Cannot determine result list type for Array.from() */
  CannotDetermineArrayFromResultListType = 3118,
  /** Math method is not supported */
  UnsupportedMathMethod = 3120,
  /** Math.max()/Math.min() called with wrong number of arguments */
  MathMinMaxRequiresTwoArgs = 3121,
  /** Math method called with wrong number of arguments */
  MathMethodWrongArgCount = 3122,
  /** String method is not supported */
  UnsupportedStringMethod = 3130,
  /** String method called with wrong number of arguments */
  StringMethodWrongArgCount = 3131,
  /** Class declaration has no name */
  ClassDeclarationMissingName = 3140,
  /** Cannot resolve the type of a class field */
  UnresolvableClassFieldType = 3141,
  /** `this` keyword used outside of a class constructor or method */
  ThisOutsideClassContext = 3142,
  /** `new` expression target is not a known class */
  NewExpressionUnknownClass = 3143,
  /** `new` expression target is not an identifier */
  NewExpressionNotIdentifier = 3144,
  /** Enum objects cannot be used as runtime values; only direct member access is supported */
  EnumObjectUsageNotSupported = 3145,
  /** Cannot resolve the list type for a rest parameter */
  CannotResolveRestParamListType = 3146,
  /** Spread argument must be the last argument in a function call */
  SpreadMustBeLastArgument = 3147,
  /** Spread in a function call requires the target to have a rest parameter */
  SpreadRequiresRestTarget = 3148,
  /** Cannot resolve the type of an interface field */
  UnresolvableInterfaceFieldType = 3150,
  /** Interface has unsupported members (index signatures, call signatures, etc.) */
  UnsupportedInterfaceMember = 3151,
  /** Generic interfaces are not supported */
  GenericInterfaceNotSupported = 3152,
  /** User interface name collides with an ambient (runtime-registered) type */
  InterfaceCollidesWithAmbientType = 3153,
}

/**
 * Emit diagnostic codes (4000-4099)
 *
 * Emitted during bytecode emission when a referenced function
 * cannot be resolved in the program's function table.
 */
export enum EmitDiagCode {
  /** Host function name does not resolve to a registered function */
  CannotResolveHostFunction = 4000,
  /** User function name does not resolve in the function table */
  CannotResolveFunction = 4001,
  /** Closure function name does not resolve in the function table */
  CannotResolveClosureFunction = 4002,
}

/**
 * Compile orchestration diagnostic codes (5000-5099)
 *
 * Emitted by the top-level compile driver for errors that occur
 * outside of any specific compiler phase.
 */
export enum CompileDiagCode {
  /** Internal error: compiled source file could not be located */
  SourceFileNotFound = 5000,
  /** The sensor output type name is not registered in the type registry */
  UnknownOutputType = 5001,
  /** Diagnostic produced by TypeScript's own type-checker (pre-emit phase) */
  TypeScriptError = 5002,
  /** Helper module contains top-level variables (not yet supported) */
  HelperModuleHasVariables = 5003,
  /** Two imported modules export the same symbol name */
  DuplicateImportedSymbol = 5004,
  /** User-authored enum declaration is invalid or unsupported */
  InvalidEnumDeclaration = 5005,
}

/**
 * Union of all TypeScript compiler diagnostic codes.
 */
export type TsDiagCode = ValidatorDiagCode | DescriptorDiagCode | LoweringDiagCode | EmitDiagCode | CompileDiagCode;
