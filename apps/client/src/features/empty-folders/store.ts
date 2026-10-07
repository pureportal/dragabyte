import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultSettings } from "./model";
import type { EmptyFolderSettings } from "./types";

interface EmptyFolderPreferences {
  sources: string[];
  settings: EmptyFolderSettings;
  setSources: (sources: string[]) => void;
  setSettings: (settings: EmptyFolderSettings) => void;
}

export const useEmptyFolderPreferences = create<EmptyFolderPreferences>()(
  persist(
    (set) => ({
      sources: [],
      settings: defaultSettings,
      setSources: (sources) => set({ sources }),
      setSettings: (settings) => set({ settings }),
    }),
    { name: "dragabyte-empty-folders" },
  ),
);
