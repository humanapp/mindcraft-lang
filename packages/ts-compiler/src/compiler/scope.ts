export type ScopeKind = "function" | "block" | "module";

export interface ScopeMetadata {
  scopeId: number;
  kind: ScopeKind;
  parentScopeId: number | null;
  irStartIndex: number;
  irEndIndex: number;
  name: string | null;
}

export interface LocalMetadata {
  name: string;
  slotIndex: number;
  storageKind: "local" | "parameter" | "capture";
  scopeId: number;
  irStartIndex: number;
  typeHint: string | null;
}

export class ScopeStack {
  private scopes: Map<string, number>[] = [new Map()];
  private _nextLocal: number;
  private _nextScopeId = 0;
  private _scopeIdStack: number[] = [];
  private _scopeMetadata: ScopeMetadata[] = [];
  private _localMetadata: LocalMetadata[] = [];

  constructor(initialNextLocal: number) {
    this._nextLocal = initialNextLocal;
  }

  initFunctionScope(irIndex: number, name: string | null): number {
    const scopeId = this._nextScopeId++;
    this._scopeIdStack.push(scopeId);
    this._scopeMetadata.push({
      scopeId,
      kind: "function",
      parentScopeId: null,
      irStartIndex: irIndex,
      irEndIndex: -1,
      name,
    });
    return scopeId;
  }

  pushScope(irIndex: number, kind: ScopeKind = "block"): number {
    this.scopes.push(new Map());
    const scopeId = this._nextScopeId++;
    const parentScopeId = this._scopeIdStack.length > 0 ? this._scopeIdStack[this._scopeIdStack.length - 1] : null;
    this._scopeIdStack.push(scopeId);
    this._scopeMetadata.push({
      scopeId,
      kind,
      parentScopeId,
      irStartIndex: irIndex,
      irEndIndex: -1,
      name: null,
    });
    return scopeId;
  }

  popScope(irIndex: number): void {
    this.scopes.pop();
    const scopeId = this._scopeIdStack.pop();
    if (scopeId !== undefined) {
      const meta = this._scopeMetadata.find((s) => s.scopeId === scopeId);
      if (meta) meta.irEndIndex = irIndex;
    }
  }

  finalizeFunctionScope(irIndex: number): void {
    const scopeId = this._scopeIdStack.pop();
    if (scopeId !== undefined) {
      const meta = this._scopeMetadata.find((s) => s.scopeId === scopeId);
      if (meta) meta.irEndIndex = irIndex;
    }
  }

  declareLocal(name: string, typeHint?: string | null): number {
    const idx = this._nextLocal++;
    this.scopes[this.scopes.length - 1].set(name, idx);
    const scopeId = this._scopeIdStack.length > 0 ? this._scopeIdStack[this._scopeIdStack.length - 1] : 0;
    this._localMetadata.push({
      name,
      slotIndex: idx,
      storageKind: "local",
      scopeId,
      irStartIndex: -1,
      typeHint: typeHint ?? null,
    });
    return idx;
  }

  setLocalIrStart(slotIndex: number, irIndex: number): void {
    const meta = this._localMetadata.find((l) => l.slotIndex === slotIndex);
    if (meta && meta.irStartIndex === -1) meta.irStartIndex = irIndex;
  }

  addParameterMetadata(name: string, slotIndex: number, scopeId: number, typeHint?: string | null): void {
    this._localMetadata.push({
      name,
      slotIndex,
      storageKind: "parameter",
      scopeId,
      irStartIndex: 0,
      typeHint: typeHint ?? null,
    });
  }

  addCaptureMetadata(name: string, captureIndex: number, scopeId: number): void {
    this._localMetadata.push({
      name,
      slotIndex: captureIndex,
      storageKind: "capture",
      scopeId,
      irStartIndex: 0,
      typeHint: null,
    });
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

  get currentScopeId(): number {
    return this._scopeIdStack.length > 0 ? this._scopeIdStack[this._scopeIdStack.length - 1] : 0;
  }

  get scopeMetadata(): readonly ScopeMetadata[] {
    return this._scopeMetadata;
  }

  get localMetadata(): readonly LocalMetadata[] {
    return this._localMetadata;
  }
}
