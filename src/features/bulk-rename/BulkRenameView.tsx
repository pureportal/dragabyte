import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { clsx, type ClassValue } from "clsx";
import {
  ArrowRight,
  Check,
  ChevronDown,
  File as FileIcon,
  FileText,
  Filter,
  Folder,
  FolderInput,
  GripVertical,
  ListFilter,
  Play,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { twMerge } from "tailwind-merge";
import { InputModal } from "../../components/InputModal";
import { applyRules } from "./renameLogic";
import type {
  FileItem,
  FilterRule,
  FilterRuleType,
  RenameRule,
  RenameRuleType,
  SavedTemplate,
} from "./types";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SEP = navigator.userAgent.includes("Win") ? "\\" : "/";

const getPathName = (path: string): string => {
  const normalized = path.replace(/[\\/]+$/, "");
  if (!normalized) return path;
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] ?? normalized;
};

const getPathDirectory = (path: string): string => {
  const normalized = path.replace(/[\\/]+$/, "");
  const lastSeparator = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );

  if (lastSeparator < 0) {
    return "";
  }

  if (lastSeparator === 0) {
    return normalized.slice(0, 1);
  }

  const directory = normalized.slice(0, lastSeparator);
  if (/^[A-Za-z]:$/.test(directory)) {
    return `${directory}${normalized[lastSeparator]}`;
  }

  return directory;
};

const parseContextPaths = (): string[] => {
  const params = new URLSearchParams(window.location.search);
  const single = params.get("path");
  const rawPaths = params.get("paths");
  if (rawPaths) {
    try {
      const parsed = JSON.parse(rawPaths);
      if (Array.isArray(parsed)) {
        return parsed.filter((value) => typeof value === "string");
      }
    } catch {
      return single ? [single] : [];
    }
  }
  return single ? [single] : [];
};

type RenameContextItem = {
  path: string;
  name: string;
  isDirectory: boolean;
};

type RenameTargetType = NonNullable<RenameRule["targetType"]>;
type RenameCaseType = NonNullable<RenameRule["caseType"]>;
type RenameRemoveFromType = NonNullable<RenameRule["removeFrom"]>;
type RenameAddToType = NonNullable<RenameRule["addTo"]>;

type BatchRenameItem = {
  path: string;
  new_path: string;
};

type BatchRenameResult = {
  successCount: number;
  errors: string[];
};

const FILTER_TYPE_OPTIONS: SelectOption<FilterRuleType>[] = [
  { label: "Include", value: "include" },
  { label: "Exclude", value: "exclude" },
];

const TARGET_TYPE_OPTIONS: SelectOption<RenameTargetType>[] = [
  { label: "Both", value: "both" },
  { label: "Files", value: "file" },
  { label: "Folders", value: "folder" },
];

const CASE_TYPE_OPTIONS: SelectOption<RenameCaseType>[] = [
  { label: "lowercase", value: "lowercase" },
  { label: "UPPERCASE", value: "uppercase" },
  { label: "camelCase", value: "camelCase" },
  { label: "PascalCase", value: "pascalCase" },
  { label: "Sentence case", value: "sentenceCase" },
  { label: "kebab-case", value: "kebabCase" },
];

const EXTENSION_CASE_OPTIONS: SelectOption<RenameCaseType>[] = [
  { label: "lowercase", value: "lowercase" },
  { label: "UPPERCASE", value: "uppercase" },
];

const REMOVE_FROM_OPTIONS: SelectOption<RenameRemoveFromType>[] = [
  { label: "Start", value: "start" },
  { label: "End", value: "end" },
];

const ADD_TO_OPTIONS: SelectOption<RenameAddToType>[] = [
  { label: "Suffix", value: "suffix" },
  { label: "Prefix", value: "prefix" },
];

const createId = (): string => {
  return Math.random().toString(36).slice(2, 11);
};

const matchesFilterRule = (name: string, rule: FilterRule): boolean => {
  if (!rule.text) {
    return false;
  }

  if (rule.useRegex) {
    try {
      return new RegExp(rule.text, rule.matchCase ? "" : "i").test(name);
    } catch {
      return false;
    }
  }

  const text = rule.matchCase ? rule.text : rule.text.toLowerCase();
  const value = rule.matchCase ? name : name.toLowerCase();
  return value.includes(text);
};

