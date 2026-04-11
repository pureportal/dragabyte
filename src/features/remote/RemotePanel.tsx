import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useState } from "react";
import { FiActivity, FiPower, FiServer, FiTrash2 } from "react-icons/fi";
import { MdDragIndicator } from "react-icons/md";
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

const getStatusColor = (status: RemoteStatus): string => {
  if (status === "connected") return "text-emerald-400";
  if (status === "connecting") return "text-blue-400";
  if (status === "error") return "text-red-400";
  return "text-slate-500";
};

const getStatusBadgeClasses = (status: RemoteStatus): string => {
  if (status === "connected")
    return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  if (status === "connecting")
    return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  if (status === "error") return "bg-red-500/10 text-red-400 border-red-500/20";
  return "bg-slate-800/50 text-slate-400 border-slate-700/50";
};

const getStatusLabel = (status: RemoteStatus): string => {
  if (status === "connected") return "Online";
  if (status === "connecting") return "Connecting...";
  if (status === "error") return "Error";
  return "Offline";
};

const getConnectBtnStyles = (status: RemoteStatus): string => {
  if (status === "connected") {
    return "bg-red-500/10 text-red-200 hover:bg-red-500/20 border-red-500/20";
  }
  if (status === "connecting") {
    return "bg-blue-500/10 text-blue-200 border-blue-500/20 opacity-50 cursor-not-allowed";
  }
  return "bg-slate-800 text-slate-200 hover:bg-slate-700 border-slate-700";
};

const buildServerLabel = (server: RemoteServer | null): string => {
  if (!server) return "No remote connected";
  return `${server.name} (${server.host}:${server.port})`;
};

const REMOTE_UNAUTHORIZED_MESSAGE = "Unauthorized token";

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

interface SortableServerItemProps {
  server: RemoteServer;
  activeRemoteServerId: string | null;
  connectingServerId: string | null;
  onConnect: (server: RemoteServer) => void;
  onDisconnect: (server: RemoteServer) => void;
  onUpdateName: (server: RemoteServer, value: string) => void;
  onUpdateToken: (server: RemoteServer, value: string) => void;
  onRemove: (id: string) => void;
}

