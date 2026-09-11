export interface ScanNode {
  id: number;
  parentId: number | null;
  path: string;
  name: string;
  sizeBytes: number;
  fileCount: number;
  dirCount: number;
  state: "scanning" | "complete" | "incomplete";
  files: ScanFile[];
  children: ScanNode[];
}

export interface ScanFile {
  path: string;
  name: string;
  sizeBytes: number;
  modified?: number;
}

export interface ScanSummary {
  id?: string;
  root: ScanNode;
  totalBytes: number;
  fileCount: number;
  dirCount: number;
  largestFiles: ScanFile[];
  durationMs: number;
  skippedEntries: number;
}

export interface ScanUpdate {
  id: string;
  sequence: number;
  folders: Omit<ScanNode, "children" | "files">[];
  files: { parentId: number; file: ScanFile }[];
  totalBytes: number;
  fileCount: number;
  dirCount: number;
  skippedEntries: number;
  largestFiles: ScanFile[];
  durationMs: number;
}

export interface ScanFailure {
  id: string;
  message: string;
}

export interface DiskUsage {
  path: string;
  totalBytes: number;
  freeBytes: number;
}

export interface FlatNode {
  depth: number;
  kind: "folder" | "file";
  path: string;
  name: string;
  sizeBytes: number;
  hasChildren: boolean;
  node?: ScanNode;
  file?: ScanFile;
  parentPath?: string | undefined;
}

export type ScanPriorityMode = "performance" | "balanced" | "low";

export type ScanThrottleLevel = "off" | "low" | "medium" | "high";

export interface ScanFilters {
  includeExtensions: string[];
  excludeExtensions: string[];
  includeNames: string[];
  excludeNames: string[];
  minSizeBytes: number | null;
  maxSizeBytes: number | null;
  minModifiedTimestamp: number | null;
  maxModifiedTimestamp: number | null;
  includeRegex: string | null;
  excludeRegex: string | null;
  includePaths: string[];
  excludePaths: string[];
}

export interface ScanOptions {
  priorityMode: ScanPriorityMode;
  throttleLevel: ScanThrottleLevel;
  filters: ScanFilters;
}
