import type { ProfileNumerics } from "../runtime/profile-numerics";
import { installCoreBrainComponents } from ".";
import type { BrainServices } from "./services";
import { createAppServices, createBrainServices } from "./services-factory";

/**
 * TEST-ONLY. Creates a fresh BrainServices with all core components registered.
 *
 * Production code must use createMindcraftEnvironment() instead.
 * This exists solely so spec files can get a lightweight BrainServices
 * without standing up a full MindcraftEnvironment.
 *
 * @param options - Optional app-tier overrides; `numerics` selects the
 *   profile numerics captured by the registered core components (defaults
 *   to f64).
 */
export function __test__createBrainServices(options?: { numerics?: ProfileNumerics }): BrainServices {
  return installCoreBrainComponents(createBrainServices(createAppServices(undefined, options?.numerics)));
}
