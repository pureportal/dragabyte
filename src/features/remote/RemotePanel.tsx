import { useEffect, useMemo, useState } from "react";
import { useUIStore } from "../../store";
import {
  connectRemote,
  disconnectRemote,
  listenRemoteStatus,
  requestRemoteStatus,
} from "./api";
import type { RemoteServer, RemoteStatus } from "./types";

const createId = (): string => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const parsePort = (value: string): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 1 || parsed > 65535) return null;
  return Math.floor(parsed);
};

const getStatusBadgeClasses = (status: RemoteStatus): string => {
  if (status === "connected") return "bg-emerald-500/15 text-emerald-200";
  if (status === "connecting") return "bg-blue-500/15 text-blue-200";
  if (status === "error") return "bg-red-500/15 text-red-200";
  return "bg-slate-800/60 text-slate-400";
};

const getStatusLabel = (status: RemoteStatus): string => {
  if (status === "connected") return "Online";
  if (status === "connecting") return "Connecting";
  if (status === "error") return "Error";
  return "Offline";
};

const getActionLabel = (status: RemoteStatus): string => {
  if (status === "connected") return "Disconnect";
  if (status === "connecting") return "Connecting";
  return "Connect";
};

const getActionButtonClasses = (status: RemoteStatus): string => {
  if (status === "connected") {
    return "border-red-500/50 bg-red-500/10 text-red-200 hover:bg-red-500/20";
  }
  if (status === "connecting") {
    return "border-blue-500/40 bg-blue-500/10 text-blue-200";
  }
  return "border-slate-700 bg-slate-900/60 text-slate-200 hover:bg-slate-800";
};

const buildServerLabel = (server: RemoteServer | null): string => {
  if (!server) return "No remote connected";
  return `${server.name} (${server.host}:${server.port})`;
};

const formatConnectError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message || "Connection failed";
  }
  if (typeof error === "string") {
    return error.trim() || "Connection failed";
  }
  return "Connection failed";
};

type ServerInputResult =
  | {
      error: string;
    }
  | {
      data: {
        name: string;
        host: string;
        port: number;
        token: string;
      };
    };

const getServerInput = (
  nameInput: string,
  hostInput: string,
  portInput: string,
  tokenInput: string,
): ServerInputResult => {
  const port = parsePort(portInput);
  const host = hostInput.trim();
  const name = nameInput.trim();
  const token = tokenInput.trim();
  if (!host || port === null) {
    return { error: "Provide a valid host and port." };
  }
  if (!token) {
    return { error: "Token is required for authentication." };
  }
  return { data: { name, host, port, token } };
};

const resetConnectingServers = (
  servers: RemoteServer[],
  activeId: string,
  updateStatus: (
    id: string,
    status: RemoteStatus,
    message?: string | null,
  ) => void,
): void => {
  for (let i = 0; i < servers.length; i += 1) {
    const server = servers[i];
    if (!server || server.id === activeId) continue;
    if (server.status === "connecting") {
      updateStatus(server.id, "disconnected", null);
    }
  }
};

const findServerByAddress = (
  servers: RemoteServer[],
  address?: string | null,
): RemoteServer | null => {
  if (!address) return null;
  const normalized = address.trim();
  if (!normalized) return null;
  for (let i = 0; i < servers.length; i += 1) {
    const server = servers[i];
    if (!server) continue;
    const serverAddress = `${server.host}:${server.port}`;
    if (serverAddress === normalized) return server;
  }
  return null;
};

