import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import type { CSSProperties, MouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DetailsModal } from "../../components/DetailsModal";
import { formatBytes, formatDuration, truncateMiddle } from "../../lib/utils";
import { useUIStore } from "../../store";
import {
  cancelScan,
  checkContextMenu,
  getStartupPath,
  openPath,
  showInExplorer,
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
import UsageCharts from "./UsageCharts";

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

const SIZE_UNITS = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
} satisfies Record<string, number>;
const SIMPLE_FILTER_ID_SET = new Set<SimpleFilterId>(
  SIMPLE_FILTER_CATEGORIES.map((category) => category.id),
);

const parseSizeValue = (raw: string): number | null => {
  const match = raw
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb|tb)?$/);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = (match[2] ?? "b") as keyof typeof SIZE_UNITS;
  const multiplier = SIZE_UNITS[unit];
  if (!Number.isFinite(value) || !multiplier) return null;
  return Math.round(value * multiplier);
};

const parseRegexToken = (value: string): RegExp | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/") && trimmed.lastIndexOf("/") > 0) {
    const lastSlash = trimmed.lastIndexOf("/");
    const pattern = trimmed.slice(1, lastSlash);
    const flags = trimmed.slice(lastSlash + 1) || "i";
    try {
      return new RegExp(pattern, flags);
    } catch {
      return null;
    }
  }
  try {
    return new RegExp(trimmed, "i");
  } catch {
    return null;
  }
};

const getPathExtension = (path: string): string | null => {
  const lastDot = path.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === path.length - 1) return null;
  return path.slice(lastDot + 1).toLowerCase();
};

type SearchParams = {
  terms: string[];
  nameTerms: string[];
  pathTerms: string[];
  exts: Set<string>;
  regex: RegExp | null;
  minSize: number | null;
  maxSize: number | null;
};

type SearchEntry = {
  name: string;
  path: string;
  sizeBytes: number;
};

type SelectionEntry = {
  kind: "folder" | "file";
  path: string;
  parentPath?: string | null;
};

type FilterMatchers = {
  includeExts: Set<string>;
  excludeExts: Set<string>;
  includeRegex: RegExp | null;
  excludeRegex: RegExp | null;
  includePaths: string[];
  excludePaths: string[];
};

const applySizeToken = (params: SearchParams, token: string): boolean => {
  const match = token.match(/^size(<=|>=|=|<|>)(.+)$/);
  if (!match) return false;
  const sizeToken = match[2];
  if (!sizeToken) return true;
  const sizeValue = parseSizeValue(sizeToken);
  if (sizeValue === null) return true;
  const operator = match[1];
  if (operator === ">" || operator === ">=") params.minSize = sizeValue;
  if (operator === "<" || operator === "<=") params.maxSize = sizeValue;
  if (operator === "=") {
    params.minSize = sizeValue;
    params.maxSize = sizeValue;
  }
  return true;
};

const applyKeyToken = (params: SearchParams, token: string): boolean => {
  const colonIndex = token.indexOf(":");
  if (colonIndex <= 0) return false;
  const key = token.slice(0, colonIndex);
  const value = token.slice(colonIndex + 1);
  if (key === "name") params.nameTerms.push(value);
  else if (key === "path") params.pathTerms.push(value);
  else if (key === "ext") {
    const extensions = parseListInput(value);
    for (let i = 0; i < extensions.length; i += 1) {
      const ext = extensions[i];
      if (ext) params.exts.add(ext);
    }
  } else if (key === "regex") {
    const regex = parseRegexToken(value);
    if (regex) params.regex = regex;
  } else {
    params.terms.push(token);
  }
  return true;
};

const parseSearchQuery = (query: string): SearchParams => {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const params: SearchParams = {
    terms: [],
    nameTerms: [],
    pathTerms: [],
    exts: new Set<string>(),
    regex: null,
    minSize: null,
    maxSize: null,
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const rawToken = tokens[i];
    if (!rawToken) continue;
    const token = rawToken.toLowerCase();
    if (applySizeToken(params, token)) continue;
    if (applyKeyToken(params, token)) continue;
    params.terms.push(token);
  }
  return params;
};

const matchesAllTokens = (value: string, tokens: string[]): boolean => {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    if (!value.includes(token)) return false;
  }
  return true;
};

const matchesSearchTerms = (
  name: string,
  path: string,
  terms: string[],
): boolean => {
  for (let i = 0; i < terms.length; i += 1) {
    const term = terms[i];
    if (!term) continue;
    if (!name.includes(term) && !path.includes(term)) return false;
  }
  return true;
};

const matchesSizeConstraints = (
  sizeBytes: number,
  minSize: number | null,
  maxSize: number | null,
): boolean => {
  if (minSize !== null && sizeBytes < minSize) return false;
  if (maxSize !== null && sizeBytes > maxSize) return false;
  return true;
};

const matchesRegexConstraint = (
  name: string,
  path: string,
  regex: RegExp | null,
): boolean => {
  if (regex && !regex.test(path) && !regex.test(name)) return false;
  return true;
};

