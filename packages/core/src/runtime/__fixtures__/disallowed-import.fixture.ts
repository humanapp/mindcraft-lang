/**
 * Self-test fixture for the runtime allow-list firewall.
 *
 * Loaded by `dependency-cruiser` from `__firewall__.spec.ts`, never by
 * the production runtime. Deliberately performs a value-import from a
 * `brain/` module so the self-test can prove the `runtime-allow-list`
 * rule fires when handed a violating source file. The production
 * firewall scan excludes `src/runtime/__fixtures__/` via
 * `from.pathNot` in `.dependency-cruiser.cjs`.
 *
 * Excluded from build outputs by `tsconfig.{node,esm,rbx}.json`
 * (`**\/__fixtures__/**`); included in `tsc --noEmit` typechecking by
 * `tsconfig.spec.json`.
 */

import { CoreTypeIds } from "../../brain/interfaces/core-types";

/** Value-import probe. Re-exporting keeps `CoreTypeIds` from being
 * elided, so dependency-cruiser observes a real value-import edge
 * from `runtime/` to `brain/`. */
export const firewallFixtureProbe = CoreTypeIds;
