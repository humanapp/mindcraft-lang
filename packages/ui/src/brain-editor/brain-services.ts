export type BrainServicesRunner = <T>(callback: () => T) => T;

export function runWithBrainServices<T>(withBrainServices: BrainServicesRunner | undefined, callback: () => T): T {
  return withBrainServices ? withBrainServices(callback) : callback();
}
