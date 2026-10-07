export interface EmptyFolderSettings {
  minDepth: string;
  maxDepth: string;
  includeHidden: boolean;
  emptyAfterRemoval: boolean;
  includeNames: string;
  excludeNames: string;
  includePaths: string;
  excludePaths: string;
  includeRegex: string;
  excludeRegex: string;
  regexMatchPath: boolean;
  matchCase: boolean;
  minAgeDays: string;
  maxAgeDays: string;
}

export interface EmptyFolderOptions {
  minDepth: number;
  maxDepth: number | null;
  includeHidden: boolean;
  emptyAfterRemoval: boolean;
  includeNames: string[];
  excludeNames: string[];
  includePaths: string[];
  excludePaths: string[];
  includeRegex: string;
  excludeRegex: string;
  regexMatchPath: boolean;
  matchCase: boolean;
  minAgeDays: number | null;
  maxAgeDays: number | null;
}

export interface EmptyFolder {
  path: string;
  source: string;
  name: string;
  relativePath: string;
  depth: number;
  modified: number | null;
  children: string[];
}

export interface EmptyFolderPreview {
  folders: EmptyFolder[];
  errors: { path: string; message: string }[];
  inspected: number;
  cancelled: boolean;
}

export interface RemovalOutcome {
  path: string;
  error: string | null;
}

export interface RemovalResult {
  outcomes: RemovalOutcome[];
  cancelled: boolean;
}

export interface FolderProgress {
  id: string;
  processed: number;
  total: number | null;
  found: number;
  path: string;
}

export type FolderSortKey = "path" | "depth" | "modified";
