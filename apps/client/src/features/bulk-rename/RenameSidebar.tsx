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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  File as FileIcon,
  Filter,
  ListFilter,
  Play,
  Save,
  Trash2,
} from "lucide-react";
import { useState, type Dispatch, type SetStateAction } from "react";
import { InputModal } from "../../components/InputModal";
import { cn } from "../../lib/utils";
import { FilterRuleItem, RuleItem } from "./RenameRuleEditor";
import type {
  FilterRule,
  FilterRuleType,
  RenameRule,
  RenameRuleType,
  SavedTemplate,
} from "./types";

const createId = (): string => crypto.randomUUID();

export function RenameSidebar({
  rules,
  filterRules,
  updateRules,
  setFilterRules,
  isApplying,
  isLoading,
  changeCount,
  onApply,
}: {
  rules: RenameRule[];
  filterRules: FilterRule[];
  updateRules: (rules: RenameRule[]) => void;
  setFilterRules: Dispatch<SetStateAction<FilterRule[]>>;
  isApplying: boolean;
  isLoading: boolean;
  changeCount: number;
  onApply: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"rename" | "filter">("rename");
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = rules.findIndex((item) => item.id === active.id);
      const newIndex = rules.findIndex((item) => item.id === over.id);
      updateRules(arrayMove(rules, oldIndex, newIndex));
    }
  };

  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [saveMode, setSaveMode] = useState<"rules" | "filters">("rules");
  const [templates, setTemplates] = useState<SavedTemplate[]>(() => {
    try {
      const saved = localStorage.getItem("rename_templates");
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error(error);
      return [];
    }
  });
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);

  const saveTemplate = (name: string) => {
    const existingIndex = templates.findIndex((t) => t.name === name);
    const existingTemplate =
      existingIndex >= 0 ? templates[existingIndex] : undefined;

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
      updateRules(newRules);
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
    updateRules([...rules, newRule]);
  };

  const updateRule = (id: string, updates: Partial<RenameRule>) => {
    updateRules(
      rules.map((rule) => (rule.id === id ? { ...rule, ...updates } : rule)),
    );
  };

  const removeRule = (id: string) => {
    updateRules(rules.filter((rule) => rule.id !== id));
  };

  return (
    <>
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
      <div
        inert={isApplying}
        className="w-full lg:w-80 max-h-[45%] lg:max-h-none shrink-0 flex flex-col bg-slate-950 border-l border-slate-800/50"
      >
        <div className="h-12 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900/50 gap-2">
          <div className="flex bg-slate-800 p-0.5 rounded-lg flex-1">
            <button
              onClick={() => setActiveTab("rename")}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 text-xs font-semibold py-1 rounded-sm transition-all",
                activeTab === "rename"
                  ? "bg-slate-600 text-white shadow-xs"
                  : "text-slate-400 hover:text-slate-200",
              )}
            >
              <FileIcon className="w-3 h-3" />
              Rules
            </button>
            <button
              onClick={() => setActiveTab("filter")}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 text-xs font-semibold py-1 rounded-sm transition-all",
                activeTab === "filter"
                  ? "bg-slate-600 text-white shadow-xs"
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
              className="flex items-center justify-center w-8 h-8 rounded-sm hover:bg-slate-800 text-sky-400 transition-colors"
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
                            className="p-2 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
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
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-sm text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors"
              >
                Replace
              </button>
              <button
                onClick={() => addRule("case")}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-sm text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors"
              >
                Case
              </button>
              <button
                onClick={() => addRule("prefix")}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-sm text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors"
              >
                Add Prefix
              </button>
              <button
                onClick={() => addRule("suffix")}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-sm text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors"
              >
                Add Suffix
              </button>
              <button
                onClick={() => addRule("numbering")}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-sm text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors"
              >
                Numbering
              </button>
              <button
                onClick={() => addRule("remove")}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-sm text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors"
              >
                Remove characters
              </button>
              <button
                onClick={() => addRule("extension")}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-sm text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors"
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
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-sm text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors hover:border-emerald-500/30"
              >
                + Include
              </button>
              <button
                onClick={() => addFilterRule("exclude")}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-sm text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors hover:border-rose-500/30"
              >
                + Exclude
              </button>
            </div>
          </div>
        )}

        <div className="p-4 border-t border-slate-800 bg-slate-900/30">
          <button
            onClick={onApply}
            disabled={changeCount === 0 || isApplying || isLoading}
            className="w-full h-10 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 rounded-sm font-semibold text-sm text-white shadow-lg shadow-emerald-900/20 transition-all flex items-center justify-center gap-2"
          >
            {isApplying ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
            Rename{" "}
            {changeCount > 0
              ? `${changeCount} ${changeCount === 1 ? "item" : "items"}`
              : ""}
          </button>
        </div>
      </div>
    </>
  );
}
