/**
 * Test-support entry point, published as `@wendoo/ts-compiler/testing`.
 * Symbols here are test-harness surface for spec suites that compile user
 * code; they are not part of the product compiler API.
 */

/**
 * Project namespace used by spec harnesses, which compile user code without a
 * project store. One well-known value keeps compiled fixtures reproducible.
 */
export const TEST_PROJECT_NAMESPACE = "test-project";
