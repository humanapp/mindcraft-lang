import { List } from "../platform/list";
import { INFINITY, MathOps } from "../platform/math";

/**
 * Platform-agnostic BitSet implementation using List<number>
 * Based on infusion's BitSet.js
 * @see https://github.com/infusion/BitSet.js
 */

type BitSetData = {
  data: List<number>;
  _: number;
};

const P: BitSetData = {
  data: new List<number>(),
  _: 0,
};

export interface ReadonlyBitSet {
  get(ndx: number): number;
  isEmpty(): boolean;
  cardinality(): number;
  msb(): number;
  ntz(): number;
  lsb(): number;
  equals(val: BitSet): boolean;
}

export class BitSet implements ReadonlyBitSet {
  static readonly WORD_LENGTH: number = 32;
  static readonly WORD_LOG: number = 5;

  data: List<number>;
  _: number = 0;

  constructor(param?: string | BitSet | number) {
    this.data = new List<number>();
    BitSet.parse(this as unknown as BitSetData, param);
    this.data = List.from((this as unknown as BitSetData).data.toArray());
  }

  static popCount(v: number): number {
    v -= (v >>> 1) & 0x55555555;
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0xf0f0f0f) * 0x1010101) >>> 24;
  }

  static divide(arr: List<number>, B: number): number {
    let r = 0;
    const len = arr.size();
    for (let i = 0; i < len; i++) {
      r *= 2;
      const d = ((arr.get(i) + r) / B) | 0;
      r = (arr.get(i) + r) % B;
      arr.set(i, d);
    }
    return r;
  }

  private static parse(P: BitSetData, val?: string | BitSet | number) {
    if (val === undefined) {
      P.data = List.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      P._ = 0;
      return;
    }

    if (val instanceof BitSet) {
      P.data = List.from(val.data.toArray());
      P._ = val._;
      return;
    }

    // Check if it's a number using type guard
    const numVal = val as number;
    if (numVal === numVal && (numVal | 0) === numVal) {
      P.data = List.from([numVal | 0]);
      P._ = 0;
      return;
    }

    // String parsing - minimal support for now
    P.data = List.from([0]);
    P._ = 0;
  }

  static fromBinaryString(str: string): BitSet {
    return new BitSet();
  }

  static fromHexString(str: string): BitSet {
    return new BitSet();
  }

  static Random(n?: number): BitSet {
    if (n === undefined || n < 0) {
      n = BitSet.WORD_LENGTH;
    }

    const m = n % BitSet.WORD_LENGTH;
    const len = MathOps.ceil(n / BitSet.WORD_LENGTH);
    const data = new List<number>();

    for (let i = 0; i < len; i++) {
      data.push((MathOps.random() * 4294967296) | 0);
    }

    if (m > 0) {
      data.set(len - 1, data.get(len - 1) & ((1 << m) - 1));
    }

    const s = new BitSet();
    s.data = data;
    s._ = 0;
    return s;
  }

  set(ndx: number, value?: number): BitSet {
    ndx |= 0;
    const wordIndex = ndx >>> BitSet.WORD_LOG;

    // Ensure array is large enough
    while (this.data.size() <= wordIndex) {
      this.data.push(0);
    }

    if (value === undefined || value) {
      this.data.set(wordIndex, this.data.get(wordIndex) | (1 << ndx));
    } else {
      this.data.set(wordIndex, this.data.get(wordIndex) & ~(1 << ndx));
    }
    return this;
  }

  get(ndx: number): number {
    ndx |= 0;
    const n = ndx >>> BitSet.WORD_LOG;

    if (n >= this.data.size()) {
      return this._ & 1;
    }
    return (this.data.get(n) >>> ndx) & 1;
  }

  not(): BitSet {
    const t = this.clone();
    const len = t.data.size();
    for (let i = 0; i < len; i++) {
      t.data.set(i, ~t.data.get(i));
    }
    t._ = ~t._;
    return t;
  }

  and(value: BitSet): BitSet {
    const t = this.clone();
    const minLen = MathOps.min(t.data.size(), value.data.size());

    for (let i = 0; i < minLen; i++) {
      t.data.set(i, t.data.get(i) & value.data.get(i));
    }

    return t;
  }

  or(val: BitSet): BitSet {
    const t = this.clone();
    const valLen = val.data.size();

    for (let i = 0; i < valLen; i++) {
      if (i >= t.data.size()) {
        t.data.push(val.data.get(i));
      } else {
        t.data.set(i, t.data.get(i) | val.data.get(i));
      }
    }
    t._ |= val._;
    return t;
  }

  xor(val: BitSet): BitSet {
    const t = this.clone();
    const maxLen = MathOps.max(t.data.size(), val.data.size());

    for (let i = 0; i < maxLen; i++) {
      const tv = i < t.data.size() ? t.data.get(i) : 0;
      const vv = i < val.data.size() ? val.data.get(i) : 0;

      if (i >= t.data.size()) {
        t.data.push(tv ^ vv);
      } else {
        t.data.set(i, tv ^ vv);
      }
    }
    t._ ^= val._;
    return t;
  }

  andNot(val: BitSet): BitSet {
    return this.and(val.not());
  }

  flip(from?: number, to?: number): BitSet {
    if (from === undefined) {
      const len = this.data.size();
      for (let i = 0; i < len; i++) {
        this.data.set(i, ~this.data.get(i));
      }
      this._ = ~this._;
    } else if (to === undefined) {
      this.set(from, this.get(from) === 0 ? 1 : 0);
    } else {
      for (let i = from; i <= to; i++) {
        this.set(i, this.get(i) === 0 ? 1 : 0);
      }
    }
    return this;
  }

  clear(from?: number, to?: number): BitSet {
    if (from === undefined) {
      const len = this.data.size();
      for (let i = 0; i < len; i++) {
        this.data.set(i, 0);
      }
      this._ = 0;
    } else if (to === undefined) {
      this.set(from, 0);
    } else {
      for (let i = from; i <= to; i++) {
        this.set(i, 0);
      }
    }
    return this;
  }

  slice(from?: number, to?: number): BitSet | undefined {
    if (from === undefined) {
      return this.clone();
    }

    const im = new BitSet();
    if (to === undefined) {
      to = this.data.size() * BitSet.WORD_LENGTH;
    }

    for (let i = from; i <= to; i++) {
      im.set(i - from, this.get(i));
    }
    return im;
  }

  setRange(from: number, to: number, value: number): BitSet {
    for (let i = from; i <= to; i++) {
      this.set(i, value);
    }
    return this;
  }

  clone(): BitSet {
    const im = new BitSet();
    im.data = List.from(this.data.toArray());
    im._ = this._;
    return im;
  }

  toArray(): Array<number> {
    const ret: number[] = [];
    const len = this.data.size();

    for (let i = len - 1; i >= 0; i--) {
      let num = this.data.get(i);
      while (num !== 0) {
        const t = 31 - MathOps.clz32(num);
        num ^= 1 << t;
        ret.unshift(i * BitSet.WORD_LENGTH + t);
      }
    }

    if (this._ !== 0) ret.push(INFINITY);
    return ret;
  }

  toString(base?: number): string {
    if (!base) base = 2;

    // Simple binary/hex representation
    let result = "";
    for (let i = this.data.size() - 1; i >= 0; i--) {
      const num = this.data.get(i);
      let bits = "";
      if (base === 2) {
        // Binary
        for (let j = 31; j >= 0; j--) {
          bits += (num >>> j) & 1 ? "1" : "0";
        }
      } else {
        // For other bases, just use the number value as string
        bits = `${num}`;
      }
      result += bits;
    }
    return result || "0";
  }

  isEmpty(): boolean {
    if (this._ !== 0) return false;

    const len = this.data.size();
    for (let i = 0; i < len; i++) {
      if (this.data.get(i) !== 0) return false;
    }
    return true;
  }

  cardinality(): number {
    if (this._ !== 0) {
      return INFINITY;
    }

    let s = 0;
    const len = this.data.size();
    for (let i = 0; i < len; i++) {
      const n = this.data.get(i);
      if (n !== 0) s += BitSet.popCount(n);
    }
    return s;
  }

  msb(): number {
    if (this._ !== 0) {
      return INFINITY;
    }

    for (let i = this.data.size() - 1; i >= 0; i--) {
      const c = MathOps.clz32(this.data.get(i));
      if (c !== BitSet.WORD_LENGTH) {
        return i * BitSet.WORD_LENGTH + BitSet.WORD_LENGTH - 1 - c;
      }
    }
    return INFINITY;
  }

  ntz(): number {
    const len = this.data.size();
    for (let j = 0; j < len; j++) {
      let v = this.data.get(j);
      if (v !== 0) {
        v = (v ^ (v - 1)) >>> 1;
        return j * BitSet.WORD_LENGTH + BitSet.popCount(v);
      }
    }
    return INFINITY;
  }

  lsb(): number {
    const len = this.data.size();
    for (let i = 0; i < len; i++) {
      const v = this.data.get(i);
      if (v) {
        const bit = v & -v;
        let c = 0;
        for (let b = bit; (b >>>= 1); c++) {}
        return BitSet.WORD_LENGTH * i + c;
      }
    }
    return INFINITY;
  }

  equals(val: BitSet): boolean {
    if (this._ !== val._) return false;

    const maxLen = MathOps.max(this.data.size(), val.data.size());
    for (let i = 0; i < maxLen; i++) {
      const tv = i < this.data.size() ? this.data.get(i) : this._;
      const vv = i < val.data.size() ? val.data.get(i) : val._;
      if (tv !== vv) return false;
    }
    return true;
  }
}
