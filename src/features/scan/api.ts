import { listen } from "@tauri-apps/api/event";
import { invokeCommand } from "../../lib/tauriInvoke";
import type { DiskUsage, ScanOptions, ScanSummary } from "./types";

interface ScanHandlers {
  onProgress: (summary: ScanSummary) => void;
  onComplete: (summary: ScanSummary) => void;
  onError: (message: string) => void;
  onCancel: (message: string) => void;
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
): Promise<() => void> => {
  const [unlistenProgress, unlistenComplete, unlistenError, unlistenCancelled] =
    await Promise.all([
      listenToScanEvent<ScanSummary>("scan-progress", handlers.onProgress),
      listenToScanEvent<ScanSummary>("scan-complete", handlers.onComplete),
      listenToScanEvent<string>("scan-error", handlers.onError),
      listenToScanEvent<string>("scan-cancelled", handlers.onCancel),
    ]);

  await invokeCommand<void>("scan_path", { path, options });

  return (): void => {
    unlistenProgress();
    unlistenComplete();
    unlistenError();
    unlistenCancelled();
  };
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

export const openPath = async (path: string): Promise<void> => {
  return invokeCommand<void>("open_path", { path });
};

export const showInExplorer = async (path: string): Promise<void> => {
  return invokeCommand<void>("show_in_explorer", { path });
};

export const getDiskUsage = async (path: string): Promise<DiskUsage> => {
  return invokeCommand<DiskUsage>("get_disk_usage", { path });
};
