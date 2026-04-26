/** Cross-platform set of unique string or number values. Roblox build uses a Luau table; Node/ESM build uses a native `Set`. */
export declare class UniqueSet<T extends string | number> {
  constructor(values?: readonly T[]);

  size(): number;
  isEmpty(): boolean;
  has(value: T): boolean;
  add(value: T): void;
  delete(value: T): boolean;
  clear(): void;
  forEach(fn: (value: T) => void): void;
  toArray(): T[];
}
