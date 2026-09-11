import { listen } from "@tauri-apps/api/event";
import { invokeCommand } from "../../lib/tauriInvoke";
import type { DiskUsage, ScanFailure, ScanOptions, ScanUpdate } from "./types";

interface ScanHandlers {
  onProgress: (update: ScanUpdate) => void;
  onComplete: (update: ScanUpdate) => void;
  onError: (message: string) => void;
  onCancel: (update: ScanUpdate) => void;
}

const listenToScanEvent = async <T>(
  eventName: string,
  handler: (payload: T) => void,
): Promise<() => void> => {
  const unlisten = await listen<T>(eventName, (event) => {
    handler(event.payload);
  });
  return (): void => {
    unlisten();
  };
};

export const startScan = async (
  path: string,
  options: ScanOptions,
  handlers: ScanHandlers,
  scanId: string,
): Promise<() => void> => {
  const listeners: (() => void)[] = [];
  let active = true;
  const cleanup = (): void => {
    active = false;
    listeners.splice(0).forEach((unlisten) => unlisten());
  };
  const subscribe = async <T extends { id: string }>(
    name: string,
    handler: (payload: T) => void,
    terminal = false,
  ): Promise<void> => {
    const unlisten = await listenToScanEvent<T>(name, (payload) => {
      if (!active || payload.id !== scanId) return;
      if (terminal) cleanup();
      handler(payload);
    });
    if (active) listeners.push(unlisten);
    else unlisten();
  };
  try {
    const subscriptions = await Promise.allSettled([
      subscribe("scan-progress", handlers.onProgress),
      subscribe("scan-complete", handlers.onComplete, true),
      subscribe<ScanFailure>("scan-error", (failure) => handlers.onError(failure.message), true),
      subscribe("scan-cancelled", handlers.onCancel, true),
    ]);
    const failed = subscriptions.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    await invokeCommand<void>("scan_path", { path, options, id: scanId });
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
};

export const cancelScan = async (): Promise<void> => {
  return invokeCommand<void>("cancel_scan");
};

export const checkContextMenu = async (): Promise<boolean> => {
  return invokeCommand<boolean>("is_context_menu_enabled");
};

export const toggleContextMenu = async (enable: boolean): Promise<void> => {
  return invokeCommand<void>("toggle_context_menu", { enable });
};

export const getStartupPath = async (): Promise<string | null> => {
  return invokeCommand<string | null>("get_startup_path");
};

export type LaunchContext = {
  path: string | null;
  paths: string[];
  mode: string;
};

export const getLaunchContext = async (): Promise<LaunchContext> => {
  return invokeCommand<LaunchContext>("get_launch_context");
};

export const openPath = async (path: string): Promise<void> => {
  return invokeCommand<void>("open_path", { path });
};

export const showInExplorer = async (path: string): Promise<void> => {
  return invokeCommand<void>("show_in_explorer", { path });
};

export const getDiskUsage = async (path: string): Promise<DiskUsage> => {
  return invokeCommand<DiskUsage>("get_disk_usage", { path });
};

export const deleteItem = async (path: string): Promise<void> => {
  return invokeCommand<void>("delete_item", { path });
};

export const renameItem = async (
  path: string,
  newPath: string,
): Promise<void> => {
  return invokeCommand<void>("rename_item", { path, newPath });
};

export const createFolder = async (path: string): Promise<void> => {
  return invokeCommand<void>("create_folder", { path });
};

export const copyItem = async (
  path: string,
  newPath: string,
): Promise<void> => {
  return invokeCommand<void>("copy_item", { path, newPath });
};
