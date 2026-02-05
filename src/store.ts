import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  isNavigationBarVisible: boolean;
  toggleNavigationBar: () => void;
  scanHistory: string[];
  addScanHistory: (path: string) => void;
  clearScanHistory: () => void;
  priorityMode: "performance" | "balanced" | "low";
  throttleLevel: "off" | "low" | "medium" | "high";
  filterMode: "simple" | "advanced";
  simpleFilterIds: string[];
  includeExtensionsInput: string;
  excludeExtensionsInput: string;
  includeNamesInput: string;
  excludeNamesInput: string;
  minSizeInput: string;
  maxSizeInput: string;
  includePathsInput: string;
  excludePathsInput: string;
  includeRegexInput: string;
  excludeRegexInput: string;
  setPriorityMode: (value: "performance" | "balanced" | "low") => void;
  setThrottleLevel: (value: "off" | "low" | "medium" | "high") => void;
  setFilterMode: (value: "simple" | "advanced") => void;
  setSimpleFilterIds: (value: string[]) => void;
  setIncludeExtensionsInput: (value: string) => void;
  setExcludeExtensionsInput: (value: string) => void;
  setIncludeNamesInput: (value: string) => void;
  setExcludeNamesInput: (value: string) => void;
  setMinSizeInput: (value: string) => void;
  setMaxSizeInput: (value: string) => void;
  setIncludePathsInput: (value: string) => void;
  setExcludePathsInput: (value: string) => void;
  setIncludeRegexInput: (value: string) => void;
  setExcludeRegexInput: (value: string) => void;
  resetFilters: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      isNavigationBarVisible: false,
      toggleNavigationBar: (): void =>
        set((state) => ({
          isNavigationBarVisible: !state.isNavigationBarVisible,
        })),
      scanHistory: [],
      addScanHistory: (path: string): void =>
        set((state) => {
          const newHistory = [
            path,
            ...state.scanHistory.filter((p) => p !== path),
          ].slice(0, 10);
          return { scanHistory: newHistory };
        }),
      clearScanHistory: (): void => set({ scanHistory: [] }),
      priorityMode: "balanced",
      throttleLevel: "off",
      filterMode: "simple",
      simpleFilterIds: [],
      includeExtensionsInput: "",
      excludeExtensionsInput: "",
      includeNamesInput: "",
      excludeNamesInput: "",
      minSizeInput: "",
      maxSizeInput: "",
      includePathsInput: "",
      excludePathsInput: "",
      includeRegexInput: "",
      excludeRegexInput: "",
      setPriorityMode: (value): void => set({ priorityMode: value }),
      setThrottleLevel: (value): void => set({ throttleLevel: value }),
      setFilterMode: (value): void => set({ filterMode: value }),
      setSimpleFilterIds: (value): void => set({ simpleFilterIds: value }),
      setIncludeExtensionsInput: (value): void =>
        set({ includeExtensionsInput: value }),
      setExcludeExtensionsInput: (value): void =>
        set({ excludeExtensionsInput: value }),
      setIncludeNamesInput: (value): void => set({ includeNamesInput: value }),
      setExcludeNamesInput: (value): void => set({ excludeNamesInput: value }),
      setMinSizeInput: (value): void => set({ minSizeInput: value }),
      setMaxSizeInput: (value): void => set({ maxSizeInput: value }),
      setIncludePathsInput: (value): void => set({ includePathsInput: value }),
      setExcludePathsInput: (value): void => set({ excludePathsInput: value }),
      setIncludeRegexInput: (value): void => set({ includeRegexInput: value }),
      setExcludeRegexInput: (value): void => set({ excludeRegexInput: value }),
      resetFilters: (): void =>
        set({
          filterMode: "simple",
          simpleFilterIds: [],
          includeExtensionsInput: "",
          excludeExtensionsInput: "",
          includeNamesInput: "",
          excludeNamesInput: "",
          minSizeInput: "",
          maxSizeInput: "",
          includePathsInput: "",
          excludePathsInput: "",
          includeRegexInput: "",
          excludeRegexInput: "",
        }),
    }),
    {
      name: "voxara-ui-storage",
    },
  ),
);
