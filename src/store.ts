import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RemoteServer, RemoteStatus } from "./features/remote/types";

type ScanStatus = "idle" | "scanning" | "complete";

const SCAN_HISTORY_LIMIT = 10;

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
  remoteServers: RemoteServer[];
  activeRemoteServerId: string | null;
  remoteSyncEnabled: boolean;
  remoteInstallerStatus: "ready" | "unavailable";
  addRemoteServer: (server: RemoteServer) => void;
  removeRemoteServer: (id: string) => void;
  updateRemoteServer: (id: string, update: Partial<RemoteServer>) => void;
  toggleRemoteFavorite: (id: string) => void;
  updateRemoteServerStatus: (
    id: string,
    status: RemoteStatus,
    message?: string | null,
  ) => void;
  setActiveRemoteServerId: (id: string | null) => void;
  setRemoteSyncEnabled: (value: boolean) => void;
}

type FilterState = Pick<
  UIState,
  | "filterMode"
  | "simpleFilterIds"
  | "includeExtensionsInput"
  | "excludeExtensionsInput"
  | "includeNamesInput"
  | "excludeNamesInput"
  | "minSizeInput"
  | "maxSizeInput"
  | "includePathsInput"
  | "excludePathsInput"
  | "includeRegexInput"
  | "excludeRegexInput"
>;

const defaultFilterState: FilterState = {
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
};

const buildScanHistory = (
  history: string[],
  path: string,
  limit: number,
): string[] => {
  const next = [path, ...history.filter((value) => value !== path)];
  if (next.length <= limit) return next;
  return next.slice(0, limit);
};

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
          const newHistory = buildScanHistory(
            state.scanHistory,
            path,
            SCAN_HISTORY_LIMIT,
          );
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
      filterMode: defaultFilterState.filterMode,
      simpleFilterIds: [...defaultFilterState.simpleFilterIds],
      includeExtensionsInput: defaultFilterState.includeExtensionsInput,
      excludeExtensionsInput: defaultFilterState.excludeExtensionsInput,
      includeNamesInput: defaultFilterState.includeNamesInput,
      excludeNamesInput: defaultFilterState.excludeNamesInput,
      minSizeInput: defaultFilterState.minSizeInput,
      maxSizeInput: defaultFilterState.maxSizeInput,
      includePathsInput: defaultFilterState.includePathsInput,
      excludePathsInput: defaultFilterState.excludePathsInput,
      includeRegexInput: defaultFilterState.includeRegexInput,
      excludeRegexInput: defaultFilterState.excludeRegexInput,
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
          ...defaultFilterState,
          simpleFilterIds: [...defaultFilterState.simpleFilterIds],
        });
      },
      remoteServers: [],
      activeRemoteServerId: null,
      remoteSyncEnabled: true,
      remoteInstallerStatus: "ready",
      addRemoteServer: (server): void => {
        void set((state) => ({
          remoteServers: [...state.remoteServers, server],
        }));
      },
      removeRemoteServer: (id): void => {
        void set((state) => ({
          remoteServers: state.remoteServers.filter((item) => item.id !== id),
        }));
      },
      updateRemoteServer: (id, update): void => {
        void set((state) => ({
          remoteServers: state.remoteServers.map((item) =>
            item.id === id ? { ...item, ...update } : item,
          ),
        }));
      },
      toggleRemoteFavorite: (id): void => {
        void set((state) => ({
          remoteServers: state.remoteServers.map((item) =>
            item.id === id ? { ...item, favorite: !item.favorite } : item,
          ),
        }));
      },
      updateRemoteServerStatus: (id, status, message = null): void => {
        void set((state) => ({
          remoteServers: state.remoteServers.map((item) =>
            item.id === id ? { ...item, status, lastMessage: message } : item,
          ),
        }));
      },
      setActiveRemoteServerId: (id): void => {
        void set({ activeRemoteServerId: id });
      },
      setRemoteSyncEnabled: (value): void => {
        void set({ remoteSyncEnabled: value });
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
