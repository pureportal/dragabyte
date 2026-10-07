import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTreeItems } from "../src/features/scan/treeData.ts";
import type { ScanFile, ScanNode } from "../src/features/scan/types.ts";

const file = (path: string, sizeBytes: number): ScanFile => ({ path, name: path.split("/").at(-1)!, sizeBytes });
const folder = (path: string, sizeBytes: number, files: ScanFile[] = [], children: ScanNode[] = []): ScanNode => ({
  id: 0, parentId: null, path, name: path.split("/").at(-1)!, sizeBytes,
  fileCount: files.length, dirCount: children.length, files, children,
  state: "complete", readState: "complete", skippedEntries: 0,
});

const fixture = (): ScanNode => folder("/root", 1000, [
  file("/root/largest", 300), file("/root/big-tie", 200), file("/root/middle", 150),
  file("/root/equal-first", 100), file("/root/equal-second", 100),
  file("/root/small-tie", 50), file("/root/zero", 0),
], [
  folder("/root/small", 50, [file("/root/small/file", 40)]),
  folder("/root/big", 200, [file("/root/big/file", 190)], [
    folder("/root/big/nested", 10, [file("/root/big/nested/file", 5)]),
  ]),
  folder("/root/equal", 100, [file("/root/equal/file", 100)]),
  { ...folder("/root/pending", 0), state: "incomplete", readState: "incomplete" },
  folder("/root/empty", 0),
]);

test("indexed tree rows preserve mixed ordering, ties, depths, and ranges across folders", () => {
  const root = fixture();
  const expanded = new Set([root.path, ...root.children.map((child) => child.path), "/root/big/nested"]);
  const rows = buildTreeItems(root, expanded, true, false);
  const expected = [
    ["/root", 0], ["/root/largest", 1], ["/root/big", 1], ["/root/big/file", 2],
    ["/root/big/nested", 2], ["/root/big/nested/file", 3], ["/root/big-tie", 1],
    ["/root/middle", 1], ["/root/equal", 1], ["/root/equal/file", 2],
    ["/root/equal-first", 1], ["/root/equal-second", 1], ["/root/small", 1],
    ["/root/small/file", 2], ["/root/small-tie", 1], ["/root/pending", 1],
    ["/root/empty", 1], ["/root/zero", 1],
  ];
  assert.equal(rows.length, expected.length);
  assert.deepEqual(rows.slice().map((row) => [row.path, row.depth]), expected);
  for (let index = 0; index < rows.length; index += 1) {
    assert.deepEqual([rows.at(index)!.path, rows.at(index)!.depth], expected[index]);
    assert.equal(rows.at(index - rows.length)!.path, expected[index]![0]);
    for (let end = index; end <= rows.length; end += 1) {
      assert.deepEqual(rows.slice(index, end).map((row) => [row.path, row.depth]), expected.slice(index, end));
    }
  }
  assert.deepEqual(rows.slice(-3).map((row) => row.path), ["/root/pending", "/root/empty", "/root/zero"]);
  assert.deepEqual(rows.slice(2, -2).map((row) => row.path), expected.slice(2, -2).map(([path]) => path));
  assert.equal(rows.at(rows.length), undefined);
  assert.equal(rows.at(-rows.length - 1), undefined);
  assert.deepEqual(rows.slice(rows.length), []);
  assert.deepEqual(rows.slice(3, 2), []);
  assert.deepEqual([...rows.maxSizeByDepth], [[0, 1000], [1, 300], [2, 190], [3, 5]]);
  assert.equal(rows.at(1)!.file, root.files[0]);
  assert.equal(rows.at(3)!.parentPath, "/root/big");
});

test("indexed tree rows preserve collapse, file visibility, and empty-folder filtering", () => {
  const root = fixture();
  assert.deepEqual(buildTreeItems(root, new Set(), true, false).slice().map((row) => row.path), ["/root"]);
  const expanded = new Set(["/root"]);
  const rows = buildTreeItems(root, expanded, false, true);
  assert.deepEqual(rows.slice().map((row) => row.path), ["/root", "/root/big", "/root/equal", "/root/small", "/root/pending"]);
  assert.equal(rows.at(-1)!.hasChildren, false);
  assert.equal(rows.at(1)!.hasChildren, true);
  const withFiles = buildTreeItems(root, expanded, true, true);
  assert.equal(withFiles.at(-1)!.path, "/root/zero");
  assert.equal(withFiles.slice().some((row) => row.path === "/root/empty"), false);
  assert.deepEqual([...rows.maxSizeByDepth], [[0, 1000], [1, 200]]);
  const empty = buildTreeItems(null, expanded, true, true);
  assert.equal(empty.length, 0);
  assert.equal(empty.at(0), undefined);
  assert.deepEqual(empty.slice(), []);
});

test("indexed tree rows read only the requested files and remain bound to their snapshot", () => {
  let reads = 0;
  const files = Array.from({ length: 10000 }, (_, index) => ({
    name: `file-${index}`,
    get path() { reads += 1; return `/root/file-${index}`; },
    get sizeBytes() { reads += 1; return 10000 - index; },
  }));
  const root = folder("/root", 100000, files);
  const rows = buildTreeItems(root, new Set([root.path]), true, false);
  assert.equal(rows.length, 10001);
  assert.ok(reads < 10);
  assert.equal(rows.at(-1)!.path, "/root/file-9999");
  assert.deepEqual(rows.slice(9997, 10001).map((row) => row.path), [
    "/root/file-9996", "/root/file-9997", "/root/file-9998", "/root/file-9999",
  ]);
  assert.ok(reads < 20);
  const changed = buildTreeItems({ ...root, files: [file("/root/replacement", 1)] }, new Set([root.path]), true, false);
  assert.equal(changed.at(-1)!.path, "/root/replacement");
  assert.equal(rows.at(-1)!.path, "/root/file-9999");
});
