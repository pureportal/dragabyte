import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOptions,
  defaultSettings,
  updateSelection,
} from "../src/features/empty-folders/model.ts";
import type { EmptyFolder } from "../src/features/empty-folders/types.ts";

const folders: EmptyFolder[] = [
  {
    path: "/root/parent",
    source: "/root",
    name: "parent",
    relativePath: "parent",
    depth: 1,
    modified: 1,
    children: ["/root/parent/child"],
  },
  {
    path: "/root/parent/child",
    source: "/root",
    name: "child",
    relativePath: "parent/child",
    depth: 2,
    modified: 1,
    children: ["/root/parent/child/leaf"],
  },
  {
    path: "/root/parent/child/leaf",
    source: "/root",
    name: "leaf",
    relativePath: "parent/child/leaf",
    depth: 3,
    modified: 1,
    children: [],
  },
  {
    path: "/root/other",
    source: "/root",
    name: "other",
    relativePath: "other",
    depth: 1,
    modified: 1,
    children: [],
  },
];

test("deselecting a child deselects all parents while preserving other selections", () => {
  const selected = new Set(folders.map((folder) => folder.path));
  const next = updateSelection(
    folders,
    selected,
    ["/root/parent/child/leaf"],
    false,
    [],
  );
  assert.deepEqual([...next], ["/root/other"]);
  assert.equal(selected.size, 4);
});

test("selecting a parent also selects the children required to make it empty", () => {
  const next = updateSelection(folders, new Set(), ["/root/parent"], true, []);
  assert.deepEqual(
    [...next].sort(),
    folders.slice(0, 3).map((folder) => folder.path),
  );
});

test("removing a parent from selection keeps its children selected", () => {
  const next = updateSelection(
    folders,
    new Set(folders.map((folder) => folder.path)),
    ["/root/parent"],
    false,
    [],
  );
  assert.equal(next.size, 3);
  assert(next.has("/root/parent/child"));
});

test("already removed children are not selected again during retries", () => {
  const next = updateSelection(folders, new Set(), ["/root/parent"], true, [
    { path: "/root/parent/child/leaf", error: null },
  ]);
  assert.deepEqual([...next].sort(), ["/root/parent", "/root/parent/child"]);
});

test("filter options parse lists, Windows separators and age boundaries", () => {
  const result = buildOptions({
    ...defaultSettings,
    includeNames: " Cache, Temp;\n",
    excludePaths: "parent\\keep",
    minAgeDays: "0",
    maxAgeDays: "1.5",
    minDepth: "2",
    maxDepth: "3",
  });
  assert.equal(result.error, "");
  assert.deepEqual(result.options?.includeNames, ["Cache", "Temp"]);
  assert.deepEqual(result.options?.excludePaths, ["parent/keep"]);
  assert.equal(result.options?.minAgeDays, 0);
  assert.equal(result.options?.maxAgeDays, 1.5);
  assert.equal(result.options?.maxDepth, 3);
});

test("invalid depths and ages cannot produce executable options", () => {
  for (const settings of [
    { minDepth: "" },
    { minDepth: "1.5" },
    { maxDepth: "0" },
    { maxDepth: "1001" },
    { minDepth: "3", maxDepth: "2" },
    { minAgeDays: "NaN" },
    { maxAgeDays: "-1" },
    { minAgeDays: "3", maxAgeDays: "2" },
  ])
    assert.equal(
      buildOptions({ ...defaultSettings, ...settings }).options,
      null,
    );
  assert.equal(buildOptions(defaultSettings).options?.maxDepth, null);
});
