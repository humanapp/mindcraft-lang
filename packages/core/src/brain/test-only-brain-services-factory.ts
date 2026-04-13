import { installCoreBrainComponents } from ".";
import type { BrainServices } from "./services";
import { createBrainServices } from "./services-factory";

/**
 * TEST-ONLY. Creates a fresh BrainServices with all core components registered.
 *
 * Production code must use createMindcraftEnvironment() instead.
 * This exists solely so spec files can get a lightweight BrainServices
 * without standing up a full MindcraftEnvironment.
 */
export function __test__createBrainServices(): BrainServices {
  return installCoreBrainComponents(createBrainServices());
}
