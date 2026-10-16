import { applyMode, Mode } from "@cloudscape-design/global-styles";
import { create } from "zustand";

export type ThemeMode = "dark" | "light";

const KEY = "rolecraft.theme";

export function readStoredTheme(storage: Pick<Storage, "getItem"> | undefined): ThemeMode {
  try {
    return storage?.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function writeStoredTheme(storage: Pick<Storage, "setItem"> | undefined, mode: ThemeMode): void {
  try {
    storage?.setItem(KEY, mode);
  } catch {
    // storage unavailable; preference simply isn't persisted
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function apply(mode: ThemeMode): void {
  applyMode(mode === "dark" ? Mode.Dark : Mode.Light);
}

interface ThemeState {
  mode: ThemeMode;
  toggle(): void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = readStoredTheme(safeStorage());
  apply(initial);
  return {
    mode: initial,
    toggle() {
      const next: ThemeMode = get().mode === "dark" ? "light" : "dark";
      apply(next);
      writeStoredTheme(safeStorage(), next);
      set({ mode: next });
    },
  };
});