const buildFileItem = (
  path: string,
  name: string,
  isDirectory: boolean,
): FileItem => {
  return {
    id: path,
    path,
    directory: getPathDirectory(path),
    originalName: name,
    newName: name,
    status: "pending",
    isDirectory,
    size: 0,
  };
};

const applyRulesToItems = (
  items: FileItem[],
  rules: RenameRule[],
): FileItem[] => {
  const next: FileItem[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) continue;
    next.push({
      ...item,
      newName: applyRules(item.originalName, rules, i, item.isDirectory),
    });
  }
  return next;
};

const applyFilters = (items: FileItem[], filters: FilterRule[]): FileItem[] => {
  const activeFilters = filters.filter((f) => f.active);
  if (activeFilters.length === 0) return items;

  const includes = activeFilters.filter((f) => f.type === "include");
  const excludes = activeFilters.filter((f) => f.type === "exclude");

  return items.filter((item) => {
    for (const rule of excludes) {
      if (matchesFilterRule(item.originalName, rule)) {
        return false;
      }
    }

    if (includes.length > 0) {
      for (const rule of includes) {
        if (matchesFilterRule(item.originalName, rule)) {
          return true;
        }
      }
      return false;
    }

    return true;
  });
};

interface SelectOption<T> {
  label: string;
  value: T;
}

const Select = <T extends string | number>({
  value,
  options,
  onChange,
  className,
  triggerClassName,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  triggerClassName?: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <div className={cn("relative inline-block text-left", className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center justify-between gap-2 px-2.5 py-1 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded text-xs text-slate-300 transition-colors min-w-[80px]",
          triggerClassName,
        )}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown className="w-3 h-3 opacity-50 flex-shrink-0" />
      </button>
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full left-0 mt-1 w-full min-w-[110px] z-50 bg-slate-900 border border-slate-700/80 rounded-md shadow-xl py-1 animate-in fade-in-0 zoom-in-95 duration-100">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-2 transition-colors",
                  value === opt.value
                    ? "bg-slate-800/80 text-sky-400"
                    : "text-slate-300 hover:bg-slate-800",
                )}
              >
                <span className="truncate">{opt.label}</span>
                {value === opt.value && (
                  <Check className="w-3 h-3 flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const FilterRuleItem = ({
  rule,
  onUpdate,
  onRemove,
}: {
  rule: FilterRule;
  onUpdate: (id: string, updates: Partial<FilterRule>) => void;
  onRemove: (id: string) => void;
}) => {
  return (
    <div className="flex flex-col gap-2 p-3 bg-slate-900/50 rounded-lg border border-slate-800">
      <div className="flex items-center gap-2">
        <div className="flex-1 flex gap-2 items-center">
          <Select
            value={rule.type}
            onChange={(value) => onUpdate(rule.id, { type: value })}
            options={FILTER_TYPE_OPTIONS}
            triggerClassName={cn(
              "px-2 py-0.5 text-[10px] min-w-[70px] border-transparent font-bold uppercase tracking-wider",
              rule.type === "include" ? "text-emerald-400" : "text-rose-400",
            )}
          />
          <span className="text-xs text-slate-500">files matching:</span>
        </div>
        <button
          onClick={() => onUpdate(rule.id, { active: !rule.active })}
          className={cn(
            "text-xs px-2 py-0.5 rounded border transition-colors",
            rule.active
              ? "border-green-800 bg-green-950/30 text-green-400"
              : "border-slate-700 text-slate-500",
          )}
        >
          {rule.active ? "On" : "Off"}
        </button>
        <button
          onClick={() => onRemove(rule.id)}
          className="text-slate-500 hover:text-red-400"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid gap-2">
        <input
          type="text"
          placeholder="Filter text..."
          value={rule.text}
          onChange={(e) => onUpdate(rule.id, { text: e.target.value })}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm text-slate-200"
        />
        <div className="flex gap-4">
          <label className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={rule.useRegex}
              onChange={(e) =>
                onUpdate(rule.id, { useRegex: e.target.checked })
              }
            />
            Regex
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={rule.matchCase}
              onChange={(e) =>
                onUpdate(rule.id, { matchCase: e.target.checked })
              }
            />
            Match Case
          </label>
        </div>
      </div>
    </div>
  );
};

