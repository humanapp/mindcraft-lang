export class ScopeStack {
  private scopes: Map<string, number>[] = [new Map()];
  private _nextLocal: number;

  constructor(initialNextLocal: number) {
    this._nextLocal = initialNextLocal;
  }

  pushScope(): void {
    this.scopes.push(new Map());
  }

  popScope(): void {
    this.scopes.pop();
  }

  declareLocal(name: string): number {
    const idx = this._nextLocal++;
    this.scopes[this.scopes.length - 1].set(name, idx);
    return idx;
  }

  allocLocal(): number {
    return this._nextLocal++;
  }

  resolveLocal(name: string): number | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const idx = this.scopes[i].get(name);
      if (idx !== undefined) return idx;
    }
    return undefined;
  }

  get nextLocal(): number {
    return this._nextLocal;
  }
}
