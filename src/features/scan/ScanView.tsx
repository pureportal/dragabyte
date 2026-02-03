import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import type { CSSProperties, MouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DetailsModal } from "../../components/DetailsModal";
import { formatBytes } from "../../lib/utils";
import { useUIStore } from "../../store";
import {
  checkContextMenu,
  getStartupPath,
  startScan,
  toggleContextMenu,
} from "./api";
import ScanTree from "./ScanTree";
import Treemap from "./Treemap";
import type {
  FlatNode,
  ScanFile,
  ScanFilters,
  ScanNode,
  ScanOptions,
  ScanPriorityMode,
  ScanSummary,
  ScanThrottleLevel,
} from "./types";

const SIMPLE_FILTER_CATEGORIES = [
  {
    id: "images",
    label: "Images",
    extensions: [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "bmp",
      "tiff",
      "svg",
      "heic",
    ],
  },
  {
    id: "videos",
    label: "Videos",
    extensions: [
      "mp4",
      "mov",
      "mkv",
      "avi",
      "webm",
      "wmv",
      "flv",
      "mpeg",
      "mpg",
      "m4v",
    ],
  },
  {
    id: "audio",
    label: "Audio",
    extensions: ["mp3", "wav", "flac", "aac", "ogg", "m4a", "opus"],
  },
  {
    id: "documents",
    label: "Docs",
    extensions: [
      "pdf",
      "doc",
      "docx",
      "xls",
      "xlsx",
      "ppt",
      "pptx",
      "txt",
      "md",
      "rtf",
    ],
  },
  {
    id: "archives",
    label: "Archives",
    extensions: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"],
  },
] as const;

type SimpleFilterId = (typeof SIMPLE_FILTER_CATEGORIES)[number]["id"];

const parseListInput = (value: string): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();
  const parts = value.split(/[,\n]/);
  for (let i = 0; i < parts.length; i += 1) {
    const raw = parts[i];
    if (!raw) continue;
    const cleaned = raw.trim().replace(/^\./, "").toLowerCase();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
};

type ContextMenuState = {
  x: number;
  y: number;
  node: ScanNode;
};

const getUsageFillPercent = (size: number, maxSize: number): number => {
  if (maxSize <= 0) {
    return 0;
  }
  const ratio = size / maxSize;
  if (!Number.isFinite(ratio)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
};

const getUsageFillStyle = (percent: number): CSSProperties => {
  if (percent <= 0) {
    return { backgroundClip: "content-box" };
  }
  return {
    backgroundImage: `linear-gradient(90deg, rgba(59,130,246,0.18) ${percent}%, rgba(59,130,246,0) ${percent}%)`,
    backgroundClip: "content-box",
  };
};

const resolveFolderSelection = async (): Promise<string | null> => {
  const result = (await open({ directory: true, multiple: false })) as
    | string
    | string[]
    | null;
  if (typeof result === "string") {
    return result;
  }
  if (Array.isArray(result)) {
    return result[0] ?? null;
  }
  return null;
};

const findNodeByPath = (
  root: ScanNode,
  path: string | null,
): ScanNode | null => {
  if (!path) {
    return null;
  }
  const stack: ScanNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (current.path === path) {
      return current;
    }
    const children = current.children;
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (child) {
        stack.push(child);
      }
    }
  }
  return null;
};

const buildTreeItems = (root: ScanNode, expanded: Set<string>): FlatNode[] => {
  const result: FlatNode[] = [];
  const stack: FlatNode[] = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    result.push(current);
    if (!expanded.has(current.node.path)) {
      continue;
    }
    const children = current.node.children;
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (child) {
        stack.push({ node: child, depth: current.depth + 1 });
      }
    }
  }
  return result;
};

const buildInitialExpandedPaths = (root: ScanNode): Set<string> => {
  const next = new Set<string>();
  next.add(root.path);
  const children = root.children;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child) {
      next.add(child.path);
    }
  }
  return next;
};

const getParentPath = (path: string): string | null => {
  const trimmed = path.replace(/[\\/]+$/, "");
  const slashIndex = Math.max(
    trimmed.lastIndexOf("/"),
    trimmed.lastIndexOf("\\"),
  );
  if (slashIndex <= 0) {
    return null;
  }
  return trimmed.slice(0, slashIndex);
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
};

