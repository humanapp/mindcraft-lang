export function seedFromString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = Math.imul(h ^ value.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export function seedFromInts(...values: number[]): number {
  let h = 0;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 0x5bd1e995);
    h ^= h >>> 13;
  }
  return h >>> 0;
}
