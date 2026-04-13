const STORAGE_KEY = "ui-preferences";

export interface UiPreferences {
  collapsedArchetypes: Record<string, boolean>;
  timeScale: number;
  bridgeEnabled: boolean;
  debugEnabled: boolean;
}

const DEFAULTS: UiPreferences = {
  collapsedArchetypes: {},
  timeScale: 1,
  bridgeEnabled: false,
  debugEnabled: false,
};

let current: UiPreferences = load();

function load(): UiPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UiPreferences>;
      return {
        collapsedArchetypes: parsed.collapsedArchetypes ?? DEFAULTS.collapsedArchetypes,
        timeScale: typeof parsed.timeScale === "number" ? parsed.timeScale : DEFAULTS.timeScale,
        bridgeEnabled: parsed.bridgeEnabled === true,
        debugEnabled: parsed.debugEnabled === true,
      };
    }
  } catch {
    // corrupted data -- fall through to defaults
  }
  return { ...DEFAULTS };
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // storage full or unavailable
  }
}

export function getUiPreferences(): UiPreferences {
  return current;
}

export function updateUiPreferences(patch: Partial<UiPreferences>): void {
  current = { ...current, ...patch };
  persist();
}
