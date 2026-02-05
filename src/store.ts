import { create } from "zustand";
import { persist } from "zustand/middleware";

type ScanStatus = "idle" | "scanning" | "complete";

interface UIState {
  isNavigationBarVisible: boolean;
  toggleNavigationBar: () => void;
  scanStatus: ScanStatus;
  setScanStatus: (value: ScanStatus) => void;
  scanHistory: string[];
  addScanHistory: (path: string) => void;
  clearScanHistory: () => void;
  showExplorerFiles: boolean;
  hideEmptyExplorerFolders: boolean;
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
  setShowExplorerFiles: (value: boolean) => void;
  setHideEmptyExplorerFolders: (value: boolean) => void;
  resetFilters: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      isNavigationBarVisible: false,
      toggleNavigationBar: (): void => {
        void set((state) => ({
          isNavigationBarVisible: !state.isNavigationBarVisible,
        }));
      },
      scanStatus: "idle",
      setScanStatus: (value): void => {
        void set({ scanStatus: value });
      },
      scanHistory: [],
      addScanHistory: (path: string): void => {
        void set((state) => {
          const newHistory = [
            path,
            ...state.scanHistory.filter((p) => p !== path),
          ].slice(0, 10);
          return { scanHistory: newHistory };
        });
      },
      clearScanHistory: (): void => {
        void set({ scanHistory: [] });
      },
      showExplorerFiles: false,
      hideEmptyExplorerFolders: false,
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
      setPriorityMode: (value): void => {
        void set({ priorityMode: value });
      },
      setThrottleLevel: (value): void => {
        void set({ throttleLevel: value });
      },
      setFilterMode: (value): void => {
        void set({ filterMode: value });
      },
      setSimpleFilterIds: (value): void => {
        void set({ simpleFilterIds: value });
      },
      setIncludeExtensionsInput: (value): void => {
        void set({ includeExtensionsInput: value });
      },
      setExcludeExtensionsInput: (value): void => {
        void set({ excludeExtensionsInput: value });
      },
      setIncludeNamesInput: (value): void => {
        void set({ includeNamesInput: value });
      },
      setExcludeNamesInput: (value): void => {
        void set({ excludeNamesInput: value });
      },
      setMinSizeInput: (value): void => {
        void set({ minSizeInput: value });
      },
      setMaxSizeInput: (value): void => {
        void set({ maxSizeInput: value });
      },
      setIncludePathsInput: (value): void => {
        void set({ includePathsInput: value });
      },
      setExcludePathsInput: (value): void => {
        void set({ excludePathsInput: value });
      },
      setIncludeRegexInput: (value): void => {
        void set({ includeRegexInput: value });
      },
      setExcludeRegexInput: (value): void => {
        void set({ excludeRegexInput: value });
      },
      setShowExplorerFiles: (value): void => {
        void set({ showExplorerFiles: value });
      },
      setHideEmptyExplorerFolders: (value): void => {
        void set({ hideEmptyExplorerFolders: value });
      },
      resetFilters: (): void => {
        void set({
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
        });
      },
    }),
    {
      name: "voxara-ui-storage",
      partialize: (state) => {
        const { scanStatus, ...rest } = state;
        return rest;
      },
    },
  ),
);
