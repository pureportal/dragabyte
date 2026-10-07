import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyRenameOutcomes,
  buildFileItem,
  destinationPath,
  isFileEnabled,
  previewFiles,
  sortFiles,
} from "../src/features/bulk-rename/fileModel.ts";
import {
  emptySelection,
  selectRow,
} from "../src/features/bulk-rename/rowSelection.ts";
import type {
  FilterRule,
  RenameRule,
} from "../src/features/bulk-rename/types.ts";

const file = (name: string) =>
  buildFileItem({
    path: `/root/${name}`,
    name,
    isDirectory: false,
    size: 10,
    depth: 1,
    relativePath: name,
  });
const exclude: FilterRule = {
  id: "filter",
  type: "exclude",
  text: "skip",
  active: true,
  useRegex: false,
  matchCase: false,
};
const numbering: RenameRule = {
  id: "rule",
  type: "numbering",
  active: true,
  numberStart: 1,
  numberStep: 1,
  addTo: "prefix",
};

test("partial success keeps numbering stable for failed rows on retry", () => {
  const files = [file("first.txt"), file("second.txt")];
  const updated = applyRenameOutcomes(files, [
    { path: files[0]!.path, newPath: "/root/1-first.txt", error: null },
    { path: files[1]!.path, newPath: "/root/2-second.txt", error: "Collision" },
  ]);
  assert.deepEqual(
    previewFiles(updated, [numbering], []).map((item) => item.newName),
    ["1-first.txt", "2-second.txt"],
  );
});

test("clicks preserve selection and shift ranges can shrink while retaining earlier selections", () => {
  const ids = ["a", "b", "c", "d", "e"];
  let state = selectRow(emptySelection(), ids, "e", false);
  state = selectRow(state, ids, "a", false);
  state = selectRow(state, ids, "d", true);
  assert.deepEqual([...state.selected].sort(), ids);
  state = selectRow(state, ids, "b", true);
  assert.deepEqual([...state.selected].sort(), ["a", "b", "e"]);
  state = selectRow(state, ids, "e", false, true);
  assert.deepEqual([...state.selected].sort(), ["a", "b"]);
});

test("manual modes override filters and only enabled rows consume numbering", () => {
  const files = [file("first.txt"), file("skip.txt"), file("last.txt")];
  assert.equal(isFileEnabled(files[1]!, [exclude]), false);
  assert.equal(
    isFileEnabled({ ...files[1]!, renameMode: "enabled" }, [exclude]),
    true,
  );
  assert.equal(
    isFileEnabled({ ...files[0]!, renameMode: "disabled" }, []),
    false,
  );
  assert.deepEqual(
    previewFiles(files, [numbering], [exclude]).map((item) => item.newName),
    ["1-first.txt", "skip.txt", "2-last.txt"],
  );
});

test("natural sorting determines numbering and does not mutate source order", () => {
  const files = [file("photo10.jpg"), file("photo2.jpg"), file("photo1.jpg")];
  const sorted = sortFiles(files, "originalName", false);
  assert.deepEqual(
    previewFiles(sorted, [numbering], []).map((item) => item.newName),
    ["1-photo1.jpg", "2-photo2.jpg", "3-photo10.jpg"],
  );
  assert.equal(files[0]!.originalName, "photo10.jpg");
  assert.equal(
    sortFiles(files, "originalName", true)[0]!.originalName,
    "photo10.jpg",
  );
});

test("outcomes preserve identity, keep failures retryable and relocate disabled descendants", () => {
  const parent = { ...file("folder"), isDirectory: true };
  const child = {
    ...file("child.txt"),
    path: "/root/folder/child.txt",
    directory: "/root/folder",
    renameMode: "disabled" as const,
  };
  const failed = file("failed.txt");
  const updated = applyRenameOutcomes(
    [parent, child, failed],
    [
      { path: parent.path, newPath: "/root/renamed", error: null },
      { path: failed.path, newPath: "/root/new.txt", error: "Collision" },
    ],
  );
  assert.equal(updated[0]!.id, parent.id);
  assert.equal(updated[1]!.path, "/root/renamed/child.txt");
  assert.equal(updated[1]!.renameMode, "disabled");
  assert.equal(updated[2]!.path, failed.path);
  assert.equal(updated[2]!.status, "error");
  assert.equal(updated[2]!.error, "Collision");
  assert.equal(applyRenameOutcomes(updated, [{ path: "/root/renamed", newPath: "/root/again", error: null }])[2]!.error, "Collision");
  assert.equal(previewFiles(updated, [numbering], [])[0]!.newName, "renamed");
});

test("destinations preserve root separators on Windows and POSIX", () => {
  assert.equal(
    destinationPath({ ...file("a.txt"), directory: "C:\\", newName: "b.txt" }),
    "C:\\b.txt",
  );
  assert.equal(
    destinationPath({ ...file("a.txt"), directory: "/", newName: "b.txt" }),
    "/b.txt",
  );
});
