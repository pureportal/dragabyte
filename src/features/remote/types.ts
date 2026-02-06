export type RemoteStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface RemoteServer {
  id: string;
  name: string;
  host: string;
  port: number;
  token: string;
  favorite: boolean;
  status: RemoteStatus;
  lastMessage?: string | null;
}

export interface RemoteStatusPayload {
  status: RemoteStatus;
  message?: string | null;
  address?: string | null;
}

export interface RemoteListEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface RemoteListPayload {
  path: string | null;
  entries: RemoteListEntry[];
  os?: "windows" | "unix";
}

export interface RemoteEventPayload {
  event: string;
  id?: string | null;
  data?: unknown;
  message?: string | null;
}
