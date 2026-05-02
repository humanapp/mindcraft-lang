/**
 * Runtime allow-list firewall configuration.
 *
 * Architectural invariant: every value-import reachable from
 * `packages/core/src/runtime/` must resolve to `runtime/` or
 * `platform/`. Anything else is forbidden by default. Adding a new
 * permitted dependency means editing this allow-list.
 *
 * Type-only imports (`import type`, `export type`, inline-type
 * positions) are excluded via `to.dependencyTypesNot: ["type-only"]`.
 *
 * Scope is intra-package: `to.path: "^src/"`. Third-party /
 * `node_modules` imports are not the firewall's concern.
 *
 * `tsConfig.fileName` points at the package's main `tsconfig.json`
 * (not `tsconfig.spec.json`) so TypeScript path aliases resolve
 * correctly. The self-test in `src/runtime/__firewall__.spec.ts`
 * guards against silently-passing misconfiguration.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "runtime-allow-list",
      severity: "error",
      comment:
        "Architectural invariant: every value-import reachable from " +
        "packages/core/src/runtime/ must resolve to runtime/ or platform/. " +
        "Adding a new permitted dependency means editing this allow-list.",
      from: {
        path: "^src/runtime/",
        // Self-test fixtures live under runtime/ but are not real
        // runtime code; they deliberately violate the rule. The
        // self-test re-runs the rule with this exclusion dropped to
        // prove the rule fires.
        pathNot: "^src/runtime/__fixtures__/",
      },
      to: {
        path: "^src/",
        pathNot: "^src/(runtime|platform)/",
        dependencyTypesNot: ["type-only"],
      },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|node_modules)/" },
  },
};