const RuleItem = ({
  rule,
  onUpdate,
  onRemove,
}: {
  rule: RenameRule;
  onUpdate: (id: string, updates: Partial<RenameRule>) => void;
  onRemove: (id: string) => void;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: rule.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex flex-col gap-2 p-3 bg-slate-900/50 rounded-lg border border-slate-800"
    >
      <div className="flex items-center gap-2">
        <div {...attributes} {...listeners} className="cursor-grab touch-none">
          <GripVertical className="w-4 h-4 text-slate-500" />
        </div>
        <div className="flex-1 flex gap-2 items-center">
          <span className="text-xs font-semibold text-sky-400 bg-sky-950/30 px-2 py-0.5 rounded capitalize">
            {rule.type}
          </span>

          <Select
            value={rule.targetType || "both"}
            onChange={(value) => onUpdate(rule.id, { targetType: value })}
            options={TARGET_TYPE_OPTIONS}
            triggerClassName="px-2 py-0.5 text-[10px] border-slate-700 bg-transparent min-w-[70px]"
          />
        </div>
        <button
          onClick={() => onUpdate(rule.id, { active: !rule.active })}
          className={cn(
            "text-xs px-2 py-0.5 rounded border transition-colors",
            rule.active
              ? "border-green-800 bg-green-950/30 text-green-400"
              : "border-slate-700 text-slate-500",
          )}
        >
          {rule.active ? "On" : "Off"}
        </button>
        <button
          onClick={() => onRemove(rule.id)}
          className="text-slate-500 hover:text-red-400"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="pl-6 grid gap-2">
        {rule.type === "replace" && (
          <>
            <input
              type="text"
              placeholder="Find"
              value={rule.find || ""}
              onChange={(e) => onUpdate(rule.id, { find: e.target.value })}
              className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm text-slate-200"
            />
            <input
              type="text"
              placeholder="Replace with"
              value={rule.replace || ""}
              onChange={(e) => onUpdate(rule.id, { replace: e.target.value })}
              className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm text-slate-200"
            />
            <div className="flex gap-2">
              <label className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rule.matchAll}
                  onChange={(e) =>
                    onUpdate(rule.id, { matchAll: e.target.checked })
                  }
                />
                All
              </label>
              <label className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rule.useRegex}
                  onChange={(e) =>
                    onUpdate(rule.id, { useRegex: e.target.checked })
                  }
                />
                Regex
              </label>
            </div>
          </>
        )}

        {(rule.type === "prefix" || rule.type === "suffix") && (
          <input
            type="text"
            placeholder="Text to add"
            value={rule.rawText || ""}
            onChange={(e) => onUpdate(rule.id, { rawText: e.target.value })}
            className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm text-slate-200"
          />
        )}

        {rule.type === "case" && (
          <>
            <Select
              value={rule.caseType || "lowercase"}
              onChange={(value) => onUpdate(rule.id, { caseType: value })}
              options={CASE_TYPE_OPTIONS}
              triggerClassName="w-full text-sm py-1.5"
            />
            <div className="flex gap-2 items-center text-xs text-slate-400 border-t border-slate-800/50 pt-1 mt-1">
              <label className="flex items-center gap-1 hover:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rule.useRegex}
                  onChange={(e) =>
                    onUpdate(rule.id, { useRegex: e.target.checked })
                  }
                />
                Regex Match Only
              </label>
            </div>
            {rule.useRegex && (
              <input
                type="text"
                placeholder="Regex pattern to apply case to"
                value={rule.find || ""}
                onChange={(e) => onUpdate(rule.id, { find: e.target.value })}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 font-mono"
              />
            )}
          </>
        )}

        {rule.type === "extension" && (
          <Select
            value={rule.caseType || "lowercase"}
            onChange={(value) => onUpdate(rule.id, { caseType: value })}
            options={EXTENSION_CASE_OPTIONS}
            triggerClassName="w-full text-sm py-1.5"
          />
        )}

        {rule.type === "remove" && (
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-sm text-slate-400">Remove</span>
            <input
              type="number"
              min="1"
              value={rule.removeCount || 0}
              onChange={(e) =>
                onUpdate(rule.id, {
                  removeCount: parseInt(e.target.value) || 0,
                })
              }
              className="w-16 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm text-slate-200"
            />
            <span className="text-sm text-slate-400">chars from</span>
            <Select
              value={rule.removeFrom || "start"}
              onChange={(value) => onUpdate(rule.id, { removeFrom: value })}
              options={REMOVE_FROM_OPTIONS}
              triggerClassName="w-24 text-sm py-1"
            />
          </div>
        )}

        {rule.type === "numbering" && (
          <div className="grid gap-2">
            <div className="flex gap-2 items-center">
              <span className="text-sm text-slate-400 w-12">Start</span>
              <input
                type="number"
                value={rule.numberStart ?? 1}
                onChange={(e) =>
                  onUpdate(rule.id, {
                    numberStart: parseInt(e.target.value) || 0,
                  })
                }
                className="w-20 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm text-slate-200"
              />
            </div>
            <div className="flex gap-2 items-center">
              <span className="text-sm text-slate-400 w-12">Step</span>
              <input
                type="number"
                value={rule.numberStep ?? 1}
                onChange={(e) =>
                  onUpdate(rule.id, {
                    numberStep: parseInt(e.target.value) || 1,
                  })
                }
                className="w-20 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm text-slate-200"
              />
            </div>
            <div className="flex gap-2 items-center">
              <span className="text-sm text-slate-400 w-12">Add to</span>
              <Select
                value={rule.addTo || "suffix"}
                onChange={(value) => onUpdate(rule.id, { addTo: value })}
                options={ADD_TO_OPTIONS}
                triggerClassName="w-32 text-sm py-1"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default function BulkRenameView() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [rules, setRules] = useState<RenameRule[]>([]);
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [activeTab, setActiveTab] = useState<"rename" | "filter">("rename");
  const [isApplying, setIsApplying] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setRules((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [saveMode, setSaveMode] = useState<"rules" | "filters">("rules");
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);

  const filteredFiles = useMemo(
    () => applyFilters(files, filterRules),
    [files, filterRules],
  );

  const visibleFileIds = useMemo(
    () => new Set(filteredFiles.map((f) => f.id)),
    [filteredFiles],
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem("rename_templates");
      if (saved) {
        setTemplates(JSON.parse(saved));
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const saveTemplate = (name: string) => {
    const existingIndex = templates.findIndex((t) => t.name === name);
    const existingTemplate = existingIndex >= 0 ? templates[existingIndex] : undefined;

    const newTemplate: SavedTemplate = {
      id: existingTemplate?.id ?? createId(),
      name,
      createdAt: Date.now(),
      rules: saveMode === "rules" ? rules : [],
      filters: saveMode === "filters" ? filterRules : [],
    };

    let updated;
    if (existingIndex >= 0) {
      updated = [...templates];
      updated[existingIndex] = newTemplate;
    } else {
      updated = [...templates, newTemplate];
    }

    setTemplates(updated);
    localStorage.setItem("rename_templates", JSON.stringify(updated));
    setShowSaveTemplate(false);
  };

  const loadTemplate = (t: SavedTemplate) => {
    if (t.rules && t.rules.length > 0) {
      const newRules = t.rules.map((r) => ({
        ...r,
        id: createId(),
      }));
      setRules(newRules);
    }

    if (t.filters && t.filters.length > 0) {
      const newFilters = t.filters.map((f) => ({
        ...f,
        id: createId(),
      }));
      setFilterRules(newFilters);
    }
    setShowTemplateMenu(false);
  };

  const deleteTemplate = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = templates.filter((t) => t.id !== id);
    setTemplates(updated);
    localStorage.setItem("rename_templates", JSON.stringify(updated));
  };

  const mergeItems = useCallback(
    (incoming: FileItem[]): void => {
      if (incoming.length === 0) return;
      setFiles((prev) => {
        const existing = new Set<string>();
        for (let i = 0; i < prev.length; i += 1) {
          existing.add(prev[i]?.path ?? "");
        }
        const merged = [...prev];
        for (let i = 0; i < incoming.length; i += 1) {
          const item = incoming[i];
          if (!item || existing.has(item.path)) continue;
          existing.add(item.path);
          merged.push(item);
        }
        return applyRulesToItems(merged, rules);
      });
    },
    [rules],
  );

  const loadContextItems = useCallback(
    async (paths: string[], recursive: boolean = false): Promise<void> => {
      try {
        const items = await invoke<RenameContextItem[]>(
          "collect_rename_items",
          {
            paths,
            recursive,
          },
        );
        mergeItems(
          items.map((item) =>
            buildFileItem(item.path, item.name, item.isDirectory),
          ),
        );
      } catch (error) {
        console.error(error);
      }
    },
    [mergeItems],
  );

  useEffect(() => {
    const paths = parseContextPaths();
    if (paths.length > 0) {
      void loadContextItems(paths);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const processFilesToAdd = (
    paths: string[],
    areDirectories: boolean = false,
  ): void => {
    const newFiles: FileItem[] = paths.map((path) =>
      buildFileItem(path, getPathName(path), areDirectories),
    );

    const existing = new Set(files.map((f) => f.path));
    const merged = [...files, ...newFiles.filter((f) => !existing.has(f.path))];
    setFiles(
      merged.map((f, idx) => ({
        ...f,
        newName: applyRules(f.originalName, rules, idx, f.isDirectory),
      })),
    );
  };

  const handleAddFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        directory: false,
      });
      if (selected) {
        processFilesToAdd(
          Array.isArray(selected) ? selected : [selected],
          false,
        );
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleAddFolders = async () => {
    try {
      const selected = await open({
        multiple: true,
        directory: true,
      });
      if (selected) {
        processFilesToAdd(
          Array.isArray(selected) ? selected : [selected],
          true,
        );
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleImportFolder = async () => {
    try {
      const selected = await open({
        multiple: true,
        directory: true,
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        await loadContextItems(paths, true);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleClearFiles = () => setFiles([]);

  const addFilterRule = (type: FilterRuleType) => {
    const id = createId();
    const newRule: FilterRule = {
      id,
      type,
      active: true,
      text: "",
      useRegex: false,
      matchCase: false,
    };
    setFilterRules((prev) => [...prev, newRule]);
  };

  const updateFilterRule = (id: string, updates: Partial<FilterRule>) => {
    setFilterRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    );
  };

  const removeFilterRule = (id: string) => {
    setFilterRules((prev) => prev.filter((r) => r.id !== id));
  };

  const addRule = (type: RenameRuleType) => {
    const id = createId();
    const newRule: RenameRule = {
      id,
      type,
      active: true,
      matchAll: true,
      addTo: "suffix",
      removeFrom: "start",
      caseType: "lowercase",
      numberStart: 1,
      numberStep: 1,
      targetType: "both",
    };
    setRules((prev) => {
      const updated = [...prev, newRule];
      setFiles(
        files.map((f, idx) => ({
          ...f,
          newName: applyRules(f.originalName, updated, idx, f.isDirectory),
        })),
      );
      return updated;
    });
  };

  const updateRule = (id: string, updates: Partial<RenameRule>) => {
    setRules((prev) => {
      return prev.map((r) => (r.id === id ? { ...r, ...updates } : r));
    });
  };

  const removeRule = (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  useEffect(() => {
    setFiles((prev) =>
      prev.map((f, idx) => {
        return {
          ...f,
          newName: applyRules(f.originalName, rules, idx, f.isDirectory),
          status: f.status === "success" ? "success" : "pending",
        };
      }),
    );
  }, [rules]);

  const handleApply = async () => {
    setIsApplying(true);
    try {
      const itemsToRename: BatchRenameItem[] = filteredFiles
        .map((f) => ({
          path: f.path,
          new_path:
            (f.directory
              ? f.directory + (f.directory.endsWith(SEP) ? "" : SEP)
              : "") + f.newName,
        }))
        .filter((f) => f.path !== f.new_path);

      if (itemsToRename.length === 0) {
        alert("No changes to apply.");
        setIsApplying(false);
        return;
      }

      const result = await invoke<BatchRenameResult>("batch_rename", {
        items: itemsToRename,
      });

      if (result.errors && result.errors.length > 0) {
        alert("Some errors occurred:\n" + result.errors.join("\n"));
      }

      setFiles((prev) =>
        prev.map((f) => {
          const newItem = itemsToRename.find((i) => i.path === f.path);
          if (newItem) {
            return {
              ...f,
              path: newItem.new_path,
              directory: getPathDirectory(newItem.new_path),
              originalName: f.newName,
              status: "success",
            };
          }
          return f;
        }),
      );
    } catch (error) {
      console.error(error);
      alert("Failed to execute rename: " + String(error));
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="flex h-full text-slate-200">
      <InputModal
        isOpen={showSaveTemplate}
        onCancel={() => setShowSaveTemplate(false)}
        title={
          saveMode === "rules" ? "Save Rules Template" : "Save Filter Template"
        }
        label="Enter a name for this template"
        defaultValue="My Template"
        onSubmit={saveTemplate}
      />

      <div className="flex-1 flex flex-col border-r border-slate-800 min-w-0">
        <div className="h-12 border-b border-slate-800 flex items-center px-4 gap-2 bg-slate-900/50">
          <span className="font-semibold text-slate-100 hidden md:inline">
            Files ({filteredFiles.length}
            {files.length !== filteredFiles.length ? ` / ${files.length}` : ""})
          </span>
          <div className="flex-1" />

          <div className="flex bg-slate-800 rounded p-0.5">
            <button
              onClick={handleAddFiles}
              className="flex items-center gap-1.5 px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs font-semibold transition-colors"
              title="Add specific files"
            >
              <FileIcon className="w-3.5 h-3.5" />
              Add Files
            </button>
            <div className="w-px bg-slate-900 mx-0.5" />
            <button
              onClick={handleAddFolders}
              className="flex items-center gap-1.5 px-3 py-1 hover:bg-slate-600 rounded text-xs font-semibold transition-colors"
              title="Add folder (as item to rename)"
            >
              <Folder className="w-3.5 h-3.5" />
              Folder
            </button>
            <div className="w-px bg-slate-900 mx-0.5" />
            <button
              onClick={handleImportFolder}
              className="flex items-center gap-1.5 px-3 py-1 hover:bg-slate-600 rounded text-xs font-semibold transition-colors"
              title="Import all files in folder"
            >
              <FolderInput className="w-3.5 h-3.5" />
              Import
            </button>
          </div>

          <button
            onClick={handleClearFiles}
            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition-colors"
            title="Clear All"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {files.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4 border-2 border-dashed border-slate-800 rounded-xl bg-slate-900/20">
              <FileText className="w-12 h-12 opacity-20" />
              <p>Drag files here or use toolbar</p>
            </div>
          ) : (
            <div className="grid gap-1">
              <div className="grid grid-cols-[1fr_20px_1fr] md:grid-cols-[1.5fr_20px_1.5fr] gap-2 px-2 py-1 text-xs font-medium text-slate-500 uppercase tracking-wider">
                <div>Original Name</div>
                <div></div>
                <div>New Name</div>
              </div>
              {files.map((file, idx) => {
                const isVisible = visibleFileIds.has(file.id);
                return (
                  <div
                    key={file.id + idx}
                    className={cn(
                      "grid grid-cols-[1fr_20px_1fr] md:grid-cols-[1.5fr_20px_1.5fr] gap-2 items-center px-3 py-2 rounded border transition-colors",
                      !isVisible && "opacity-30 grayscale",
                      file.status === "success"
                        ? "bg-green-900/10 border-green-900/30"
                        : file.status === "error"
                          ? "bg-red-900/10 border-red-900/30"
                          : "bg-slate-900/40 border-slate-800/50 hover:bg-slate-800/60",
                    )}
                  >
                    <div
                      className="truncate text-sm text-slate-400 flex items-center gap-2"
                      title={file.path}
                    >
                      {file.isDirectory ? (
                        <Folder className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                      ) : (
                        <FileIcon className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                      )}
                      {file.originalName}
                    </div>
                    <div className="flex justify-center text-slate-600">
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                    <div
                      className={cn(
                        "truncate text-sm flex items-center gap-2",
                        file.originalName !== file.newName
                          ? "text-blue-300 font-medium"
                          : "text-slate-500",
                      )}
                      title={file.newName}
                    >
                      {file.newName}
                      {file.status === "success" && (
                        <Check className="w-3.5 h-3.5 text-green-500" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="w-80 flex flex-col bg-slate-950 border-l border-slate-800/50">
        <div className="h-12 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900/50 gap-2">
          <div className="flex bg-slate-800 p-0.5 rounded-lg flex-1">
            <button
              onClick={() => setActiveTab("rename")}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 text-xs font-semibold py-1 rounded transition-all",
                activeTab === "rename"
                  ? "bg-slate-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200",
              )}
            >
              <FileIcon className="w-3 h-3" />
              Rules
            </button>
            <button
              onClick={() => setActiveTab("filter")}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 text-xs font-semibold py-1 rounded transition-all",
                activeTab === "filter"
                  ? "bg-slate-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200",
              )}
            >
              <Filter className="w-3 h-3" />
              Filter
              {filterRules.filter((f) => f.active).length > 0 && (
                <span className="bg-sky-500 text-white text-[9px] px-1 rounded-full">
                  {filterRules.filter((f) => f.active).length}
                </span>
              )}
            </button>
          </div>

          <div className="relative">
            <button
              onClick={() => setShowTemplateMenu(!showTemplateMenu)}
              className="flex items-center justify-center w-8 h-8 rounded hover:bg-slate-800 text-sky-400 transition-colors"
              title="Templates"
            >
              <ListFilter className="w-4 h-4" />
            </button>

            {showTemplateMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowTemplateMenu(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-72 bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-50 flex flex-col overflow-hidden">
                  {activeTab === "rename" && (
                    <button
                      onClick={() => {
                        setSaveMode("rules");
                        setShowSaveTemplate(true);
                      }}
                      className="text-left px-3 py-2 text-xs hover:bg-slate-800 flex items-center gap-2 border-b border-slate-800"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Save Current Rules
                    </button>
                  )}
                  {activeTab === "filter" && (
                    <button
                      onClick={() => {
                        setSaveMode("filters");
                        setShowSaveTemplate(true);
                      }}
                      className="text-left px-3 py-2 text-xs hover:bg-slate-800 flex items-center gap-2 border-b border-slate-800"
                    >
                      <Filter className="w-3.5 h-3.5" />
                      Save Current Filters
                    </button>
                  )}
                  <div className="max-h-60 overflow-y-auto">
                    {templates.filter((t) =>
                      activeTab === "rename"
                        ? t.rules && t.rules.length > 0
                        : t.filters && t.filters.length > 0,
                    ).length === 0 && (
                      <div className="px-3 py-2 text-xs text-slate-500 italic">
                        No saved templates
                      </div>
                    )}
                    {templates
                      .filter((t) =>
                        activeTab === "rename"
                          ? t.rules && t.rules.length > 0
                          : t.filters && t.filters.length > 0,
                      )
                      .map((t) => (
                        <div
                          key={t.id}
                          className="flex items-center justify-between hover:bg-slate-800 group"
                        >
                          <button
                            onClick={() => loadTemplate(t)}
                            className="flex-1 text-left px-3 py-2 text-xs flex items-center group-hover:text-emerald-400 min-w-0"
                          >
                            <span className="truncate" title={t.name}>
                              {t.name}
                            </span>
                          </button>
                          <button
                            onClick={(e) => deleteTemplate(t.id, e)}
                            className="p-2 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {activeTab === "rename" && (
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={rules}
                strategy={verticalListSortingStrategy}
              >
                {rules.map((rule) => (
                  <RuleItem
                    key={rule.id}
                    rule={rule}
                    onUpdate={updateRule}
                    onRemove={removeRule}
                  />
                ))}
              </SortableContext>
            </DndContext>

            <div className="pt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => addRule("replace")}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors"
              >
                Replace
              </button>
              <button
                onClick={() => addRule("case")}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors"
              >
                Case
              </button>
              <button
                onClick={() => addRule("prefix")}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors"
              >
                Add Prefix
              </button>
              <button
                onClick={() => addRule("suffix")}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors"
              >
                Add Suffix
              </button>
              <button
                onClick={() => addRule("numbering")}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors"
              >
                Numbering
              </button>
              <button
                onClick={() => addRule("remove")}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors"
              >
                Remove
              </button>
              <button
                onClick={() => addRule("extension")}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors"
              >
                Extension
              </button>
            </div>
          </div>
        )}

        {activeTab === "filter" && (
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {filterRules.length === 0 && (
              <div className="text-center py-6 text-slate-500 text-xs px-4">
                <Filter className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p>
                  Add filters to exclude specific files/folders from processing.
                </p>
              </div>
            )}
            {filterRules.map((rule) => (
              <FilterRuleItem
                key={rule.id}
                rule={rule}
                onUpdate={updateFilterRule}
                onRemove={removeFilterRule}
              />
            ))}

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                onClick={() => addFilterRule("include")}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors hover:border-emerald-500/30"
              >
                + Include
              </button>
              <button
                onClick={() => addFilterRule("exclude")}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors hover:border-rose-500/30"
              >
                + Exclude
              </button>
            </div>
          </div>
        )}

        <div className="p-4 border-t border-slate-800 bg-slate-900/30">
          <button
            onClick={handleApply}
            disabled={filteredFiles.length === 0 || isApplying}
            className="w-full h-10 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 rounded font-semibold text-sm text-white shadow-lg shadow-emerald-900/20 transition-all flex items-center justify-center gap-2"
          >
            {isApplying ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
            Rename{" "}
            {filteredFiles.length > 0 ? `${filteredFiles.length} Item(s)` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
