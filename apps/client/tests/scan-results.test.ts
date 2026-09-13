import assert from "node:assert/strict";
import { test } from "node:test";
import { ScanResults, ScanUpdateQueue } from "../src/features/scan/scanResults.ts";
import { buildTreeItems, isEmptyFolder } from "../src/features/scan/treeData.ts";
import type { ScanNode, ScanUpdate } from "../src/features/scan/types.ts";

const folder = (id: number, parentId: number | null, state: ScanNode["state"] = "scanning"): ScanUpdate["folders"][number] => ({
  id, parentId, path: `/folder${id}`, name: `folder${id}`, sizeBytes: 0, fileCount: 0, dirCount: 0, state, readState: state, skippedEntries: 0,
});
const update = (sequence: number, folders: ScanUpdate["folders"] = [], files: ScanUpdate["files"] = []): ScanUpdate => ({
  id: "test", sequence, folders, files, totalBytes: 0, fileCount: 0, dirCount: 0, skippedEntries: 0, largestFiles: [], durationMs: sequence * 100,
});

test("retains discovered files and rebuilds changed ancestors without mutating earlier results", () => {
  const results = new ScanResults("test");
  const initial = results.apply([update(0, [folder(0, null), folder(1, 0), folder(2, 1)])]);
  const partial = results.apply([update(1, [], [{ parentId: 2, file: { name: "file", path: "/folder2/file", sizeBytes: 25 } }])]);
  assert.equal(initial.root.children[0]!.children[0]!.files.length, 0);
  assert.equal(partial.root.children[0]!.children[0]!.files.length, 1);
  const final = results.apply([update(2, [folder(2, 1, "complete")])]);
  assert.equal(final.root.children[0]!.children[0]!.state, "complete");
  assert.equal(partial.root.children[0]!.children[0]!.state, "scanning");
  assert.equal(final.root.children[0]!.children[0]!.files[0]!.sizeBytes, 25);
});

test("coalesces discovery, sizes, and completion while retaining all files", () => {
  const results = new ScanResults("test");
  const additions = Array.from({ length: 2048 }, (_, index) => ({ parentId: 1, file: { name: `${index}`, path: `/folder1/${index}`, sizeBytes: index } }));
  const bytes = 2048 * 2047 / 2;
  const final = results.apply([
    update(0, [folder(0, null), folder(1, 0)]),
    update(1, [], additions.slice(0, 1024)),
    { ...update(2, [{ ...folder(0, null, "complete"), sizeBytes: bytes, fileCount: 2048 }, { ...folder(1, 0, "complete"), sizeBytes: bytes, fileCount: 2048 }], additions.slice(1024)), totalBytes: bytes, fileCount: 2048 },
  ]);
  assert.equal(final.root.children[0]!.files.length, 2048);
  assert.equal(final.root.children[0]!.files.reduce((sum, file) => sum + file.sizeBytes, 0), final.totalBytes);
  assert.equal(final.root.children[0]!.files[0]!.sizeBytes, 2047);
  assert.equal(final.root.children[0]!.files.at(-1)!.sizeBytes, 0);
  assert.equal(final.root.sizeBytes, final.totalBytes);
  assert.equal(final.root.state, "complete");
});

test("pending and incomplete folders remain visible when empty folders are hidden", () => {
  const results = new ScanResults("test");
  const summary = results.apply([update(0, [folder(0, null), folder(1, 0), folder(2, 0, "complete"), folder(3, 0, "incomplete")])]);
  assert.equal(isEmptyFolder(summary.root.children[0]!), false);
  assert.deepEqual(buildTreeItems(summary.root, new Set(["/folder0"]), true, true).map((node) => node.path), ["/folder0", "/folder1", "/folder3"]);
  assert.equal(buildTreeItems(summary.root, new Set(["/folder0"]), true, true)[1]!.hasChildren, true);
});

test("deep updates and expansion do not require recursion", () => {
  const results = new ScanResults("test");
  const folders = Array.from({ length: 5000 }, (_, index) => folder(index, index === 0 ? null : index - 1));
  results.apply([update(0, folders)]);
  const summary = results.apply([update(1, [folder(4999, 4998, "complete")])]);
  const rows = buildTreeItems(summary.root, new Set(folders.map((entry) => entry.path)), true, false);
  assert.equal(rows.length, 5000);
  assert.equal(rows.at(-1)!.node!.state, "complete");
});

test("rejects missing, duplicate, and foreign updates", () => {
  const results = new ScanResults("test");
  results.apply([update(0, [folder(0, null)])]);
  assert.throws(() => results.apply([update(2)]), /out of order/);
  assert.throws(() => results.apply([update(0)]), /out of order/);
  assert.throws(() => results.apply([{ ...update(1), id: "other" }]), /out of order/);
});

test("queued completion follows all progress, yields between batches, and ignores late events", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const published: string[] = [];
  const queue = new ScanUpdateQueue("test", (summary, kind) => published.push(`${kind}:${summary.durationMs}`), (message) => assert.fail(message));
  queue.push(update(0, [folder(0, null)]), "progress");
  for (let index = 1; index < 8; index += 1) queue.push(update(index), "progress");
  queue.push(update(8, [folder(0, null, "complete")]), "complete");
  queue.push(update(9), "progress");
  context.mock.timers.tick(16);
  assert.deepEqual(published, ["progress:300"]);
  context.mock.timers.tick(16);
  context.mock.timers.tick(16);
  assert.deepEqual(published, ["progress:300", "complete:800"]);
});

test("disposing a scan discards pending callbacks during restart", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const queue = new ScanUpdateQueue("test", () => assert.fail("stale scan published"), (message) => assert.fail(message));
  queue.push(update(0, [folder(0, null)]), "progress");
  queue.dispose();
  context.mock.timers.tick(100);
});
