import { invokeCommand } from "../../lib/tauriInvoke";
import type { AppSettings, AppSettingsUpdate, TcpStatus } from "./types";

export const fetchSettings = async (): Promise<AppSettings> => {
  return invokeCommand<AppSettings>("get_settings");
};

export const saveSettings = async (
  update: AppSettingsUpdate,
): Promise<AppSettings> => {
  return invokeCommand<AppSettings>("update_settings", { update });
};

export const fetchTcpStatus = async (): Promise<TcpStatus> => {
  return invokeCommand<TcpStatus>("get_tcp_status");
};
