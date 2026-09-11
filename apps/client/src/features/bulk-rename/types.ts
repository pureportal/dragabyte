export type RenameRuleType = 'replace' | 'prefix' | 'suffix' | 'case' | 'extension' | 'remove' | 'numbering';
export type FilterRuleType = 'include' | 'exclude';

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
  targetType?: 'file' | 'folder' | 'both'; 

  // Dynamic properties based on type
  find?: string;
  replace?: string;
  useRegex?: boolean;
  matchAll?: boolean; // Replace All vs Replace First
  rawText?: string; // for prefix/suffix
  caseType?: 'lowercase' | 'uppercase' | 'camelCase' | 'pascalCase' | 'sentenceCase' | 'kebabCase';
  removeCount?: number;
  removeFrom?: 'start' | 'end';
  numberStart?: number;
  numberStep?: number;
  numberFormat?: string; // e.g. "000"
  addTo?: 'prefix' | 'suffix';
}

export interface FileItem {
    id: string; // usually path
    path: string;
    directory: string; // Parent directory
    originalName: string;
    newName: string;
    size: number;
    isDirectory?: boolean;
    status: 'pending' | 'success' | 'error';
    error?: string;
}

export interface SavedTemplate {
    id: string;
    name: string;
    rules?: RenameRule[];
    filters?: FilterRule[];
    createdAt: number;
}

