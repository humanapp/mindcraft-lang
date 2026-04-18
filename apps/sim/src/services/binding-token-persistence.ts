const BINDING_TOKEN_KEY = "bridge-binding-token";

export function loadBindingToken(): string | undefined {
  try {
    return localStorage.getItem(BINDING_TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveBindingToken(token: string): void {
  try {
    localStorage.setItem(BINDING_TOKEN_KEY, token);
  } catch {
    // storage full or unavailable
  }
}

export function clearBindingToken(): void {
  try {
    localStorage.removeItem(BINDING_TOKEN_KEY);
  } catch {
    // storage unavailable
  }
}

export function hasBindingToken(): boolean {
  try {
    return localStorage.getItem(BINDING_TOKEN_KEY) !== null;
  } catch {
    return false;
  }
}
