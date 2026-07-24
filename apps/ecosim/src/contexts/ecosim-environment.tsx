import { createContext, useContext } from "react";
import type { EcosimEnvironmentStore } from "@/services/ecosim-environment-store";

const EcosimEnvironmentContext = createContext<EcosimEnvironmentStore | null>(null);

export const EcosimEnvironmentProvider = EcosimEnvironmentContext.Provider;

export function useEcosimEnvironment(): EcosimEnvironmentStore {
  const store = useContext(EcosimEnvironmentContext);
  if (!store) {
    throw new Error("useEcosimEnvironment must be used within a EcosimEnvironmentProvider");
  }
  return store;
}
