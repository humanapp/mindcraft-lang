const STORAGE_KEY = "app-settings";

export interface AppSettings {
  vscodeBridgeUrl: string;
  showBridgePanel: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  vscodeBridgeUrl: "vscode-bridge.mindcraft-lang.org",
  showBridgePanel: false,
};

type Listener = (settings: AppSettings, prev: AppSettings) => void;

let current: AppSettings = load();

const listeners = new Set<Listener>();

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // corrupted data -- fall through to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

function persist(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function getAppSettings(): AppSettings {
  return current;
}

export function updateAppSettings(patch: Partial<AppSettings>): void {
  const prev = current;
  const merged = { ...current, ...patch };
  if (!merged.vscodeBridgeUrl.trim()) {
    merged.vscodeBridgeUrl = DEFAULT_SETTINGS.vscodeBridgeUrl;
  }
  current = merged;
  persist(current);
  for (const fn of listeners) {
    fn(current, prev);
  }
}

export function onAppSettingsChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
