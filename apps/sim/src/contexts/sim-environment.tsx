import { createContext, useContext } from "react";
import type { SimEnvironmentStore } from "@/services/sim-environment-store";

const SimEnvironmentContext = createContext<SimEnvironmentStore | null>(null);

export const SimEnvironmentProvider = SimEnvironmentContext.Provider;

export function useSimEnvironment(): SimEnvironmentStore {
  const store = useContext(SimEnvironmentContext);
  if (!store) {
    throw new Error("useSimEnvironment must be used within a SimEnvironmentProvider");
  }
  return store;
}
