import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";
import { fetchSettings } from "../features/settings/api";
import { toErrorMessage } from "../lib/utils";

const SKIPPED_VERSION_KEY = "updater.skippedVersion";

const logInfo = (message: string): void => {
  console.info(`[updater] ${message}`);
};

const logError = (error: unknown): void => {
  console.error(`[updater] ${toErrorMessage(error)}`);
};

const getSkippedVersion = (): string | null => {
  try {
    return window.localStorage.getItem(SKIPPED_VERSION_KEY);
  } catch {
    return null;
  }
};

const setSkippedVersion = (version: string): void => {
  try {
    window.localStorage.setItem(SKIPPED_VERSION_KEY, version);
  } catch {
    return;
  }
};

const clearSkippedVersion = (): void => {
  try {
    window.localStorage.removeItem(SKIPPED_VERSION_KEY);
  } catch {
    return;
  }
};

export const UpdateModal = (): JSX.Element | null => {
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState<
    "idle" | "available" | "downloading" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [contentLength, setContentLength] = useState<number>(0);
  const [downloaded, setDownloaded] = useState<number>(0);

  useEffect(() => {
    const init = async (): Promise<void> => {
      try {
        const settings = await fetchSettings();
        if (settings.autoUpdate === false) return;

        const available = await check();
        if (!available) return;

        if (getSkippedVersion() === available.version) {
          logInfo(`Skipped version ${available.version}`);
          return;
        }

        setUpdate(available);
        setStatus("available");
      } catch (err) {
        logError(err);
      }
    };
    void init();
  }, []);

  const handleSkip = (): void => {
    if (update) {
      setSkippedVersion(update.version);
      logInfo(`User skipped version ${update.version}`);
    }
    setStatus("idle");
  };

  const handleRemindLater = (): void => {
    if (update) {
      logInfo(`User chose remind later for ${update.version}`);
    }
    setStatus("idle");
  };

  const handleUpdate = async (): Promise<void> => {
    if (!update) return;
    setStatus("downloading");
    setDownloaded(0);
    setContentLength(0);

    try {
      clearSkippedVersion();
      logInfo(`Update ${update.currentVersion} -> ${update.version}`);
      
      let downloadedBytes = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            setContentLength(event.data.contentLength ?? 0);
            break;
          case "Progress":
            downloadedBytes += event.data.chunkLength;
            setDownloaded(downloadedBytes);
            break;
          case "Finished":
            break;
        }
      });
      await relaunch();
    } catch (err) {
      logError(err);
      setErrorMsg(toErrorMessage(err));
      setStatus("error");
    }
  };

  const progressPercentage =
    contentLength > 0 ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : 0;

  if (status === "idle" || !update) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 shadow-2xl ring-1 ring-slate-800/60 scale-in duration-200 overflow-hidden">
        <div className="p-5">
          <h3 className="text-lg font-semibold text-slate-100 mb-2">
            Update Available
          </h3>
          {status === "available" && (
            <p className="text-sm text-slate-400 leading-relaxed mb-1">
              Version <strong className="text-slate-200 font-medium">{update.version}</strong> is ready to install.
              You are currently on version {update.currentVersion}.
            </p>
          )}
          {status === "downloading" && (
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex justify-between text-xs text-slate-400 font-medium">
                <span>Downloading update...</span>
                <span>{progressPercentage}%</span>
              </div>
              <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
            </div>
          )}
          {status === "error" && (
            <p className="text-sm text-red-400 leading-relaxed bg-red-950/30 p-3 rounded-md border border-red-900/50">
              Download failed: {errorMsg}
            </p>
          )}
        </div>
        
        <div className="flex justify-end gap-3 p-4 border-t border-slate-800 bg-slate-900/50">
          {status === "error" ? (
            <button
              onClick={() => setStatus("idle")}
              className="px-3 py-1.5 rounded-md text-sm font-medium border border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600"
            >
              Close
            </button>
          ) : status === "available" ? (
            <>
              <button
                onClick={handleSkip}
                className="px-3 py-1.5 rounded-md text-sm font-medium text-slate-400 hover:text-slate-200 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600"
              >
                Skip
              </button>
              <button
                onClick={handleRemindLater}
                className="px-3 py-1.5 rounded-md border border-slate-700 bg-slate-800/50 text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600"
              >
                Remind me later
              </button>
              <button
                onClick={() => void handleUpdate()}
                className="px-3 py-1.5 rounded-md text-sm font-medium shadow-lg bg-blue-600 hover:bg-blue-500 text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              >
                Update Now
              </button>
            </>
          ) : (
            <button
              disabled
              className="px-3 py-1.5 rounded-md text-sm font-medium shadow-lg bg-blue-600/50 text-white/50 cursor-not-allowed"
            >
              Updating...
            </button>
          )}
        </div>
      </div>
    </div>
  );
};