const SortableServerItem = ({
  server,
  activeRemoteServerId,
  connectingServerId,
  onConnect,
  onDisconnect,
  onUpdateName,
  onUpdateToken,
  onRemove,
}: SortableServerItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: server.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group relative rounded-xl border p-4 transition-all duration-200 hover:border-slate-700 cursor-grab active:cursor-grabbing touch-none
        ${
          server.id === activeRemoteServerId
            ? "border-blue-500/50 bg-blue-500/5 shadow-[0_0_20px_-10px_rgba(59,130,246,0.2)]"
            : "border-slate-800 bg-slate-900/40 hover:bg-slate-900/60"
        }
      `}
    >
      <div className="flex items-start gap-4">
        {/* Drag Handle Icon - Just visual now */}
        <div className="flex flex-col items-center gap-2 pt-1 text-slate-600 hover:text-slate-400 p-1 pointer-events-none">
          <MdDragIndicator size={20} />
        </div>

        <div className="flex-1 min-w-0 space-y-4">
          {/* Header Row */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-end gap-2 mb-1">
                <span className="font-semibold text-slate-200 text-sm truncate">
                  {server.name}
                </span>
                <span className="text-xs text-slate-500 mb-0.5 font-mono">
                  {server.host}:{server.port}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className={`flex items-center gap-1.5 text-xs font-medium text-slate-400`}
                >
                  <span
                    className={`w-2 h-2 rounded-full border border-slate-900 ${
                      server.status === "connected"
                        ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                        : server.status === "connecting"
                          ? "bg-blue-500 animate-pulse"
                          : server.status === "error"
                            ? "bg-red-500"
                            : "bg-slate-600"
                    }`}
                  />
                  {getStatusLabel(server.status)}
                </div>
                {server.lastMessage && (
                  <span className="text-[10px] text-red-400 bg-red-500/5 px-2 py-0.5 rounded border border-red-500/10 truncate max-w-[200px]">
                    {server.lastMessage}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  if (server.status === "connected") {
                    onDisconnect(server);
                  } else {
                    onConnect(server);
                  }
                }}
                disabled={
                  server.status === "connecting" ||
                  Boolean(
                    connectingServerId && connectingServerId !== server.id,
                  )
                }
                title={server.status === "connected" ? "Disconnect" : "Connect"}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition-all flex items-center gap-2 cursor-pointer
                  ${getConnectBtnStyles(server.status)}
                `}
              >
                <FiPower
                  size={13}
                  className={server.status === "connected" ? "" : "-mt-0.5"}
                />
                <span>
                  {server.status === "connected" ? "Disconnect" : "Connect"}
                </span>
              </button>
            </div>
          </div>

          {/* Inputs Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800/50">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider ml-0.5">
                Edit Name
              </label>
              <input
                value={server.name}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => onUpdateName(server, e.target.value)}
                className="w-full bg-slate-950/50 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-300 focus:border-blue-500/40 focus:bg-slate-950 transition-colors"
                placeholder="Server Name"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider ml-0.5">
                Edit Token
              </label>
              <div className="flex gap-2">
                <input
                  value={server.token}
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) => onUpdateToken(server, e.target.value)}
                  type="password"
                  className="flex-1 bg-slate-950/50 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-300 focus:border-blue-500/40 focus:bg-slate-950 transition-colors font-mono"
                  placeholder="Access Token"
                />
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onRemove(server.id)}
                  className="p-1.5 rounded bg-slate-900 border border-slate-800 text-slate-500 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20 transition-colors cursor-pointer"
                  title="Remove Server"
                >
                  <FiTrash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const RemotePanel = (): JSX.Element => {
  const {
    remoteServers,
    activeRemoteServerId,
    addRemoteServer,
    setRemoteServers,
    removeRemoteServer,
    updateRemoteServer,
    updateRemoteServerStatus,
    setActiveRemoteServerId,
  } = useUIStore();
  const [nameInput, setNameInput] = useState("");
  const [hostInput, setHostInput] = useState("");
  const [portInput, setPortInput] = useState("4799");
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const activeServer = useMemo<RemoteServer | null>(() => {
    if (!activeRemoteServerId) return null;
    for (let i = 0; i < remoteServers.length; i += 1) {
      const server = remoteServers[i];
      if (server?.id === activeRemoteServerId) return server;
    }
    return null;
  }, [activeRemoteServerId, remoteServers]);
  const activeStatus = activeServer?.status ?? "disconnected";
  const isRemoteUnauthorized =
    activeServer?.status === "error" &&
    activeServer?.lastMessage === REMOTE_UNAUTHORIZED_MESSAGE;

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
          if (isRemoteUnauthorized) {
            return;
          }
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
  }, [
    activeRemoteServerId,
    isRemoteUnauthorized,
    setActiveRemoteServerId,
    updateRemoteServerStatus,
  ]);

  useEffect((): (() => void) => {
    let cleanup: (() => void) | null = null;
    listenRemoteStatus((payload) => {
      const state = useUIStore.getState();
      const servers = state.remoteServers;
      const activeId = state.activeRemoteServerId;

      const activeServerVal = activeId
        ? servers.find((s) => s.id === activeId)
        : null;
      const activeUnauthorized =
        activeServerVal?.status === "error" &&
        activeServerVal?.lastMessage === REMOTE_UNAUTHORIZED_MESSAGE;

      if (activeUnauthorized && payload.status === "connected") {
        return;
      }
      const matched = findServerByAddress(servers, payload.address ?? null);
      const targetId = matched?.id ?? activeId;
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
  }, [setActiveRemoteServerId, updateRemoteServerStatus]);

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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = remoteServers.findIndex((s) => s.id === active.id);
      const newIndex = remoteServers.findIndex((s) => s.id === over.id);
      setRemoteServers(arrayMove(remoteServers, oldIndex, newIndex));
    }
  };

  const handleSortByName = (): void => {
    const next = [...remoteServers].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
    setRemoteServers(next);
  };

  const handleSortByHost = (): void => {
    const next = [...remoteServers].sort((left, right) => {
      const hostCompare = left.host.localeCompare(right.host, undefined, {
        sensitivity: "base",
      });
      if (hostCompare !== 0) return hostCompare;
      return left.port - right.port;
    });
    setRemoteServers(next);
  };

  return (
    <div className="p-1 max-w-5xl mx-auto space-y-6">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/40 p-4 rounded-xl border border-slate-800/50">
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-lg bg-slate-800/50 ${getStatusColor(activeStatus)}`}
          >
            <FiActivity size={18} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
              Current Connection
            </p>
            <h3 className="text-lg font-bold text-slate-200">
              {buildServerLabel(activeServer)}
            </h3>
          </div>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusBadgeClasses(
            activeStatus,
          )}`}
        >
          {getStatusLabel(activeStatus)}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
          {error}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        {/* ADD SERVER FORM */}
        <div className="space-y-4">
          <div className="bg-slate-900/40 p-5 rounded-xl border border-slate-800/50 flex flex-col h-full">
            <div className="mb-4 flex items-center gap-2 text-slate-200">
              <FiServer className="text-blue-400" />
              <h3 className="font-semibold">Add Server</h3>
            </div>

            <div className="space-y-4 flex-1">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400 ml-1">
                  Name (Optional)
                </label>
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="e.g. Office NAS"
                  className="w-full rounded-lg border border-slate-700/50 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs font-medium text-slate-400 ml-1">
                    Host
                  </label>
                  <input
                    value={hostInput}
                    onChange={(e) => setHostInput(e.target.value)}
                    placeholder="192.168..."
                    className="w-full rounded-lg border border-slate-700/50 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400 ml-1">
                    Port
                  </label>
                  <input
                    value={portInput}
                    onChange={(e) => setPortInput(e.target.value)}
                    placeholder="4799"
                    className="w-full rounded-lg border border-slate-700/50 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400 ml-1">
                  Token
                </label>
                <input
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Paste access token"
                  className="w-full rounded-lg border border-slate-700/50 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleAddServer}
              className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-900/20 hover:bg-blue-500 active:scale-[0.98] transition-all"
            >
              Save Server
            </button>
          </div>
        </div>

        {/* SERVER LIST */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
              Saved Servers ({remoteServers.length})
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 mr-1">Sort by:</span>
              <button
                type="button"
                onClick={handleSortByName}
                className="text-xs font-medium text-slate-400 hover:text-slate-200 transition px-2 py-1 rounded hover:bg-slate-800"
              >
                Name
              </button>
              <button
                type="button"
                onClick={handleSortByHost}
                className="text-xs font-medium text-slate-400 hover:text-slate-200 transition px-2 py-1 rounded hover:bg-slate-800"
              >
                Host
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {remoteServers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/20 p-8 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-800/50 text-slate-500">
                  <FiServer size={24} />
                </div>
                <h4 className="text-sm font-medium text-slate-300">
                  No servers yet
                </h4>
                <p className="mt-1 text-xs text-slate-500">
                  Add a server to get started.
                </p>
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={remoteServers.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {remoteServers.map((server) => (
                    <SortableServerItem
                      key={server.id}
                      server={server}
                      activeRemoteServerId={activeRemoteServerId}
                      connectingServerId={connectingServerId}
                      onConnect={handleConnect}
                      onDisconnect={handleDisconnect}
                      onUpdateName={handleUpdateName}
                      onUpdateToken={handleUpdateToken}
                      onRemove={removeRemoteServer}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RemotePanel;
