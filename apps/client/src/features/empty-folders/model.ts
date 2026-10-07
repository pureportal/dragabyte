import type {
  EmptyFolder,
  EmptyFolderOptions,
  EmptyFolderSettings,
  RemovalOutcome,
} from "./types.ts";

export const defaultSettings: EmptyFolderSettings = {
  minDepth: "1",
  maxDepth: "",
  includeHidden: false,
  emptyAfterRemoval: true,
  includeNames: "",
  excludeNames: "",
  includePaths: "",
  excludePaths: "",
  includeRegex: "",
  excludeRegex: "",
  regexMatchPath: false,
  matchCase: false,
  minAgeDays: "",
  maxAgeDays: "",
};

export function buildOptions(settings: EmptyFolderSettings): {
  options: EmptyFolderOptions | null;
  error: string;
} {
  const minDepth = Number(settings.minDepth);
  const maxDepth = settings.maxDepth.trim() ? Number(settings.maxDepth) : null;
  if (
    !Number.isInteger(minDepth) ||
    minDepth < 1 ||
    minDepth > 1000 ||
    (maxDepth !== null &&
      (!Number.isInteger(maxDepth) || maxDepth < minDepth || maxDepth > 1000))
  ) {
    return {
      options: null,
      error: "Use depths from 1 to 1000, with maximum at least minimum.",
    };
  }
  const minAgeDays = settings.minAgeDays.trim()
    ? Number(settings.minAgeDays)
    : null;
  const maxAgeDays = settings.maxAgeDays.trim()
    ? Number(settings.maxAgeDays)
    : null;
  if (
    [minAgeDays, maxAgeDays].some(
      (value) => value !== null && (!Number.isFinite(value) || value < 0),
    ) ||
    (minAgeDays !== null && maxAgeDays !== null && minAgeDays > maxAgeDays)
  ) {
    return {
      options: null,
      error: "Use nonnegative ages, with maximum at least minimum.",
    };
  }
  const split = (value: string): string[] =>
    value
      .split(/[,;\n]/)
      .map((part) => part.trim())
      .filter(Boolean);
  return {
    options: {
      ...settings,
      minDepth,
      maxDepth,
      minAgeDays,
      maxAgeDays,
      includeNames: split(settings.includeNames),
      excludeNames: split(settings.excludeNames),
      includePaths: split(settings.includePaths).map((path) =>
        path.replaceAll("\\", "/"),
      ),
      excludePaths: split(settings.excludePaths).map((path) =>
        path.replaceAll("\\", "/"),
      ),
    },
    error: "",
  };
}

export function updateSelection(
  folders: EmptyFolder[],
  selected: Set<string>,
  paths: string[],
  checked: boolean,
  outcomes: RemovalOutcome[],
): Set<string> {
  const removed = new Set(
    outcomes
      .filter((outcome) => outcome.error === null)
      .map((outcome) => outcome.path),
  );
  const available = new Map(
    folders
      .filter((folder) => !removed.has(folder.path))
      .map((folder) => [folder.path, folder]),
  );
  const next = new Set([...selected].filter((path) => available.has(path)));
  if (checked) {
    const pending = [...paths];
    while (pending.length) {
      const path = pending.pop();
      if (!path || next.has(path)) continue;
      const folder = available.get(path);
      if (!folder) continue;
      next.add(path);
      pending.push(...folder.children);
    }
  } else {
    const parents = new Map<string, string>();
    for (const folder of available.values()) {
      for (const child of folder.children) parents.set(child, folder.path);
    }
    for (const path of paths) {
      next.delete(path);
      let parent = parents.get(path);
      while (parent) {
        next.delete(parent);
        parent = parents.get(parent);
      }
    }
  }
  return next;
}
