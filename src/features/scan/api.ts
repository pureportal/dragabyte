import { listen } from "@tauri-apps/api/event";
import { invokeCommand } from "../../lib/tauriInvoke";
import type { ScanOptions, ScanSummary } from "./types";

interface ScanHandlers {
  onProgress: (summary: ScanSummary) => void;
  onComplete: (summary: ScanSummary) => void;
  onError: (message: string) => void;
  onCancel: (message: string) => void;
}

export const startScan = async (
  path: string,
  options: ScanOptions,
  handlers: ScanHandlers,
): Promise<() => void> => {
  const [unlistenProgress, unlistenComplete, unlistenError, unlistenCancelled] =
    await Promise.all([
      listen<ScanSummary>("scan-progress", (event) => {
        handlers.onProgress(event.payload);
      }),
      listen<ScanSummary>("scan-complete", (event) => {
        handlers.onComplete(event.payload);
      }),
      listen<string>("scan-error", (event) => {
        handlers.onError(event.payload);
      }),
      listen<string>("scan-cancelled", (event) => {
        handlers.onCancel(event.payload);
      }),
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
