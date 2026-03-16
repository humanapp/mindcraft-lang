import type { RandomSource } from "./types";

export function randomFloat(rng: RandomSource, min: number, max: number): number {
  return min + rng.next() * (max - min);
}

export function randomInt(rng: RandomSource, min: number, max: number): number {
  return Math.floor(min + rng.next() * (max - min));
}

export function randomBool(rng: RandomSource, probability = 0.5): boolean {
  return rng.next() < probability;
}

export function randomSign(rng: RandomSource): 1 | -1 {
  return rng.next() < 0.5 ? -1 : 1;
}

export function randomChoice<T>(rng: RandomSource, items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)];
}

export function shuffle<T>(rng: RandomSource, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}