const matchesSearchEntry = (
  entry: SearchEntry,
  params: SearchParams,
): boolean => {
  const name = entry.name.toLowerCase();
  const path = entry.path.toLowerCase();
  if (!matchesAllTokens(name, params.nameTerms)) return false;
  if (!matchesAllTokens(path, params.pathTerms)) return false;
  if (!matchesSearchTerms(name, path, params.terms)) return false;
  if (params.exts.size > 0) {
    const ext = getPathExtension(path);
    if (!ext || !params.exts.has(ext)) return false;
  }
  if (
    !matchesSizeConstraints(entry.sizeBytes, params.minSize, params.maxSize)
  ) {
    return false;
  }
  return matchesRegexConstraint(name, path, params.regex);
};

const buildFilterMatchers = (filters: ScanFilters): FilterMatchers => {
  return {
    includeExts: new Set(filters.includeExtensions),
    excludeExts: new Set(filters.excludeExtensions),
    includeRegex: parseRegexToken(filters.includeRegex ?? ""),
    excludeRegex: parseRegexToken(filters.excludeRegex ?? ""),
    includePaths: filters.includePaths,
    excludePaths: filters.excludePaths,
  };
};

const pathContainsAny = (path: string, values: string[]): boolean => {
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value && path.includes(value)) return true;
  }
  return false;
};

const matchesPathFilters = (
  path: string,
  includePaths: string[],
  excludePaths: string[],
): boolean => {
  const normalized = path.toLowerCase();
  if (includePaths.length > 0 && !pathContainsAny(normalized, includePaths)) {
    return false;
  }
  if (excludePaths.length > 0 && pathContainsAny(normalized, excludePaths)) {
    return false;
  }
  return true;
};

const matchesExtensionFilters = (
  path: string,
  includeExts: Set<string>,
  excludeExts: Set<string>,
): boolean => {
  const ext = getPathExtension(path);
  if (includeExts.size > 0 && (!ext || !includeExts.has(ext))) return false;
  if (excludeExts.size > 0 && ext && excludeExts.has(ext)) return false;
  return true;
};

const matchesRegexFilters = (
  path: string,
  name: string,
  includeRegex: RegExp | null,
  excludeRegex: RegExp | null,
): boolean => {
  if (includeRegex && !includeRegex.test(path) && !includeRegex.test(name)) {
    return false;
  }
  if (excludeRegex && (excludeRegex.test(path) || excludeRegex.test(name))) {
    return false;
  }
  return true;
};

const matchesFilterFile = (
  file: ScanFile,
  matchers: FilterMatchers,
): boolean => {
  const path = file.path.toLowerCase();
  const name = file.name.toLowerCase();
  if (
    !matchesExtensionFilters(path, matchers.includeExts, matchers.excludeExts)
  ) {
    return false;
  }
  if (!matchesPathFilters(path, matchers.includePaths, matchers.excludePaths)) {
    return false;
  }
  if (
    !matchesRegexFilters(
      path,
      name,
      matchers.includeRegex,
      matchers.excludeRegex,
    )
  ) {
    return false;
  }
  return true;
};

type ContextMenuState = {
  x: number;
  y: number;
  kind: "folder" | "file";
  node?: ScanNode;
  file?: ScanFile;
};

type MenuPosition = {
  x: number;
  y: number;
};

const MENU_WIDTH = 220;
const MENU_HEIGHT = 152;

const getMenuPosition = (
  event: MouseEvent,
  menuWidth: number,
  menuHeight: number,
): MenuPosition => {
  const maxX = window.innerWidth - menuWidth - 8;
  const maxY = window.innerHeight - menuHeight - 8;
  return {
    x: Math.max(8, Math.min(event.clientX, maxX)),
    y: Math.max(8, Math.min(event.clientY, maxY)),
  };
};

const getMenuTitle = (menu: ContextMenuState): string => {
  if (menu.kind === "file") {
    return menu.file?.name ?? menu.file?.path ?? "File";
  }
  return menu.node?.name ?? menu.node?.path ?? "Folder";
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

const buildNodeMap = (root: ScanNode): Map<string, ScanNode> => {
  const map = new Map<string, ScanNode>();
  const stack: ScanNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    map.set(current.path, current);
    const children = current.children;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child) stack.push(child);
    }
  }
  return map;
};

const isEmptyFolder = (node: ScanNode): boolean => {
  return node.children.length === 0 && node.files.length === 0;
};

const sortFilesBySize = (files: ScanFile[]): ScanFile[] => {
  const sorted = [...files];
  sorted.sort((a, b) => b.sizeBytes - a.sizeBytes);
  return sorted;
};

const updateLargestFiles = (
  largest: ScanFile[],
  file: ScanFile,
  limit: number,
): void => {
  if (file.sizeBytes <= 0) return;
  if (largest.length < limit) {
    largest.push(file);
    largest.sort((a, b) => b.sizeBytes - a.sizeBytes);
    return;
  }
  const smallest = largest[largest.length - 1]?.sizeBytes ?? 0;
  if (file.sizeBytes <= smallest) return;
  largest.push(file);
  largest.sort((a, b) => b.sizeBytes - a.sizeBytes);
  largest.length = limit;
};

