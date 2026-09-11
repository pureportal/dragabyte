import { invoke } from "@tauri-apps/api/core";

type InvokePayload = Record<string, unknown> | undefined;

export const invokeCommand = async <T>(
  command: string,
  payload?: InvokePayload,
): Promise<T> => {
  return invoke<T>(command, payload);
};
