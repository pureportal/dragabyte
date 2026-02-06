import { listen } from "@tauri-apps/api/event";
import { invokeCommand } from "../../lib/tauriInvoke";
import type {
  RemoteEventPayload,
  RemoteServer,
  RemoteStatusPayload,
} from "./types";

interface RemoteStatusSnapshot {
  connected: boolean;
  address?: string | null;
}

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return "<unserializable>";
  }
};

const listenToRemoteEvent = async <T>(
  eventName: string,
  handler: (payload: T) => void,
): Promise<() => void> => {
  const unlisten = await listen<T>(eventName, (event) => {
    console.debug(`[remote] ${eventName} event`, event.payload);
    handler(event.payload);
  });
  return (): void => {
    unlisten();
  };
};

export const connectRemote = async (server: RemoteServer): Promise<void> => {
  console.debug("[remote] connect", {
    host: server.host,
    port: server.port,
    hasToken: Boolean(server.token),
  });
  await invokeCommand<void>("remote_connect", {
    payload: {
      host: server.host,
      port: server.port,
      token: server.token || null,
    },
  });
};

export const disconnectRemote = async (): Promise<void> => {
  console.debug("[remote] disconnect");
  await invokeCommand<void>("remote_disconnect");
};

export const sendRemote = async (
  payload?: Record<string, unknown> | null,
): Promise<void> => {
  const safePayload = payload ?? {};
  console.debug("[remote] send", safePayload);
  console.debug("[remote] send json", safeStringify(safePayload));
  await invokeCommand<void>("remote_send", {
    payload: { payload: safePayload },
  });
};

export const requestRemoteList = async (
  id: string,
  path?: string | null,
): Promise<void> => {
  console.debug("[remote] list", { id, path: path ?? null });
  await sendRemote({ action: "list", id, path: path ?? null });
};

export const requestRemoteDiskUsage = async (
  id: string,
  path: string,
): Promise<void> => {
  console.debug("[remote] disk", { id, path });
  await sendRemote({ action: "disk", id, path });
};

export const requestRemoteStatus = async (): Promise<RemoteStatusSnapshot> => {
  console.debug("[remote] status request");
  return invokeCommand<RemoteStatusSnapshot>("remote_status");
};

export const listenRemoteStatus = async (
  handler: (payload: RemoteStatusPayload) => void,
): Promise<() => void> => {
  return listenToRemoteEvent("remote-status", handler);
};

export const listenRemoteEvent = async (
  handler: (payload: RemoteEventPayload) => void,
): Promise<() => void> => {
  return listenToRemoteEvent("remote-event", handler);
};