const getLargestFilesForNode = (
  node: ScanNode,
  limit: number,
  shouldInclude?: (file: ScanFile) => boolean,
): ScanFile[] => {
  const largest: ScanFile[] = [];
  const stack: ScanNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (let i = 0; i < current.files.length; i += 1) {
      const file = current.files[i];
      if (!file || (shouldInclude && !shouldInclude(file))) continue;
      updateLargestFiles(largest, file, limit);
    }
    for (let i = 0; i < current.children.length; i += 1) {
      const child = current.children[i];
      if (child) stack.push(child);
    }
  }
  return largest;
};

const buildTreeItems = (
  root: ScanNode,
  expanded: Set<string>,
  showFiles: boolean,
  hideEmptyFolders: boolean,
): FlatNode[] => {
  const result: FlatNode[] = [];
  const stack: { node: ScanNode; depth: number; isRoot: boolean }[] = [
    { node: root, depth: 0, isRoot: true },
  ];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const shouldHide =
      hideEmptyFolders && !current.isRoot && isEmptyFolder(current.node);
    if (shouldHide) {
      continue;
    }
    const hasChildren =
      current.node.children.length > 0 ||
      (showFiles && current.node.files.length > 0);
    result.push({
      depth: current.depth,
      kind: "folder",
      path: current.node.path,
      name: current.node.name,
      sizeBytes: current.node.sizeBytes,
      hasChildren,
      node: current.node,
    });
    if (!expanded.has(current.node.path)) {
      continue;
    }
    const childFolders = current.node.children;
    const childFiles = showFiles ? sortFilesBySize(current.node.files) : [];
    for (let i = childFiles.length - 1; i >= 0; i -= 1) {
      const file = childFiles[i];
      if (!file) continue;
      result.push({
        depth: current.depth + 1,
        kind: "file",
        path: file.path,
        name: file.name,
        sizeBytes: file.sizeBytes,
        hasChildren: false,
        file,
        parentPath: current.node.path,
      });
    }
    for (let i = childFolders.length - 1; i >= 0; i -= 1) {
      const child = childFolders[i];
      if (child) {
        stack.push({ node: child, depth: current.depth + 1, isRoot: false });
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

const MAX_SELECTION_HISTORY = 50;

const isSameSelection = (
  left: SelectionEntry | undefined,
  right: SelectionEntry,
): boolean => {
  if (!left) return false;
  return (
    left.kind === right.kind &&
    left.path === right.path &&
    (left.parentPath ?? null) === (right.parentPath ?? null)
  );
};

const createNextSelectionHistory = (
  items: SelectionEntry[],
  currentIndex: number,
  entry: SelectionEntry,
  limit: number,
): { history: SelectionEntry[]; index: number } => {
  const safeIndex = Math.min(Math.max(currentIndex, -1), items.length - 1);
  const head = items.slice(0, safeIndex + 1);
  const last = head[head.length - 1];
  if (isSameSelection(last, entry)) {
    return { history: head, index: head.length - 1 };
  }
  const next = [...head, entry];
  const trimmed = next.length > limit ? next.slice(next.length - limit) : next;
  return { history: trimmed, index: trimmed.length - 1 };
};

const getSelectionLabel = (entry: SelectionEntry): string => {
  const base = entry.path.split(/[/\\]/).pop() ?? entry.path;
  return entry.kind === "file" ? `FILE • ${base}` : base;
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
  const [isErrorExpanded, setIsErrorExpanded] = useState(false);
  const [errorCopied, setErrorCopied] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [detailsNode, setDetailsNode] = useState<ScanNode | null>(null);
  const [contextMenuEnabled, setContextMenuEnabled] = useState<boolean>(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [containerRef, setContainerRef] = useState<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [selectionHistory, setSelectionHistory] = useState<SelectionEntry[]>(
    [],
  );
  const [selectionHistoryIndex, setSelectionHistoryIndex] =
    useState<number>(-1);
  const {
    isNavigationBarVisible,
    toggleNavigationBar,
    setScanStatus,
    scanHistory,
    addScanHistory,
    showExplorerFiles,
    hideEmptyExplorerFolders,
    priorityMode,
    throttleLevel,
    filterMode,
    simpleFilterIds,
    includeExtensionsInput,
    excludeExtensionsInput,
    includeNamesInput,
    excludeNamesInput,
    minSizeInput,
    maxSizeInput,
    includePathsInput,
    excludePathsInput,
    includeRegexInput,
    excludeRegexInput,
    setPriorityMode,
    setThrottleLevel,
    setFilterMode,
    setSimpleFilterIds,
    setIncludeExtensionsInput,
    setExcludeExtensionsInput,
    setIncludeNamesInput,
    setExcludeNamesInput,
    setMinSizeInput,
    setMaxSizeInput,
    setIncludePathsInput,
    setExcludePathsInput,
    setIncludeRegexInput,
    setExcludeRegexInput,
    setShowExplorerFiles,
    setHideEmptyExplorerFolders,
    resetFilters,
  } = useUIStore();
  const unlistenRef = useRef<(() => void) | null>(null);
  const hasInitializedExpansionRef = useRef(false);
  const hasAutoScanRef = useRef(false);
  const copyTimeoutRef = useRef<number | null>(null);
  const historyIndexRef = useRef<number>(-1);

  useEffect((): void => {
    historyIndexRef.current = selectionHistoryIndex;
  }, [selectionHistoryIndex]);

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

  useEffect(() => {
    if (!summary) {
      hasInitializedExpansionRef.current = false;
    }
  }, [summary]);

  const nodeMap = useMemo<Map<string, ScanNode> | null>(() => {
    return summary ? buildNodeMap(summary.root) : null;
  }, [summary]);

  const selectedNode = useMemo<ScanNode | null>(() => {
    if (!summary || !nodeMap || !selectedPath) return null;
    return nodeMap.get(selectedPath) ?? null;
  }, [nodeMap, selectedPath, summary]);

  const treeItems = useMemo<FlatNode[]>(() => {
    return summary
      ? buildTreeItems(
          summary.root,
          expandedPaths,
          showExplorerFiles,
          hideEmptyExplorerFolders,
        )
      : [];
  }, [expandedPaths, hideEmptyExplorerFolders, showExplorerFiles, summary]);

  const addSelectionHistory = useCallback((entry: SelectionEntry): void => {
    setSelectionHistory((previous) => {
      const result = createNextSelectionHistory(
        previous,
        historyIndexRef.current,
        entry,
        MAX_SELECTION_HISTORY,
      );
      historyIndexRef.current = result.index;
      setSelectionHistoryIndex(result.index);
      return result.history;
    });
  }, []);

  const applySelectionFromHistory = useCallback(
    (entry: SelectionEntry): void => {
      if (entry.kind === "file") {
        setSelectedFilePath(entry.path);
        setSelectedPath(entry.parentPath ?? null);
        return;
      }
      setSelectedFilePath(null);
      setSelectedPath(entry.path);
    },
    [],
  );

  const navigateToHistoryIndex = useCallback(
    (nextIndex: number): void => {
      if (nextIndex < 0 || nextIndex >= selectionHistory.length) return;
      const entry = selectionHistory[nextIndex];
      if (!entry) return;
      setSelectionHistoryIndex(nextIndex);
      historyIndexRef.current = nextIndex;
      applySelectionFromHistory(entry);
    },
    [applySelectionFromHistory, selectionHistory],
  );

  const goBack = useCallback((): void => {
    if (selectionHistoryIndex <= 0) return;
    navigateToHistoryIndex(selectionHistoryIndex - 1);
  }, [navigateToHistoryIndex, selectionHistoryIndex]);

  const goForward = useCallback((): void => {
    if (selectionHistoryIndex >= selectionHistory.length - 1) return;
    navigateToHistoryIndex(selectionHistoryIndex + 1);
  }, [navigateToHistoryIndex, selectionHistoryIndex, selectionHistory.length]);

  const selectFolder = useCallback(
    (path: string): void => {
      setSelectedFilePath(null);
      setSelectedPath(path);
      addSelectionHistory({ kind: "folder", path });
    },
    [addSelectionHistory],
  );

  const selectFile = useCallback(
    (path: string, parentPath: string): void => {
      setSelectedFilePath(path);
      setSelectedPath(parentPath);
      addSelectionHistory({ kind: "file", path, parentPath });
    },
    [addSelectionHistory],
  );

  const simpleFilterSet = useMemo<Set<SimpleFilterId>>(() => {
    const next = new Set<SimpleFilterId>();
    for (let i = 0; i < simpleFilterIds.length; i += 1) {
      const value = simpleFilterIds[i];
      if (value && SIMPLE_FILTER_ID_SET.has(value as SimpleFilterId)) {
        next.add(value as SimpleFilterId);
      }
    }
    return next;
  }, [simpleFilterIds]);

  const simpleExtensions = useMemo<string[]>(() => {
    if (filterMode !== "simple") {
      return [];
    }
    const results: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < SIMPLE_FILTER_CATEGORIES.length; i += 1) {
      const category = SIMPLE_FILTER_CATEGORIES[i];
      if (!category || !simpleFilterSet.has(category.id)) continue;
      for (let j = 0; j < category.extensions.length; j += 1) {
        const ext = category.extensions[j];
        if (!ext || seen.has(ext)) continue;
        seen.add(ext);
        results.push(ext);
      }
    }
    return results;
  }, [filterMode, simpleFilterSet]);

  const regexErrorMessage = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      new RegExp(trimmed);
      return null;
    } catch (err) {
      return "Invalid regex pattern";
    }
  };

  const includeRegexError = useMemo<string | null>(() => {
    return regexErrorMessage(includeRegexInput);
  }, [includeRegexInput]);

  const excludeRegexError = useMemo<string | null>(() => {
    return regexErrorMessage(excludeRegexInput);
  }, [excludeRegexInput]);

  const hasRegexError = includeRegexError || excludeRegexError;

  const parseSizeInput = (
    value: string,
  ): { value: number | null; error: string | null } => {
    const trimmed = value.trim();
    if (!trimmed) return { value: null, error: null };
    const parsed = parseSizeValue(trimmed);
    if (parsed === null) {
      return { value: null, error: "Use values like 10mb or 500kb" };
    }
    return { value: parsed, error: null };
  };

  const minSizeResult = useMemo(() => {
    return parseSizeInput(minSizeInput);
  }, [minSizeInput]);

  const maxSizeResult = useMemo(() => {
    return parseSizeInput(maxSizeInput);
  }, [maxSizeInput]);

  const sizeRangeError = useMemo<string | null>(() => {
    if (minSizeResult.value === null || maxSizeResult.value === null) {
      return null;
    }
    if (minSizeResult.value > maxSizeResult.value) {
      return "Min size must be smaller than max size";
    }
    return null;
  }, [maxSizeResult.value, minSizeResult.value]);

  const hasFilterError = Boolean(
    hasRegexError ||
    minSizeResult.error ||
    maxSizeResult.error ||
    sizeRangeError,
  );

  const scanFilters = useMemo<ScanFilters>(() => {
    if (filterMode === "simple") {
      return {
        includeExtensions: simpleExtensions,
        excludeExtensions: [],
        includeNames: [],
        excludeNames: [],
        minSizeBytes: null,
        maxSizeBytes: null,
        includeRegex: null,
        excludeRegex: null,
        includePaths: [],
        excludePaths: [],
      };
    }
    return {
      includeExtensions: parseListInput(includeExtensionsInput),
      excludeExtensions: parseListInput(excludeExtensionsInput),
      includeNames: parseListInput(includeNamesInput),
      excludeNames: parseListInput(excludeNamesInput),
      minSizeBytes: minSizeResult.value,
      maxSizeBytes: maxSizeResult.value,
      includeRegex: includeRegexInput.trim() || null,
      excludeRegex: excludeRegexInput.trim() || null,
      includePaths: parseListInput(includePathsInput),
      excludePaths: parseListInput(excludePathsInput),
    };
  }, [
    excludeExtensionsInput,
    excludeNamesInput,
    excludePathsInput,
    excludeRegexInput,
    filterMode,
    includeExtensionsInput,
    includeNamesInput,
    includePathsInput,
    includeRegexInput,
    maxSizeResult.value,
    minSizeResult.value,
    simpleExtensions,
  ]);

  const scanOptions = useMemo<ScanOptions>(() => {
    return {
      priorityMode,
      throttleLevel,
      filters: scanFilters,
    };
  }, [priorityMode, scanFilters, throttleLevel]);

  const activeNode = summary ? (selectedNode ?? summary.root) : null;
  const activeChildren = activeNode?.children ?? [];

  const filterMatchers = useMemo<FilterMatchers>(() => {
    return buildFilterMatchers(scanFilters);
  }, [scanFilters]);

  const searchParams = useMemo<SearchParams | null>(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return null;
    return parseSearchQuery(trimmed);
  }, [searchQuery]);

  const largestFiles = useMemo<ScanFile[]>(() => {
    if (!summary || !activeNode) return [];
    return getLargestFilesForNode(activeNode, 10, (file): boolean => {
      if (!matchesFilterFile(file, filterMatchers)) return false;
      if (searchParams && !matchesSearchEntry(file, searchParams)) return false;
      return true;
    });
  }, [activeNode, filterMatchers, searchParams, summary]);

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

  const canGoBack = selectionHistoryIndex > 0;
  const canGoForward =
    selectionHistoryIndex >= 0 &&
    selectionHistoryIndex < selectionHistory.length - 1;

  const searchResults = useMemo<ScanNode[] | null>(() => {
    if (!summary || !searchParams) {
      return null;
    }
    const results: ScanNode[] = [];
    const params = searchParams;
    const stack: ScanNode[] = [summary.root];
    const limit = 1000;
    while (stack.length > 0 && results.length < limit) {
      const node = stack.pop();
      if (!node) continue;
      if (matchesSearchEntry(node, params)) {
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
  }, [summary, searchParams]);

  const errorLines = useMemo<string[]>((): string[] => {
    if (!error) return [];
    return error
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }, [error]);

  const errorSummary = useMemo<string>(() => {
    if (!error) return "";
    return errorLines[0] ?? error;
  }, [error, errorLines]);

  useEffect((): void => {
    if (!summary || !selectedPath) return;
    if (selectionHistory.length > 0) return;
    if (selectedPath !== summary.root.path) return;
    addSelectionHistory({ kind: "folder", path: selectedPath });
  }, [addSelectionHistory, selectedPath, selectionHistory.length, summary]);

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

    if (!hasInitializedExpansionRef.current) {
      setExpandedPaths(buildInitialExpandedPaths(payload.root));
      hasInitializedExpansionRef.current = true;
    }
  };

  const finishScan = (payload: ScanSummary): void => {
    applySummary(payload);
    addScanHistory(payload.root.path);
    setIsScanning(false);
    setScanStatus("complete");
    clearListeners();
  };

  const failScan = (message: string): void => {
    setError(message);
    setIsErrorExpanded(true);
    setIsScanning(false);
    setScanStatus("idle");
    clearListeners();
  };

  const cancelScanRun = (_message: string): void => {
    setIsScanning(false);
    setScanStatus("idle");
    clearListeners();
  };

  const startScanWithFolder = async (folder: string): Promise<void> => {
    clearListeners();
    setSummary(null);
    setSelectedPath(null);
    setSelectedFilePath(null);
    setIsScanning(true);
    setScanStatus("scanning");
    setErrorCopied(false);
    setIsErrorExpanded(false);
    setSelectionHistory([]);
    setSelectionHistoryIndex(-1);
    historyIndexRef.current = -1;
    hasInitializedExpansionRef.current = false;
    try {
      unlistenRef.current = await startScan(folder, scanOptions, {
        onProgress: applySummary,
        onComplete: finishScan,
        onError: failScan,
        onCancel: cancelScanRun,
      });
    } catch (err) {
      failScan(toErrorMessage(err));
    }
  };

  const handleScan = async (): Promise<void> => {
    setError(null);
    setIsErrorExpanded(false);
    if (hasFilterError) {
      setError("Fix filter errors before starting a scan.");
      setIsErrorExpanded(false);
      return;
    }
    const folder = await resolveFolderSelection();
    if (!folder) {
      return;
    }
    await startScanWithFolder(folder);
  };

  const toggleSimpleFilter = useCallback(
    (id: SimpleFilterId): void => {
      const next: string[] = [];
      let exists = false;
      for (let i = 0; i < simpleFilterIds.length; i += 1) {
        const value = simpleFilterIds[i];
        if (!value) continue;
        if (value === id) {
          exists = true;
          continue;
        }
        next.push(value);
      }
      if (!exists) next.push(id);
      setSimpleFilterIds(next);
    },
    [setSimpleFilterIds, simpleFilterIds],
  );

  const handleCancelScan = async (): Promise<void> => {
    try {
      await cancelScan();
    } catch (err) {
      failScan(toErrorMessage(err));
    }
  };

  const handleOpenPath = useCallback(
    async (path: string | null): Promise<void> => {
      if (!path) return;
      try {
        setError(null);
        await openPath(path);
      } catch (err) {
        setError(toErrorMessage(err));
      }
    },
    [setError],
  );

  const handleShowInExplorer = useCallback(
    async (path: string | null): Promise<void> => {
      if (!path) return;
      try {
        setError(null);
        await showInExplorer(path);
      } catch (err) {
        setError(toErrorMessage(err));
      }
    },
    [setError],
  );

  const clearError = (): void => {
    setError(null);
    setIsErrorExpanded(false);
  };

  const handleCopyError = async (): Promise<void> => {
    if (!error) return;
    try {
      await navigator.clipboard.writeText(error);
      setErrorCopied(true);
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setErrorCopied(false);
      }, 2000);
    } catch (copyError) {
      console.error("Failed to copy error", copyError);
    }
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

  const openFolderContextMenu = useCallback(
    (event: MouseEvent, node: ScanNode): void => {
      event.preventDefault();
      event.stopPropagation();
      const position = getMenuPosition(event, MENU_WIDTH, MENU_HEIGHT);
      setContextMenu({ ...position, kind: "folder", node });
    },
    [],
  );

  const openFileContextMenu = useCallback(
    (event: MouseEvent, file: ScanFile): void => {
      event.preventDefault();
      event.stopPropagation();
      const position = getMenuPosition(event, MENU_WIDTH, MENU_HEIGHT);
      setContextMenu({ ...position, kind: "file", file });
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
        onClick={(): void => selectFolder(child.path)}
        onContextMenu={(event): void => openFolderContextMenu(event, child)}
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
  useEffect((): (() => void) => {
    return (): void => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
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
    const scrollOptions: AddEventListenerOptions = {
      capture: true,
      passive: true,
    };
    window.addEventListener("resize", handleDismiss);
    window.addEventListener("blur", handleDismiss);
    window.addEventListener("scroll", handleDismiss, scrollOptions);
    document.addEventListener("click", handleDismiss);
    document.addEventListener("keydown", handleKeyDown);
    return (): void => {
      window.removeEventListener("resize", handleDismiss);
      window.removeEventListener("blur", handleDismiss);
      window.removeEventListener("scroll", handleDismiss, scrollOptions);
      document.removeEventListener("click", handleDismiss);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect((): (() => void) => {
    const handleMouseButton = (event: globalThis.MouseEvent): void => {
      if (event.button === 3 && canGoBack) {
        event.preventDefault();
        goBack();
        return;
      }
      if (event.button === 4 && canGoForward) {
        event.preventDefault();
        goForward();
      }
    };
    window.addEventListener("mouseup", handleMouseButton);
    return (): void => window.removeEventListener("mouseup", handleMouseButton);
  }, [canGoBack, canGoForward, goBack, goForward]);

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
          <div
            className="px-3 py-2 text-[11px] font-semibold text-slate-400 border-b border-slate-800/70 whitespace-nowrap"
            title={getMenuTitle(contextMenu)}
          >
            {truncateMiddle(getMenuTitle(contextMenu), 32)}
          </div>
          {contextMenu.kind === "folder" ? (
            <>
              <button
                type="button"
                onClick={(): void => {
                  if (contextMenu.node?.path) {
                    openScanWindow(contextMenu.node.path);
                  }
                  closeContextMenu();
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-xs text-slate-200 hover:bg-slate-800/70"
                role="menuitem"
              >
                <span>Open in New Window</span>
                <span className="text-[10px] text-slate-500">Scan</span>
              </button>
              <button
                type="button"
                onClick={(): void => {
                  handleShowInExplorer(contextMenu.node?.path ?? null);
                  closeContextMenu();
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-xs text-slate-200 hover:bg-slate-800/70"
                role="menuitem"
              >
                <span>Show in Explorer</span>
                <span className="text-[10px] text-slate-500">Folder</span>
              </button>
            </>
          ) : null}
          {contextMenu.kind === "file" ? (
            <>
              <button
                type="button"
                onClick={(): void => {
                  handleOpenPath(contextMenu.file?.path ?? null);
                  closeContextMenu();
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-xs text-slate-200 hover:bg-slate-800/70"
                role="menuitem"
              >
                <span>Open</span>
                <span className="text-[10px] text-slate-500">File</span>
              </button>
              <button
                type="button"
                onClick={(): void => {
                  handleShowInExplorer(contextMenu.file?.path ?? null);
                  closeContextMenu();
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-xs text-slate-200 hover:bg-slate-800/70"
                role="menuitem"
              >
                <span>Show in Explorer</span>
                <span className="text-[10px] text-slate-500">File</span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="shrink-0 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800/80 bg-slate-900/50 px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex flex-1 items-center gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold">Storage Scan</h2>
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
              placeholder="Search... (name:, path:, ext:, size>)"
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
          {!contextMenuEnabled ? (
            <button
              type="button"
              onClick={handleToggleContextMenu}
              className="mr-2 rounded-md border border-slate-700 bg-slate-800/50 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600"
            >
              Add to Explorer
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleScan}
            disabled={isScanning}
            className="rounded-md bg-gradient-to-r from-blue-500 to-blue-400 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:from-blue-400 hover:to-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 disabled:cursor-not-allowed disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-300"
          >
            {isScanning ? "Scanning..." : "Scan Folder"}
          </button>
          {isScanning ? (
            <button
              type="button"
              onClick={handleCancelScan}
              className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
            >
              Cancel
            </button>
          ) : null}
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
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-md px-3 py-1.5 text-xs font-semibold transition border border-slate-700 bg-slate-900/40 text-slate-400 hover:text-slate-200"
            >
              Clear Filters
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
                  const active = simpleFilterSet.has(category.id);
                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={(): void => toggleSimpleFilter(category.id)}
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
                {simpleFilterSet.size === 0 ? (
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
                  Include names (contains)
                  <input
                    type="text"
                    value={includeNamesInput}
                    onChange={(event): void =>
                      setIncludeNamesInput(event.target.value)
                    }
                    placeholder="report, backup"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Exclude names (contains)
                  <input
                    type="text"
                    value={excludeNamesInput}
                    onChange={(event): void =>
                      setExcludeNamesInput(event.target.value)
                    }
                    placeholder="node_modules, cache"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Min size
                  <input
                    type="text"
                    value={minSizeInput}
                    onChange={(event): void =>
                      setMinSizeInput(event.target.value)
                    }
                    placeholder="10mb"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                  />
                  {minSizeResult.error ? (
                    <span className="text-[10px] text-amber-400">
                      {minSizeResult.error}
                    </span>
                  ) : null}
                </label>
                <label className="text-xs text-slate-400">
                  Max size
                  <input
                    type="text"
                    value={maxSizeInput}
                    onChange={(event): void =>
                      setMaxSizeInput(event.target.value)
                    }
                    placeholder="2gb"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                  />
                  {maxSizeResult.error ? (
                    <span className="text-[10px] text-amber-400">
                      {maxSizeResult.error}
                    </span>
                  ) : null}
                  {sizeRangeError ? (
                    <span className="text-[10px] text-amber-400">
                      {sizeRangeError}
                    </span>
                  ) : null}
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
                  {includeRegexError ? (
                    <span className="text-[10px] text-amber-400">
                      {includeRegexError}
                    </span>
                  ) : null}
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
                  {excludeRegexError ? (
                    <span className="text-[10px] text-amber-400">
                      {excludeRegexError}
                    </span>
                  ) : null}
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

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
                {truncateMiddle(path, 36)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <div
          className="shrink-0 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100 shadow-sm"
          role="alert"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-red-500/20 text-red-300">
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v4m0 4h.01M10.29 3.86l-7.4 12.82A2 2 0 004.6 19h14.8a2 2 0 001.71-3.02l-7.4-12.82a2 2 0 00-3.42 0z"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-red-100">
                  Something went wrong
                </p>
                <p className="text-xs text-red-200/80 max-w-2xl">
                  {errorSummary}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyError}
                className="rounded-md border border-red-400/40 bg-red-500/10 px-3 py-1 text-[11px] font-semibold text-red-100 transition hover:bg-red-500/20"
              >
                {errorCopied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={(): void => setIsErrorExpanded((current) => !current)}
                className="rounded-md border border-red-400/40 bg-red-500/10 px-3 py-1 text-[11px] font-semibold text-red-100 transition hover:bg-red-500/20"
              >
                {isErrorExpanded ? "Hide Details" : "Show Details"}
              </button>
              <button
                type="button"
                onClick={clearError}
                className="rounded-md border border-red-400/40 bg-red-500/10 px-3 py-1 text-[11px] font-semibold text-red-100 transition hover:bg-red-500/20"
              >
                Dismiss
              </button>
            </div>
          </div>
          {isErrorExpanded ? (
            <div className="mt-3 rounded-lg border border-red-500/20 bg-slate-950/60 p-3">
              <p className="text-[10px] uppercase tracking-widest text-red-200/70">
                Error details
              </p>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-red-100/90">
                {error}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}

      {summary ? (
        <div className="flex-1 min-h-0 grid gap-5 lg:grid-cols-[minmax(400px,_40%)_1fr]">
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
                <div className="flex items-center gap-1 rounded-lg border border-slate-800/50 bg-slate-950/40 p-0.5">
                  <button
                    type="button"
                    onClick={(): void =>
                      setShowExplorerFiles(!showExplorerFiles)
                    }
                    className={`px-2.5 py-0.5 text-[10px] font-medium rounded transition ${
                      showExplorerFiles
                        ? "bg-slate-800 text-slate-100"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                    title="Toggle files in tree"
                  >
                    Files: {showExplorerFiles ? "On" : "Off"}
                  </button>
                  <button
                    type="button"
                    onClick={(): void =>
                      setHideEmptyExplorerFolders(!hideEmptyExplorerFolders)
                    }
                    className={`px-2.5 py-0.5 text-[10px] font-medium rounded transition ${
                      hideEmptyExplorerFolders
                        ? "bg-slate-800 text-slate-100"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                    title="Hide empty folders"
                  >
                    Empty: {hideEmptyExplorerFolders ? "Hidden" : "Shown"}
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
              className="flex-1 overflow-auto py-2 min-h-0"
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
                          onClick={(): void => selectFolder(node.path)}
                          onDoubleClick={(): void => setDetailsNode(node)}
                          onContextMenu={(event): void =>
                            openFolderContextMenu(event, node)
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
                              className="text-[10px] text-slate-500 truncate max-w-[280px] whitespace-nowrap"
                              title={node.path}
                            >
                              {truncateMiddle(node.path, 52)}
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
                  selectedFilePath={selectedFilePath}
                  onToggleExpand={handleToggleExpand}
                  onSelectFolder={selectFolder}
                  onSelectFile={selectFile}
                  onDouble={setDetailsNode}
                  onOpenFile={handleOpenPath}
                  onContextMenu={openFolderContextMenu}
                  onContextMenuFile={openFileContextMenu}
                />
              ) : (
                <Treemap
                  rootNode={selectedNode ?? summary.root}
                  width={containerSize.width}
                  height={containerSize.height}
                  onSelect={(node): void => selectFolder(node.path)}
                  selectedPath={selectedPath}
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 overflow-auto h-full pr-1">
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
                      className="text-xs text-slate-500 font-mono truncate max-w-full whitespace-nowrap"
                      title={activeNode?.path}
                    >
                      {activeNode?.path
                        ? truncateMiddle(activeNode.path, 64)
                        : ""}
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
                      {formatDuration(summary.durationMs)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <UsageCharts node={activeNode} />

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
                        selectFolder(parentPath ?? summary.root.path)
                      }
                      onContextMenu={(event): void =>
                        openFileContextMenu(event, file)
                      }
                      className={`w-full text-left text-[13px] leading-5 transition ${
                        isSelected
                          ? "bg-blue-500/15 text-blue-100"
                          : "text-slate-200 hover:bg-slate-800/60"
                      }`}
                      style={rowStyle}
                      title={file.path}
                    >
                      <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-slate-100">
                            {file.name}
                          </div>
                          <div
                            className="text-xs text-slate-400 truncate whitespace-nowrap"
                            title={file.path}
                          >
                            {truncateMiddle(file.path, 56)}
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
