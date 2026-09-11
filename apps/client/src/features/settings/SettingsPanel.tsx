import { useEffect, useMemo, useRef, useState } from "react";
import { toErrorMessage } from "../../lib/utils";
import {
  fetchSettings,
  fetchTcpStatus,
  resetContextMenu,
  saveSettings,
} from "./api";
import type { TcpStatus } from "./types";

const TOKEN_LENGTH = 30;
const TOKEN_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const generateLocalToken = (): string => {
  const bytes = new Uint32Array(TOKEN_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let token = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const index = (bytes[i] ?? 0) % TOKEN_CHARS.length;
    token += TOKEN_CHARS[index] ?? "";
  }
  return token;
};

const validateTcpBind = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "localhost") {
    return "Use an IP address like 127.0.0.1:4799.";
  }
  const match = trimmed.match(/^(.*):(\d+)$/);
  if (!match) {
    return "Bind address must include a port (e.g. 127.0.0.1:4799).";
  }
  const host = match[1]?.trim();
  const portValue = Number(match[2]);
  if (!host) {
    return "Bind address host is required.";
  }
  if (!Number.isFinite(portValue) || portValue < 1 || portValue > 65535) {
    return "Port must be between 1 and 65535.";
  }
  return null;
};

const refreshTcpStatus = async (
  setTcpStatus: (value: TcpStatus | null) => void,
): Promise<void> => {
  try {
    const status = await fetchTcpStatus();
    setTcpStatus(status);
  } catch {
    return;
  }
};

const SettingsPanel = (): JSX.Element => {
  const [localToken, setLocalToken] = useState("");
  const [tcpBind, setTcpBind] = useState("");
  const [headless, setHeadless] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isResettingMenu, setIsResettingMenu] = useState(false);
  const [tcpStatus, setTcpStatus] = useState<TcpStatus | null>(null);
  const autoTokenRef = useRef(false);

  const tcpBindError = useMemo(() => {
    return validateTcpBind(tcpBind);
  }, [tcpBind]);

  useEffect((): void => {
    const loadSettings = async (): Promise<void> => {
      const [settingsResult, tcpResult] = await Promise.allSettled([
        fetchSettings(),
        fetchTcpStatus(),
      ]);
      if (settingsResult.status === "fulfilled") {
        const settings = settingsResult.value;
        setLocalToken(settings.localToken ?? "");
        setTcpBind(settings.tcpBind ?? "");
        setHeadless(Boolean(settings.headless));
        setAutoUpdate(settings.autoUpdate ?? true);
        if (!settings.localToken && !autoTokenRef.current) {
          const generated = generateLocalToken();
          autoTokenRef.current = true;
          setLocalToken(generated);
          saveSettings({
            localToken: generated,
            tcpBind: settings.tcpBind ?? null,
            headless: Boolean(settings.headless),
            autoUpdate: settings.autoUpdate ?? true,
          })
            .then(() => {
              setStatus("Generated a new local TCP token.");
              void refreshTcpStatus(setTcpStatus);
            })
            .catch(() => {
              setStatus("Failed to auto-generate token. Please save manually.");
            });
        }
      } else {
        setStatus("Failed to load settings.");
      }
      if (tcpResult.status === "fulfilled") {
        setTcpStatus(tcpResult.value);
      }
    };
    void loadSettings();
  }, []);

  const handleSave = async (): Promise<void> => {
    if (tcpBindError) {
      setStatus(tcpBindError);
      return;
    }
    setStatus(null);
    setIsSaving(true);
    try {
      await saveSettings({
        localToken: localToken.trim() || null,
        tcpBind: tcpBind.trim() || null,
        headless,
        autoUpdate,
      });
      setStatus("Saved. Restart required to apply TCP/headless changes.");
      void refreshTcpStatus(setTcpStatus);
    } catch (err) {
      setStatus(`Failed to save settings: ${toErrorMessage(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetContextMenu = async (): Promise<void> => {
    setStatus(null);
    setIsResettingMenu(true);
    try {
      await resetContextMenu();
      setStatus("Context menu integration reset.");
    } catch (err) {
      setStatus(`Failed to reset context menu: ${toErrorMessage(err)}`);
    } finally {
      setIsResettingMenu(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-950/40 p-3">
      <p className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">
        Settings
      </p>
      <div className="grid gap-2">
        <label className="text-xs text-slate-400">
          Local TCP Token (required for inbound connections)
          <input
            value={localToken}
            onChange={(event): void => setLocalToken(event.target.value)}
            placeholder="Set a token"
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
          />
        </label>
        <label className="text-xs text-slate-400">
          TCP Bind Address
          <input
            value={tcpBind}
            onChange={(event): void => setTcpBind(event.target.value)}
            placeholder="127.0.0.1:4799"
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
          />
        </label>
        {tcpBindError ? (
          <p className="text-[11px] text-amber-200">{tcpBindError}</p>
        ) : null}
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 ${
              tcpStatus?.enabled
                ? "bg-emerald-500/15 text-emerald-200"
                : "bg-slate-800/60 text-slate-400"
            }`}
          >
            Server: {tcpStatus?.enabled ? "Running" : "Stopped"}
          </span>
          {tcpStatus?.enabled && tcpStatus.bind ? (
            <span className="text-slate-500">{tcpStatus.bind}</span>
          ) : null}
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={headless}
            onChange={(event): void => setHeadless(event.target.checked)}
            className="h-3.5 w-3.5 accent-blue-500"
          />
          Enable headless mode by default
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={autoUpdate}
            onChange={(event): void => setAutoUpdate(event.target.checked)}
            className="h-3.5 w-3.5 accent-blue-500"
          />
          Enable automatic updates
        </label>
        <button
          type="button"
          onClick={(): void => {
            void handleSave();
          }}
          disabled={isSaving}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
            isSaving
              ? "cursor-not-allowed bg-slate-800/50 text-slate-400"
              : "bg-slate-800/70 text-slate-200 hover:bg-slate-800"
          }`}
        >
          {isSaving ? "Saving..." : "Save Settings"}
        </button>
        <button
          type="button"
          onClick={(): void => {
            void handleResetContextMenu();
          }}
          disabled={isResettingMenu}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
            isResettingMenu
              ? "cursor-not-allowed bg-slate-800/50 text-slate-400"
              : "bg-slate-800/70 text-slate-200 hover:bg-slate-800"
          }`}
        >
          {isResettingMenu ? "Resetting..." : "Reset Context Menu"}
        </button>
        {status ? <p className="text-[11px] text-slate-400">{status}</p> : null}
      </div>
    </div>
  );
};

export default SettingsPanel;