const RemotePanel = (): JSX.Element => {
  const {
    remoteServers,
    activeRemoteServerId,
    remoteSyncEnabled,
    remoteInstallerStatus,
    addRemoteServer,
    removeRemoteServer,
    updateRemoteServer,
    toggleRemoteFavorite,
    updateRemoteServerStatus,
    setActiveRemoteServerId,
    setRemoteSyncEnabled,
  } = useUIStore();
  const [nameInput, setNameInput] = useState("");
  const [hostInput, setHostInput] = useState("");
  const [portInput, setPortInput] = useState("4799");
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const activeServer = useMemo<RemoteServer | null>(() => {
    if (!activeRemoteServerId) return null;
    for (let i = 0; i < remoteServers.length; i += 1) {
      const server = remoteServers[i];
      if (server?.id === activeRemoteServerId) return server;
    }
    return null;
  }, [activeRemoteServerId, remoteServers]);
  const activeStatus = activeServer?.status ?? "disconnected";

  const favoriteCount = useMemo<number>(() => {
    let count = 0;
    for (let i = 0; i < remoteServers.length; i += 1) {
      if (remoteServers[i]?.favorite) count += 1;
    }
    return count;
  }, [remoteServers]);

  const connectingServerId = useMemo<string | null>(() => {
    for (let i = 0; i < remoteServers.length; i += 1) {
      const server = remoteServers[i];
      if (server?.status === "connecting") return server.id;
    }
    return null;
  }, [remoteServers]);

  useEffect((): (() => void) => {
    let active = true;
    requestRemoteStatus()
      .then((status) => {
        if (!active || !activeRemoteServerId) return;
        if (status.connected) {
          updateRemoteServerStatus(activeRemoteServerId, "connected");
          return;
        }
        updateRemoteServerStatus(activeRemoteServerId, "disconnected", null);
        setActiveRemoteServerId(null);
      })
      .catch(() => undefined);
    return (): void => {
      active = false;
    };
  }, [activeRemoteServerId, setActiveRemoteServerId, updateRemoteServerStatus]);

  useEffect((): (() => void) => {
    let cleanup: (() => void) | null = null;
    listenRemoteStatus((payload) => {
      const matched = findServerByAddress(
        remoteServers,
        payload.address ?? null,
      );
      const targetId = matched?.id ?? activeRemoteServerId;
      if (!targetId) return;
      updateRemoteServerStatus(
        targetId,
        payload.status,
        payload.message ?? null,
      );
      if (payload.status === "connected" && matched?.id) {
        setActiveRemoteServerId(matched.id);
      }
    })
      .then((unlisten) => {
        cleanup = unlisten;
      })
      .catch(() => undefined);
    return (): void => {
      cleanup?.();
    };
  }, [
    activeRemoteServerId,
    remoteServers,
    setActiveRemoteServerId,
    updateRemoteServerStatus,
  ]);

  const handleAddServer = (): void => {
    const result = getServerInput(nameInput, hostInput, portInput, tokenInput);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    const { name, host, port, token } = result.data;
    const server: RemoteServer = {
      id: createId(),
      name: name || host,
      host,
      port,
      token,
      favorite: false,
      status: "disconnected",
      lastMessage: null,
    };
    addRemoteServer(server);
    setActiveRemoteServerId(server.id);
    setNameInput("");
    setHostInput("");
    setPortInput("4799");
    setTokenInput("");
    setError(null);
  };

  const handleConnect = async (server: RemoteServer): Promise<void> => {
    if (!server.token.trim()) {
      setError("Token is required for authentication.");
      return;
    }
    if (connectingServerId && connectingServerId !== server.id) {
      setError("Another connection is in progress.");
      return;
    }
    setError(null);
    setActiveRemoteServerId(server.id);
    resetConnectingServers(remoteServers, server.id, updateRemoteServerStatus);
    updateRemoteServerStatus(server.id, "connecting");
    try {
      await connectRemote(server);
    } catch (err) {
      const message = formatConnectError(err);
      updateRemoteServerStatus(server.id, "error", message);
      setError(message);
    }
  };

  const handleDisconnect = async (server: RemoteServer): Promise<void> => {
    setError(null);
    setActiveRemoteServerId(server.id);
    try {
      await disconnectRemote();
      updateRemoteServerStatus(server.id, "disconnected", null);
    } catch (err) {
      const message = formatConnectError(err);
      updateRemoteServerStatus(server.id, "error", message);
      setError(message);
    }
  };

  const handleUpdateName = (server: RemoteServer, value: string): void => {
    updateRemoteServer(server.id, { name: value });
  };

  const handleUpdateToken = (server: RemoteServer, value: string): void => {
    updateRemoteServer(server.id, { token: value });
  };

  return (
    <div className="rounded-xl border border-slate-800/70 bg-slate-900/45 px-4 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-500">
            Remote Management
          </p>
          <h3 className="text-lg font-semibold text-slate-100">
            {buildServerLabel(activeServer)}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded-full px-2 py-1 ${getStatusBadgeClasses(
              activeStatus,
            )}`}
          >
            {getStatusLabel(activeStatus)}
          </span>
          <span className="rounded-full bg-slate-800/60 px-2 py-1 text-slate-300">
            Favorites: {favoriteCount}
          </span>
          <button
            type="button"
            onClick={(): void => setRemoteSyncEnabled(!remoteSyncEnabled)}
            className={`rounded-full px-2 py-1 transition ${
              remoteSyncEnabled
                ? "bg-blue-500/15 text-blue-200"
                : "bg-slate-800/60 text-slate-400"
            }`}
          >
            Sync: {remoteSyncEnabled ? "On" : "Off"}
          </button>
          <span className="rounded-full bg-slate-800/60 px-2 py-1 text-slate-300">
            Installer: {remoteInstallerStatus === "ready" ? "Ready" : "N/A"}
          </span>
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(240px,_1fr)_minmax(340px,_1.4fr)]">
        <div className="rounded-lg border border-slate-800/60 bg-slate-950/40 p-3">
          <p className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">
            Add Server
          </p>
          <div className="grid gap-2">
            <input
              value={nameInput}
              onChange={(event): void => setNameInput(event.target.value)}
              placeholder="Name (optional)"
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
            />
            <input
              value={hostInput}
              onChange={(event): void => setHostInput(event.target.value)}
              placeholder="Host"
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
            />
            <input
              value={portInput}
              onChange={(event): void => setPortInput(event.target.value)}
              placeholder="Port"
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
            />
            <input
              value={tokenInput}
              onChange={(event): void => setTokenInput(event.target.value)}
              placeholder="Token (required)"
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
            />
            <button
              type="button"
              onClick={handleAddServer}
              className="rounded-md bg-blue-500/80 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500"
            >
              Save Server
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/60 bg-slate-950/40 p-3">
          <p className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">
            Servers
          </p>
          <div className="grid gap-2">
            {remoteServers.length === 0 ? (
              <p className="text-xs text-slate-500">No remote servers saved.</p>
            ) : (
              remoteServers.map((server) => (
                <div
                  key={server.id}
                  className={`rounded-lg border px-3 py-2 text-xs transition ${
                    server.id === activeRemoteServerId
                      ? "border-blue-500/60 bg-blue-500/5"
                      : "border-slate-800/60 bg-slate-950/40"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-slate-200 font-semibold">
                        {server.name}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {server.host}:{server.port}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 ${getStatusBadgeClasses(
                          server.status,
                        )}`}
                      >
                        {getStatusLabel(server.status)}
                      </span>
                      <button
                        type="button"
                        onClick={(): void => toggleRemoteFavorite(server.id)}
                        className={`rounded-full px-2 py-0.5 transition ${
                          server.favorite
                            ? "bg-amber-500/20 text-amber-200"
                            : "bg-slate-800/60 text-slate-400"
                        }`}
                      >
                        {server.favorite ? "★" : "☆"}
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2 lg:grid-cols-3">
                    <input
                      value={server.name}
                      onChange={(event): void =>
                        handleUpdateName(server, event.target.value)
                      }
                      className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200"
                    />
                    <input
                      value={server.token}
                      onChange={(event): void =>
                        handleUpdateToken(server, event.target.value)
                      }
                      className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={(): void => {
                          if (server.status === "connected") {
                            void handleDisconnect(server);
                            return;
                          }
                          void handleConnect(server);
                        }}
                        disabled={
                          server.status === "connecting" ||
                          Boolean(
                            connectingServerId &&
                            connectingServerId !== server.id,
                          )
                        }
                        className={`flex-1 rounded-md border px-2 py-1 text-[11px] transition ${getActionButtonClasses(
                          server.status,
                        )} ${
                          server.status === "connecting" ||
                          (connectingServerId &&
                            connectingServerId !== server.id)
                            ? "cursor-not-allowed opacity-60"
                            : ""
                        }`}
                      >
                        {getActionLabel(server.status)}
                      </button>
                      <button
                        type="button"
                        onClick={(): void => removeRemoteServer(server.id)}
                        className="rounded-md border border-red-500/50 bg-red-500/10 px-2 py-1 text-[11px] text-red-200 hover:bg-red-500/20"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {server.lastMessage ? (
                    <p className="mt-2 text-[10px] text-slate-500">
                      {server.lastMessage}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RemotePanel;
