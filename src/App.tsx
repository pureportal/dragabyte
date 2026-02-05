import { Outlet } from "@tanstack/react-router";
import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { useUIStore } from "./store";

const hasMultipleWindows = async (): Promise<boolean> => {
  const windows = await getAllWindows();
  return windows.length > 1;
};

const getIndicatorWrapperClasses = (
  status: "idle" | "scanning" | "complete",
): string => {
  if (status === "complete") {
    return "bg-emerald-400/90 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.6)]";
  }
  if (status === "scanning") {
    return "bg-slate-950/70 shadow-[0_0_10px_rgba(59,130,246,0.45)]";
  }
  return "bg-slate-500/70 shadow-[0_0_8px_rgba(148,163,184,0.35)]";
};

const getIndicatorScanClasses = (): string => {
  return "absolute inset-y-0 left-[-100%] w-[300%] bg-[linear-gradient(90deg,#22d3ee,#a855f7,#34d399,#22d3ee)] animate-[indicator-scan_2.2s_linear_infinite] will-change-transform";
};

const App = (): JSX.Element => {
  const [isMaximized, setIsMaximized] = useState(false);
  const scanStatus = useUIStore((state) => state.scanStatus);

  useEffect((): (() => void) => {
    const handleContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
    };
    window.addEventListener("contextmenu", handleContextMenu, true);
    return (): void => {
      window.removeEventListener("contextmenu", handleContextMenu, true);
    };
  }, []);

  useEffect((): (() => void) => {
    const currentWindow = getCurrentWindow();
    const unlistenPromise = currentWindow.onCloseRequested(async (event) => {
      try {
        if (await hasMultipleWindows()) {
          event.preventDefault();
          await currentWindow.hide();
        }
      } catch (error) {
        console.error("Failed to handle close request", error);
      }
    });
    return (): void => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const minimize = (): void => {
    void getCurrentWindow().minimize();
  };

  const toggleMaximize = async (): Promise<void> => {
    const win = getCurrentWindow();
    const max = await win.isMaximized();
    if (max) {
      await win.unmaximize();
      setIsMaximized(false);
    } else {
      await win.maximize();
      setIsMaximized(true);
    }
  };

  const close = (): void => {
    const currentWindow = getCurrentWindow();
    void (async (): Promise<void> => {
      try {
        if (await hasMultipleWindows()) {
          await currentWindow.hide();
          return;
        }
      } catch (error) {
        console.error("Failed to check windows before closing", error);
      }
      await currentWindow.destroy();
    })();
  };

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100 border border-slate-800/50 rounded-lg">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.12),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(to_right,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:64px_64px]" />

      <div
        className={`relative h-1 w-full shrink-0 overflow-hidden ${getIndicatorWrapperClasses(
          scanStatus,
        )}`}
        data-tauri-drag-region
        aria-hidden="true"
      >
        {scanStatus === "scanning" ? (
          <span className={getIndicatorScanClasses()} />
        ) : null}
      </div>

      {/* Title Bar */}
      <div
        className="relative flex h-10 w-full shrink-0 items-center justify-between border-b border-slate-800/80 bg-slate-950/80 px-4 backdrop-blur select-none z-50"
        data-tauri-drag-region
      >
        <div
          className="relative flex items-center gap-2"
          data-tauri-drag-region
        >
          <span className="text-xs font-semibold tracking-wide text-slate-300">
            VOXARA
          </span>
          <span className="rounded border border-amber-400/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300/90">
            Alpha
          </span>
        </div>
        <div className="flex-1" data-tauri-drag-region />
        <div className="relative flex items-center gap-2">
          <button
            onClick={minimize}
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            data-tauri-no-drag
          >
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-current">
              <path d="M0 5h10v1H0z" />
            </svg>
          </button>
          <button
            onClick={toggleMaximize}
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            data-tauri-no-drag
          >
            <svg
              viewBox="0 0 10 10"
              className="h-2.5 w-2.5 stroke-current"
              fill="none"
            >
              <path
                d="M1.5 1.5h7v7h-7z"
                style={{ vectorEffect: "non-scaling-stroke" }}
              />
            </svg>
          </button>
          <button
            onClick={close}
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-red-500/10 hover:text-red-400"
            data-tauri-no-drag
          >
            <svg viewBox="0 0 10 10" className="h-3 w-3 fill-current">
              <path
                d="M1 1l8 8m0-8L1 9"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          </button>
        </div>
      </div>

      <main className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
        <Outlet />
      </main>
    </div>
  );
};

export default App;