type ViewMode = "tree" | "treemap";
type FilterMode = "simple" | "advanced";

const ScanView = (): JSX.Element => {
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [detailsNode, setDetailsNode] = useState<ScanNode | null>(null);
  const [contextMenuEnabled, setContextMenuEnabled] = useState<boolean>(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [containerRef, setContainerRef] = useState<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [priorityMode, setPriorityMode] =
    useState<ScanPriorityMode>("balanced");
  const [throttleLevel, setThrottleLevel] = useState<ScanThrottleLevel>("off");
  const [filterMode, setFilterMode] = useState<FilterMode>("simple");
  const [simpleFilterIds, setSimpleFilterIds] = useState<Set<SimpleFilterId>>(
    () => new Set<SimpleFilterId>(),
  );
  const [includeExtensionsInput, setIncludeExtensionsInput] =
    useState<string>("");
  const [excludeExtensionsInput, setExcludeExtensionsInput] =
    useState<string>("");
  const [includePathsInput, setIncludePathsInput] = useState<string>("");
  const [excludePathsInput, setExcludePathsInput] = useState<string>("");
  const [includeRegexInput, setIncludeRegexInput] = useState<string>("");
  const [excludeRegexInput, setExcludeRegexInput] = useState<string>("");
  const {
    isNavigationBarVisible,
    toggleNavigationBar,
    scanHistory,
    addScanHistory,
  } = useUIStore();
  const unlistenRef = useRef<(() => void) | null>(null);
  const hasInitializedExpansionRef = useRef(false);
  const hasAutoScanRef = useRef(false);

  useEffect((): (() => void) | void => {
    if (!containerRef) return undefined;
    const observer = new ResizeObserver((entries) => {
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (!entry) continue;
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(containerRef);
    return (): void => observer.disconnect();
  }, [containerRef]);

  // When summary is cleared (new scan), reset the initialization flag
  useEffect(() => {
    if (!summary) {
      hasInitializedExpansionRef.current = false;
    }
  }, [summary]);

  const selectedNode = useMemo<ScanNode | null>(() => {
    return summary ? findNodeByPath(summary.root, selectedPath) : null;
  }, [summary, selectedPath]);

  const treeItems = useMemo<FlatNode[]>(() => {
    return summary ? buildTreeItems(summary.root, expandedPaths) : [];
  }, [expandedPaths, summary]);

  const simpleExtensions = useMemo<string[]>(() => {
    if (filterMode !== "simple") {
      return [];
    }
    const results: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < SIMPLE_FILTER_CATEGORIES.length; i += 1) {
      const category = SIMPLE_FILTER_CATEGORIES[i];
      if (!category || !simpleFilterIds.has(category.id)) continue;
      for (let j = 0; j < category.extensions.length; j += 1) {
        const ext = category.extensions[j];
        if (!ext || seen.has(ext)) continue;
        seen.add(ext);
        results.push(ext);
      }
    }
    return results;
  }, [filterMode, simpleFilterIds]);

  const scanFilters = useMemo<ScanFilters>(() => {
    if (filterMode === "simple") {
      return {
        includeExtensions: simpleExtensions,
        excludeExtensions: [],
        includeRegex: null,
        excludeRegex: null,
        includePaths: [],
        excludePaths: [],
      };
    }
    return {
      includeExtensions: parseListInput(includeExtensionsInput),
      excludeExtensions: parseListInput(excludeExtensionsInput),
      includeRegex: includeRegexInput.trim() || null,
      excludeRegex: excludeRegexInput.trim() || null,
      includePaths: parseListInput(includePathsInput),
      excludePaths: parseListInput(excludePathsInput),
    };
  }, [
    excludeExtensionsInput,
    excludePathsInput,
    excludeRegexInput,
    filterMode,
    includeExtensionsInput,
    includePathsInput,
    includeRegexInput,
    simpleExtensions,
  ]);

  const scanOptions = useMemo<ScanOptions>(() => {
    return {
      priorityMode,
      throttleLevel,
      filters: scanFilters,
    };
  }, [priorityMode, scanFilters, throttleLevel]);

  const statusLabel = isScanning ? "Scanning" : summary ? "Ready" : "Idle";
  const statusClasses = isScanning
    ? "border-blue-500/40 bg-blue-500/10 text-blue-200"
    : summary
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
      : "border-slate-700 bg-slate-900/70 text-slate-300";

  const activeNode = summary ? (selectedNode ?? summary.root) : null;
  const activeChildren = activeNode?.children ?? [];

  const largestFiles = useMemo<ScanFile[]>(() => {
    return summary?.largestFiles ?? [];
  }, [summary]);

  const largestFileMaxSize = useMemo<number>(() => {
    if (largestFiles.length === 0) {
      return 0;
    }
    return largestFiles[0]?.sizeBytes ?? 0;
  }, [largestFiles]);
  const maxChildSize = useMemo<number>(() => {
    let maxSize = 0;
    for (let i = 0; i < activeChildren.length; i += 1) {
      const child = activeChildren[i];
      const size = child?.sizeBytes ?? 0;
      if (size > maxSize) {
        maxSize = size;
      }
    }
    return maxSize;
  }, [activeChildren]);

  const searchResults = useMemo<ScanNode[] | null>(() => {
    if (!summary || !searchQuery.trim()) {
      return null;
    }
    const results: ScanNode[] = [];
    const query = searchQuery.toLowerCase();
    const stack: ScanNode[] = [summary.root];
    const limit = 1000;
    while (stack.length > 0 && results.length < limit) {
      const node = stack.pop();
      if (!node) continue;
      if (node.name.toLowerCase().includes(query)) {
        results.push(node);
      }
      const children = node.children;
      for (let i = 0; i < children.length; i += 1) {
        const child = children[i];
        if (child) {
          stack.push(child);
        }
      }
    }
    return results;
  }, [summary, searchQuery]);

  const clearListeners = (): void => {
    unlistenRef.current?.();
    unlistenRef.current = null;
  };

  const handleToggleExpand = useCallback(
    (path: string, currentlyExpanded: boolean) => {
      setExpandedPaths((previous) => {
        const next = new Set(previous);
        if (!currentlyExpanded) {
          next.add(path);
        } else {
          next.delete(path);
        }
        return next;
      });
    },
    [],
  );

  const setExpandedToDepth = useCallback(
    (root: ScanNode, depth: number): void => {
      setExpandedPaths((previous) => {
        const next = new Set(previous);
        const stack: { node: ScanNode; d: number }[] = [{ node: root, d: 0 }];
        while (stack.length > 0) {
          const item = stack.pop();
          if (!item) continue;
          if (item.d < depth) {
            next.add(item.node.path);
          } else {
            next.delete(item.node.path);
          }
          const children = item.node.children;
          for (let i = 0; i < children.length; i += 1) {
            const child = children[i];
            if (!child) continue;
            stack.push({ node: child, d: item.d + 1 });
          }
        }
        return next;
      });
    },
    [],
  );

  const applySummary = (payload: ScanSummary): void => {
    setSummary(payload);
    setSelectedPath((previous): string | null => previous ?? payload.root.path);

    // Only set initial expanded paths once per scan to avoid overwriting user interactions
    if (!hasInitializedExpansionRef.current) {
      setExpandedPaths(buildInitialExpandedPaths(payload.root));
      hasInitializedExpansionRef.current = true;
    }
  };

  const finishScan = (payload: ScanSummary): void => {
    applySummary(payload); // Ensure final state is applied
    addScanHistory(payload.root.path);
    setIsScanning(false);
    clearListeners();
  };

  const failScan = (message: string): void => {
    setError(message);
    setIsScanning(false);
    clearListeners();
  };

  const startScanWithFolder = async (folder: string): Promise<void> => {
    clearListeners();
    setSummary(null);
    setSelectedPath(null);
    setIsScanning(true);
    hasInitializedExpansionRef.current = false; // Reset for new scan
    try {
      unlistenRef.current = await startScan(folder, scanOptions, {
        onProgress: applySummary,
        onComplete: finishScan,
        onError: failScan,
      });
    } catch (err) {
      failScan(toErrorMessage(err));
    }
  };

  const handleScan = async (): Promise<void> => {
    setError(null);
    const folder = await resolveFolderSelection();
    if (!folder) {
      return;
    }
    await startScanWithFolder(folder);
  };

  const openScanWindow = useCallback((path: string): void => {
    try {
      const label = `scan-${Date.now()}`;
      const url = `/?scanPath=${encodeURIComponent(path)}`;
      const title = `Voxara • ${path.split(/[/\\]/).pop() ?? "Scan"}`;
      new WebviewWindow(label, {
        url,
        title,
        width: 1200,
        height: 800,
        decorations: false,
        resizable: true,
        focus: true,
      });
    } catch (error) {
      console.error("Failed to open scan window", error);
    }
  }, []);

  const openContextMenu = useCallback(
    (event: MouseEvent, node: ScanNode): void => {
      event.preventDefault();
      event.stopPropagation();
      const menuWidth = 220;
      const menuHeight = 96;
      const maxX = window.innerWidth - menuWidth - 8;
      const maxY = window.innerHeight - menuHeight - 8;
      const x = Math.max(8, Math.min(event.clientX, maxX));
      const y = Math.max(8, Math.min(event.clientY, maxY));
      setContextMenu({ x, y, node });
    },
    [],
  );

  const closeContextMenu = useCallback((): void => {
    setContextMenu(null);
  }, []);

  const renderChildRow = (child: ScanNode): JSX.Element => {
    const isSelected = selectedPath === child.path;
    const sizeValue = child.sizeBytes ?? 0;
    const fillPercent = getUsageFillPercent(sizeValue, maxChildSize);
    const rowStyle = getUsageFillStyle(fillPercent);
    return (
      <tr
        key={child.path}
        onClick={(): void => setSelectedPath(child.path)}
        onContextMenu={(event): void => openContextMenu(event, child)}
        style={rowStyle}
        className={`cursor-pointer border-t border-slate-800 text-slate-200 transition hover:bg-slate-800/60 ${isSelected ? "bg-blue-500/10" : ""}`}
      >
        <td className="px-4 py-2">{child.name}</td>
        <td className="px-4 py-2">{formatBytes(sizeValue)}</td>
        <td className="px-4 py-2">{child.fileCount}</td>
        <td className="px-4 py-2">{child.dirCount}</td>
      </tr>
    );
  };

  useEffect((): (() => void) => {
    return (): void => {
      clearListeners();
    };
  }, []);
  useEffect(() => {
    checkContextMenu().then(setContextMenuEnabled).catch(console.error);
    const params = new URLSearchParams(window.location.search);
    const queryPath = params.get("scanPath");
    if (queryPath && !hasAutoScanRef.current) {
      hasAutoScanRef.current = true;
      startScanWithFolder(queryPath).catch(console.error);
      return;
    }
    getStartupPath()
      .then((path) => {
        if (path && !hasAutoScanRef.current) {
          hasAutoScanRef.current = true;
          startScanWithFolder(path).catch(console.error);
        }
      })
      .catch(console.error);
  }, []);

  useEffect((): (() => void) | void => {
    if (!contextMenu) {
      return undefined;
    }
    const handleDismiss = (): void => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    window.addEventListener("resize", handleDismiss);
    window.addEventListener("blur", handleDismiss);
    window.addEventListener("scroll", handleDismiss, true);
    document.addEventListener("click", handleDismiss);
    document.addEventListener("keydown", handleKeyDown);
    return (): void => {
      window.removeEventListener("resize", handleDismiss);
      window.removeEventListener("blur", handleDismiss);
      window.removeEventListener("scroll", handleDismiss, true);
      document.removeEventListener("click", handleDismiss);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const handleToggleContextMenu = async (): Promise<void> => {
    try {
      const newState = !contextMenuEnabled;
      await toggleContextMenu(newState);
      setContextMenuEnabled(newState);
    } catch (err) {
      console.error("Failed to toggle context menu", err);
    }
  };

  return (
    <div className="flex flex-col h-full gap-4">
      <DetailsModal
        node={detailsNode}
        isOpen={!!detailsNode}
        onClose={() => setDetailsNode(null)}
      />
      {contextMenu ? (
        <div
          className="fixed z-50 min-w-[220px] rounded-lg border border-slate-800/80 bg-slate-950/95 shadow-xl shadow-black/40 backdrop-blur ring-1 ring-slate-800/60"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          role="menu"
        >
          <div className="px-3 py-2 text-[11px] font-semibold text-slate-400 border-b border-slate-800/70">
            {contextMenu.node.name || contextMenu.node.path}
          </div>
          <button
            type="button"
            onClick={(): void => {
              openScanWindow(contextMenu.node.path);
              closeContextMenu();
            }}
            className="flex w-full items-center justify-between px-3 py-2 text-xs text-slate-200 hover:bg-slate-800/70"
            role="menuitem"
          >
            <span>Open in New Window</span>
            <span className="text-[10px] text-slate-500">Scan</span>
          </button>
        </div>
      ) : null}

      {/* Top Header Bar */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800/80 bg-slate-900/50 px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex flex-1 items-center gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold">Storage Scan</h2>
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${statusClasses}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                {statusLabel}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Select a folder to analyze.
            </p>
          </div>
          <div className="h-8 w-px bg-slate-800/50" />
          <div className="flex items-center gap-2">
            <button
              onClick={toggleNavigationBar}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                isNavigationBarVisible
                  ? "bg-slate-700 text-slate-200"
                  : "bg-slate-800/50 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              }`}
            >
              {isNavigationBarVisible ? "Hide History" : "Show History"}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative hidden lg:block">
            <input
              type="text"
              value={searchQuery}
              onChange={(event): void => setSearchQuery(event.target.value)}
              placeholder="Search..."
              className="h-8 w-40 lg:w-48 rounded-md border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/50 transition-all focus:w-64 shadow-inner"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={(): void => setSearchQuery("")}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5 rounded hover:bg-slate-800"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-3.5 h-3.5"
                >
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleToggleContextMenu}
            className={`mr-2 rounded-md border text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 px-3 py-2
                ${
                  contextMenuEnabled
                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                    : "border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-800 hover:text-slate-200"
                }`}
          >
            {contextMenuEnabled ? "Integration Active" : "Add to Explorer"}
          </button>
          <button
            type="button"
            onClick={handleScan}
            disabled={isScanning}
            className="rounded-md bg-gradient-to-r from-blue-500 to-blue-400 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:from-blue-400 hover:to-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 disabled:cursor-not-allowed disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-300"
          >
            {isScanning ? "Scanning..." : "Scan Folder"}
          </button>
        </div>
      </div>

      <div className="shrink-0 rounded-xl border border-slate-800/70 bg-slate-900/50 px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500">
              Scan Controls
            </p>
            <p className="text-xs text-slate-400">
              Adjust priority, throttling, and filters before scanning.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(): void => setFilterMode("simple")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition border ${
                filterMode === "simple"
                  ? "border-blue-500/60 bg-blue-500/15 text-blue-200"
                  : "border-slate-700 bg-slate-900/40 text-slate-400 hover:text-slate-200"
              }`}
            >
              Simple Filters
            </button>
            <button
              type="button"
              onClick={(): void => setFilterMode("advanced")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition border ${
                filterMode === "advanced"
                  ? "border-blue-500/60 bg-blue-500/15 text-blue-200"
                  : "border-slate-700 bg-slate-900/40 text-slate-400 hover:text-slate-200"
              }`}
            >
              Advanced Filters
            </button>
          </div>
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(260px,_1fr)_minmax(320px,_1.3fr)]">
          <div className="rounded-lg border border-slate-800/60 bg-slate-950/50 p-3">
            <p className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">
              Performance
            </p>
            <div className="grid gap-3">
              <label className="text-xs text-slate-400">
                Priority Mode
                <select
                  value={priorityMode}
                  onChange={(event): void =>
                    setPriorityMode(event.target.value as ScanPriorityMode)
                  }
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                >
                  <option value="performance">Performance</option>
                  <option value="balanced">Balanced</option>
                  <option value="low">Low Impact</option>
                </select>
              </label>
              <label className="text-xs text-slate-400">
                Scan Throttling
                <select
                  value={throttleLevel}
                  onChange={(event): void =>
                    setThrottleLevel(event.target.value as ScanThrottleLevel)
                  }
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                >
                  <option value="off">Off</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-slate-800/60 bg-slate-950/50 p-3">
            <p className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">
              Filters
            </p>
            {filterMode === "simple" ? (
              <div className="flex flex-wrap gap-2">
                {SIMPLE_FILTER_CATEGORIES.map((category) => {
                  const active = simpleFilterIds.has(category.id);
                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={(): void => {
                        setSimpleFilterIds((previous) => {
                          const next = new Set(previous);
                          if (active) {
                            next.delete(category.id);
                          } else {
                            next.add(category.id);
                          }
                          return next;
                        });
                      }}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                        active
                          ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-200"
                          : "border-slate-700 bg-slate-900/40 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {category.label}
                    </button>
                  );
                })}
                {simpleFilterIds.size === 0 ? (
                  <span className="text-xs text-slate-500">
                    No filters selected. All file types will be scanned.
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                <label className="text-xs text-slate-400">
                  Include extensions
                  <input
                    type="text"
                    value={includeExtensionsInput}
                    onChange={(event): void =>
                      setIncludeExtensionsInput(event.target.value)
                    }
                    placeholder="png, jpg, pdf"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Exclude extensions
                  <input
                    type="text"
                    value={excludeExtensionsInput}
                    onChange={(event): void =>
                      setExcludeExtensionsInput(event.target.value)
                    }
                    placeholder="tmp, cache"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Include paths (contains)
                  <input
                    type="text"
                    value={includePathsInput}
                    onChange={(event): void =>
                      setIncludePathsInput(event.target.value)
                    }
                    placeholder="/projects, /media"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Exclude paths (contains)
                  <input
                    type="text"
                    value={excludePathsInput}
                    onChange={(event): void =>
                      setExcludePathsInput(event.target.value)
                    }
                    placeholder="/node_modules, /target"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Include regex
                  <input
                    type="text"
                    value={includeRegexInput}
                    onChange={(event): void =>
                      setIncludeRegexInput(event.target.value)
                    }
                    placeholder="\\.(png|jpg)$"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Exclude regex
                  <input
                    type="text"
                    value={excludeRegexInput}
                    onChange={(event): void =>
                      setExcludeRegexInput(event.target.value)
                    }
                    placeholder="/\\.git/"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* History Bar */}
      {isNavigationBarVisible && scanHistory.length > 0 ? (
        <div className="shrink-0 rounded-xl border border-slate-800/70 bg-slate-900/50 px-3 py-2 shadow-sm">
          <div className="flex items-center justify-between pb-2">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">
              History
            </span>
            <span className="text-[10px] text-slate-600">
              {scanHistory.length} items
            </span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {scanHistory.map((path) => (
              <button
                key={path}
                onClick={() => startScanWithFolder(path)}
                className="flex-shrink-0 max-w-[220px] truncate px-3 py-1.5 text-xs bg-slate-950/70 border border-slate-800 rounded-md hover:bg-slate-800/80 text-slate-400 hover:text-slate-200 transition"
                title={path}
              >
                {path}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="shrink-0 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {/* Main Content Area */}
      {summary ? (
        <div className="flex-1 min-h-0 grid gap-5 lg:grid-cols-[minmax(400px,_40%)_1fr]">
          {/* Left Panel: Tree */}
          <div className="flex flex-col rounded-xl border border-slate-800/80 bg-slate-900/55 overflow-hidden h-full shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-2 text-sm font-semibold shrink-0 bg-slate-900/80 backdrop-blur">
              <div className="flex items-center gap-2">
                <span className="mr-2 text-slate-100">Explorer</span>
                <div className="flex items-center rounded-lg border border-slate-800/50 bg-slate-950/50 p-0.5">
                  <button
                    type="button"
                    onClick={(): void => setViewMode("tree")}
                    className={`px-2.5 py-0.5 text-[10px] font-medium rounded transition ${
                      viewMode === "tree"
                        ? "bg-slate-800 text-slate-100"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Tree
                  </button>
                  <button
                    type="button"
                    onClick={(): void => setViewMode("treemap")}
                    className={`px-2.5 py-0.5 text-[10px] font-medium rounded transition ${
                      viewMode === "treemap"
                        ? "bg-slate-800 text-slate-100"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Treemap
                  </button>
                </div>
              </div>
              {viewMode === "tree" ? (
                <div className="flex items-center gap-1 bg-slate-950/50 rounded-lg p-0.5 border border-slate-800/50">
                  {[1, 2, 3].map((depth) => (
                    <button
                      key={depth}
                      onClick={() => setExpandedToDepth(summary.root, depth)}
                      className="px-2.5 py-0.5 text-[10px] font-medium hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition"
                      title={`Expand to level ${depth}`}
                    >
                      {depth}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-[10px] text-slate-500">
                  Click blocks to select
                </span>
              )}
              <span className="ml-auto text-xs text-slate-500 pl-2 tabular-nums">
                {formatBytes(summary.totalBytes)}
              </span>
            </div>

            <div
              ref={setContainerRef}
              className="flex-1 overflow-auto px-2 py-2 min-h-0"
            >
              {searchQuery && searchResults ? (
                <div className="flex flex-col">
                  <div className="sticky top-0 z-10 bg-slate-950/90 backdrop-blur border-b border-slate-800 px-3 py-2 text-xs font-semibold text-slate-400">
                    Found {searchResults.length} results
                    {searchResults.length >= 1000 ? " (Limited to 1000)" : ""}
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {searchResults.map((node) => (
                        <tr
                          key={node.path}
                          onClick={(): void => setSelectedPath(node.path)}
                          onDoubleClick={(): void => setDetailsNode(node)}
                          onContextMenu={(event): void =>
                            openContextMenu(event, node)
                          }
                          className={`cursor-pointer border-b border-slate-800/50 hover:bg-slate-800/50 ${
                            selectedPath === node.path ? "bg-blue-500/10" : ""
                          }`}
                        >
                          <td className="px-3 py-2 align-middle">
                            <div
                              className={`font-medium ${
                                selectedPath === node.path
                                  ? "text-blue-300"
                                  : "text-slate-300"
                              }`}
                            >
                              {node.name}
                            </div>
                            <div
                              className="text-[10px] text-slate-500 truncate max-w-[280px]"
                              title={node.path}
                            >
                              {node.path}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap text-xs text-slate-400 align-middle">
                            {formatBytes(node.sizeBytes)}
                          </td>
                        </tr>
                      ))}
                      {searchResults.length === 0 ? (
                        <tr>
                          <td
                            className="px-4 py-8 text-center text-slate-500 text-sm"
                            colSpan={2}
                          >
                            No items found for "{searchQuery}"
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              ) : viewMode === "tree" ? (
                <ScanTree
                  treeItems={treeItems}
                  expandedPaths={expandedPaths}
                  selectedPath={selectedPath}
                  onToggleExpand={handleToggleExpand}
                  onSelect={setSelectedPath}
                  onDouble={setDetailsNode}
                  onContextMenu={openContextMenu}
                />
              ) : (
                <Treemap
                  rootNode={selectedNode ?? summary.root}
                  width={containerSize.width}
                  height={containerSize.height}
                  onSelect={(node): void => setSelectedPath(node.path)}
                  selectedPath={selectedPath}
                />
              )}
            </div>
          </div>

          {/* Right Panel: Details & Subfolders */}
          <div className="flex flex-col gap-4 overflow-auto h-full pr-1">
            {/* Info Cards Row */}
            <div className="shrink-0 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-blue-400/80 mb-1">
                      Selected
                    </p>
                    <h3 className="text-lg font-bold text-slate-100 truncate">
                      {activeNode?.name || "Root"}
                    </h3>
                    <p
                      className="text-xs text-slate-500 font-mono truncate max-w-full"
                      title={activeNode?.path}
                    >
                      {activeNode?.path ?? ""}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 text-xs text-slate-300 items-end shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Size</span>
                      <span className="font-mono text-slate-200">
                        {formatBytes(activeNode?.sizeBytes ?? 0)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Files</span>
                      <span className="font-mono text-slate-200">
                        {activeNode?.fileCount ?? 0}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Folders</span>
                      <span className="font-mono text-slate-200">
                        {activeNode?.dirCount ?? 0}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] uppercase font-bold tracking-wider text-emerald-400/80 mb-1">
                      Total Summary
                    </p>
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-slate-200">
                        Size:{" "}
                        <span className="text-slate-100">
                          {formatBytes(summary.totalBytes)}
                        </span>
                      </p>
                      <p className="text-xs text-slate-400">
                        {summary.fileCount.toLocaleString()} files
                      </p>
                      <p className="text-xs text-slate-400">
                        {summary.dirCount.toLocaleString()} folders
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-slate-600 mb-1">
                      Duration
                    </p>
                    <p className="text-2xl font-light text-slate-200 tabular-nums">
                      {(summary.durationMs / 1000).toFixed(2)}s
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="shrink-0 rounded-xl border border-slate-800/80 bg-slate-900/55 shadow-sm overflow-hidden flex flex-col max-h-[260px]">
              <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-3 text-xs font-bold uppercase tracking-wide bg-slate-900/40">
                <span className="text-slate-400">Largest files</span>
                <span className="text-[10px] text-slate-500">Top 10</span>
              </div>
              <div className="flex-1 overflow-auto divide-y divide-slate-800/50">
                {largestFiles.map((file) => {
                  const fill = getUsageFillPercent(
                    file.sizeBytes,
                    largestFileMaxSize,
                  );
                  const rowStyle = getUsageFillStyle(fill);
                  const parentPath = getParentPath(file.path);
                  const isSelected = parentPath
                    ? parentPath === selectedPath
                    : false;
                  return (
                    <button
                      type="button"
                      key={file.path}
                      onClick={(): void =>
                        setSelectedPath(parentPath ?? summary.root.path)
                      }
                      className={`w-full text-left px-4 py-3 text-[13px] leading-5 transition ${
                        isSelected
                          ? "bg-blue-500/15 text-blue-100"
                          : "text-slate-200 hover:bg-slate-800/60"
                      }`}
                      style={rowStyle}
                      title={file.path}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-slate-100">
                            {file.name}
                          </div>
                          <div className="text-xs text-slate-400 truncate">
                            {file.path}
                          </div>
                        </div>
                        <div className="text-sm font-semibold text-slate-100 tabular-nums shrink-0">
                          {formatBytes(file.sizeBytes)}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {largestFiles.length === 0 ? (
                  <div className="px-4 py-6 text-xs text-slate-500">
                    Run a scan to see largest files.
                  </div>
                ) : null}
              </div>
            </div>

            {/* Subfolders Table - Fills remaining vertical space */}
            <div className="flex-1 min-h-[220px] flex flex-col rounded-xl border border-slate-800/80 bg-slate-900/55 overflow-hidden shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-3 text-xs font-bold uppercase tracking-wide bg-slate-900/40">
                <span className="text-slate-400">Subfolders</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700/50">
                  {activeChildren.length} items
                </span>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-950/90 backdrop-blur text-left text-[10px] font-bold uppercase text-slate-500 tracking-wider shadow-sm z-10">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Name</th>
                      <th className="px-4 py-3 font-semibold">Size</th>
                      <th className="px-4 py-3 font-semibold">Files</th>
                      <th className="px-4 py-3 font-semibold">Folders</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {activeChildren.map(renderChildRow)}
                    {activeChildren.length === 0 ? (
                      <tr className="text-slate-500">
                        <td className="px-4 py-8 text-center" colSpan={4}>
                          No subfolders found in this directory.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800/60 bg-slate-900/25 p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center mb-4">
            <svg
              viewBox="0 0 24 24"
              className="w-8 h-8 text-slate-600"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-slate-200 mb-2">
            Ready to Scan
          </h3>
          <p className="text-slate-400 max-w-sm mx-auto mb-6">
            Connect to your local storage and visualize space usage with
            high-performance tree scanning.
          </p>
          <button
            onClick={handleScan}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition shadow-lg shadow-blue-500/20"
          >
            Start Scanning
          </button>
        </div>
      )}
    </div>
  );
};

export default ScanView;
