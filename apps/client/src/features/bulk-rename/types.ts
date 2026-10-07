export type RenameRuleType =
  | "replace"
  | "prefix"
  | "suffix"
  | "case"
  | "extension"
  | "remove"
  | "numbering";
export type FilterRuleType = "include" | "exclude";

export interface FilterRule {
  id: string;
  type: FilterRuleType;
  text: string;
  active: boolean;
  useRegex: boolean;
  matchCase: boolean;
}

export interface RenameRule {
  id: string;
  type: RenameRuleType;
  active: boolean;
  targetType?: "file" | "folder" | "both";

  find?: string;
  replace?: string;
  useRegex?: boolean;
  matchAll?: boolean;
  rawText?: string;
  caseType?:
    | "lowercase"
    | "uppercase"
    | "camelCase"
    | "pascalCase"
    | "sentenceCase"
    | "kebabCase";
  removeCount?: number;
  removeFrom?: "start" | "end";
  numberStart?: number;
  numberStep?: number;
  numberFormat?: string;
  addTo?: "prefix" | "suffix";
}

export interface FileItem {
  id: string;
  path: string;
  directory: string;
  originalName: string;
  newName: string;
  size: number;
  isDirectory: boolean;
  status: "pending" | "success" | "error";
  error?: string | undefined;
  renameMode: "auto" | "disabled" | "enabled";
}

export interface ImportOptions {
  contents: boolean;
  includeFiles: boolean;
  includeFolders: boolean;
  minDepth: number;
  maxDepth: number | null;
  pattern: string;
  matchPath: boolean;
  matchCase: boolean;
}

export interface ImportItem {
  path: string;
  name: string;
  isDirectory: boolean;
  size: number;
  depth: number;
  relativePath: string;
}

export interface RenameOutcome {
  path: string;
  newPath: string;
  error: string | null;
}

export type SortKey =
  | "originalName"
  | "directory"
  | "extension"
  | "size"
  | "kind";

export interface SavedTemplate {
  id: string;
  name: string;
  rules?: RenameRule[];
  filters?: FilterRule[];
  createdAt: number;
}
