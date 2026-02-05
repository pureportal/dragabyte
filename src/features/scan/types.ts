export interface ScanNode {
  path: string;
  name: string;
  sizeBytes: number;
  fileCount: number;
  dirCount: number;
  files: ScanFile[];
  children: ScanNode[];
}

export interface ScanFile {
  path: string;
  name: string;
  sizeBytes: number;
}

export interface ScanSummary {
  root: ScanNode;
  totalBytes: number;
  fileCount: number;
  dirCount: number;
  largestFiles: ScanFile[];
  durationMs: number;
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
  parentPath?: string;
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
