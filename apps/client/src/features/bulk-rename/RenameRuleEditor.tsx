import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, ChevronDown, GripVertical, X } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils";
import type { FilterRule, FilterRuleType, RenameRule } from "./types";
type RenameTargetType = NonNullable<RenameRule["targetType"]>;
type RenameCaseType = NonNullable<RenameRule["caseType"]>;
type RenameRemoveFromType = NonNullable<RenameRule["removeFrom"]>;
type RenameAddToType = NonNullable<RenameRule["addTo"]>;

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
          "flex items-center justify-between gap-2 px-2.5 py-1 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-sm text-xs text-slate-300 transition-colors min-w-[80px]",
          triggerClassName,
        )}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown className="w-3 h-3 opacity-50 shrink-0" />
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
                {value === opt.value && <Check className="w-3 h-3 shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export const FilterRuleItem = ({
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
          <span className="text-xs text-slate-500">matching:</span>
        </div>
        <button
          onClick={() => onUpdate(rule.id, { active: !rule.active })}
          className={cn(
            "text-xs px-2 py-0.5 rounded-sm border transition-colors",
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
          className="bg-slate-950 border border-slate-800 rounded-sm px-2 py-1 text-sm text-slate-200"
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

export const RuleItem = ({
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
          <span className="text-xs font-semibold text-sky-400 bg-sky-950/30 px-2 py-0.5 rounded-sm capitalize">
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
            "text-xs px-2 py-0.5 rounded-sm border transition-colors",
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
              className="bg-slate-950 border border-slate-800 rounded-sm px-2 py-1 text-sm text-slate-200"
            />
            <input
              type="text"
              placeholder="Replace with"
              value={rule.replace || ""}
              onChange={(e) => onUpdate(rule.id, { replace: e.target.value })}
              className="bg-slate-950 border border-slate-800 rounded-sm px-2 py-1 text-sm text-slate-200"
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
            className="bg-slate-950 border border-slate-800 rounded-sm px-2 py-1 text-sm text-slate-200"
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
                className="bg-slate-950 border border-slate-800 rounded-sm px-2 py-1 text-xs text-slate-200 font-mono"
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
              className="w-16 bg-slate-950 border border-slate-800 rounded-sm px-2 py-1 text-sm text-slate-200"
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
                className="w-20 bg-slate-950 border border-slate-800 rounded-sm px-2 py-1 text-sm text-slate-200"
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
                className="w-20 bg-slate-950 border border-slate-800 rounded-sm px-2 py-1 text-sm text-slate-200"
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
