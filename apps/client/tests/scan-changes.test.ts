import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { LocalScan } from "../src/features/scan/localScan.ts";
import { containsPath, parentPath, pathKey } from "../src/features/scan/scanPaths.ts";
import { buildNodeMap, buildTreeItems } from "../src/features/scan/treeData.ts";
import type { ScanHandlers, ScanNode, ScanOptions, ScanSummary, ScanUpdate } from "../src/features/scan/types.ts";

const folder = (id: number, parentId: number | null, path: string, state: ScanNode["state"] = "complete"): ScanUpdate["folders"][number] => ({
  id, parentId, path, name: path.split("/").at(-1)!, state, readState: state, skippedEntries: 0,
  sizeBytes: 0, fileCount: 0, dirCount: 0,
});
const file = (parentId: number, path: string, sizeBytes: number): ScanUpdate["files"][number] => ({
  parentId, file: { path, name: path.split("/").at(-1)!, sizeBytes, modified: 1000 },
});
const options: ScanOptions = {
  priorityMode: "balanced", throttleLevel: "off",
  filters: {
    includeExtensions: [], excludeExtensions: [], includeNames: [], excludeNames: [], includePaths: [], excludePaths: [],
    includeRegex: null, excludeRegex: null, minSizeBytes: null, maxSizeBytes: null, minModifiedTimestamp: null, maxModifiedTimestamp: null,
  },
};

const setup = async (context: TestContext, scanOptions = options) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const requests: { root: string; scope: string | undefined; id: string; handlers: ScanHandlers; sequence: number; unlistened: boolean }[] = [];
  const cancelled: string[] = [];
  const errors: string[] = [];
  const published: { summary: ScanSummary | null; scanning: boolean }[] = [];
  const session = new LocalScan("original", "/root", scanOptions, {
    start: async (root, receivedOptions, handlers, id, scope) => {
      assert.equal(receivedOptions, scanOptions);
      const request = { root, scope, id, handlers, sequence: 0, unlistened: false };
      requests.push(request);
      return () => { request.unlistened = true; };
    },
    cancel: async (id) => { cancelled.push(id); },
  }, (summary, scanning) => published.push({ summary, scanning }), (message) => errors.push(message));
  await session.start();
  const send = (index: number, folders: ScanUpdate["folders"], files: ScanUpdate["files"] = [], kind: "Progress" | "Complete" | "Cancel" = "Progress") => {
    const request = requests[index]!;
    const sequence = request.sequence++;
    request.handlers[`on${kind}`]({
      id: request.id, sequence, folders, files, durationMs: sequence * 100 + 100,
      totalBytes: 0, fileCount: 0, dirCount: 0, largestFiles: [], skippedEntries: 0,
    });
    context.mock.timers.tick(120);
  };
  return {
    session, requests, cancelled, errors, published, send,
    summary: () => published.at(-1)!.summary!,
    scanning: () => published.at(-1)!.scanning,
  };
};

const assertTotals = (summary: ScanSummary): void => {
  const nodes = buildNodeMap(summary.root);
  const ids = new Set<number>();
  for (const node of nodes.values()) {
    assert.ok(!ids.has(node.id), `duplicate node id: ${node.id}`);
    ids.add(node.id);
    assert.equal(node.sizeBytes, node.files.reduce((sum, entry) => sum + entry.sizeBytes, 0) + node.children.reduce((sum, child) => sum + child.sizeBytes, 0));
    assert.equal(node.fileCount, node.files.length + node.children.reduce((sum, child) => sum + child.fileCount, 0));
    assert.equal(node.dirCount, node.children.length + node.children.reduce((sum, child) => sum + child.dirCount, 0));
    for (const child of node.children) assert.equal(child.parentId, node.id);
  }
  assert.equal(summary.totalBytes, summary.root.sizeBytes);
  assert.equal(summary.fileCount, summary.root.fileCount);
  assert.equal(summary.dirCount, summary.root.dirCount);
};

test("deletion updates cached totals and refills the largest files without reading folders", async (context) => {
  const scan = await setup(context);
  scan.send(0, [folder(0, null, "/root"), folder(1, 0, "/root/a"), folder(2, 0, "/root/b")], [
    file(1, "/root/a/large", 1000), ...Array.from({ length: 110 }, (_, index) => file(2, `/root/b/${index}`, index + 1)),
  ], "Complete");
  const before = scan.summary();
  await scan.session.mutate({ kind: "delete", path: "/root/a" }, async () => {});
  const after = scan.summary();
  assert.equal(after.root.children.length, 1);
  assert.equal(after.root.children[0], before.root.children[1]);
  assert.equal(before.root.children.length, 2);
  assert.equal(after.totalBytes, 110 * 111 / 2);
  assert.equal(after.largestFiles.length, 100);
  assert.equal(after.largestFiles.at(-1)!.sizeBytes, 11);
  assert.equal(scan.requests.length, 1);
  assert.deepEqual(scan.cancelled, []);
  assertTotals(after);
});

test("completed folder rename and move reuse files, update both parents, and preserve unrelated nodes", async (context) => {
  const scan = await setup(context);
  scan.send(0, [folder(0, null, "/root"), folder(1, 0, "/root/a"), folder(2, 1, "/root/a/nested"), folder(3, 0, "/root/b"), folder(4, 0, "/root/other")], [file(2, "/root/a/nested/data", 42), file(3, "/root/b/data", 10)], "Complete");
  const other = scan.summary().root.children[2];
  await scan.session.mutate({ kind: "relocate", path: "/root/a", newPath: "/root/renamed" }, async () => {});
  await scan.session.mutate({ kind: "relocate", path: "/root/renamed/nested", newPath: "/root/b/nested" }, async () => {});
  const summary = scan.summary();
  const nodes = buildNodeMap(summary.root);
  assert.equal(nodes.get("/root/renamed")!.sizeBytes, 0);
  assert.equal(nodes.get("/root/b")!.sizeBytes, 52);
  assert.equal(nodes.get("/root/b/nested")!.files[0]!.path, "/root/b/nested/data");
  assert.equal(nodes.get("/root/other"), other);
  assert.equal(summary.largestFiles[0]!.path, "/root/b/nested/data");
  assert.equal(scan.requests.length, 1);
  assertTotals(summary);
});

test("deletion during discovery ignores late descendants while unrelated progress continues", async (context) => {
  const scan = await setup(context);
  scan.send(0, [folder(0, null, "/root"), folder(1, 0, "/root/a", "scanning"), folder(2, 0, "/root/b", "scanning")], [file(1, "/root/a/first", 10)]);
  await scan.session.mutate({ kind: "delete", path: "/root/a" }, async () => {});
  assert.equal(scan.scanning(), true);
  scan.send(0, [folder(1, 0, "/root/a", "incomplete"), folder(3, 1, "/root/a/late", "scanning"), folder(4, 2, "/root/b/new", "scanning")], [file(1, "/root/a/stale", 999), file(2, "/root/b/data", 20)]);
  assert.equal(scan.summary().totalBytes, 20);
  assert.equal(buildNodeMap(scan.summary().root).has("/root/a"), false);
  assert.ok(buildTreeItems(scan.summary().root, new Set(["/root", "/root/b"]), true, true).some((row) => row.path === "/root/b/new"));
  scan.send(0, [folder(0, null, "/root"), folder(2, 0, "/root/b"), folder(4, 2, "/root/b/new")], [file(4, "/root/b/new/data", 30)], "Complete");
  assert.equal(scan.summary().totalBytes, 50);
  assert.equal(scan.summary().root.state, "complete");
  assert.equal(scan.summary().durationMs, 300);
  assert.equal(scan.scanning(), false);
  assert.equal(scan.requests.length, 1);
  assert.deepEqual(scan.cancelled, []);
  assertTotals(scan.summary());
});

test("an active move scans only its destination subtree and survives overlapping original events", async (context) => {
  const scan = await setup(context);
  scan.send(0, [folder(0, null, "/root", "scanning"), folder(1, 0, "/root/source"), folder(2, 1, "/root/source/a", "scanning"), folder(3, 0, "/root/other", "scanning")], [file(2, "/root/source/a/known", 10)]);
  await scan.session.mutate({ kind: "relocate", path: "/root/source/a", newPath: "/root/dest/a" }, async () => {});
  assert.deepEqual(scan.requests.map((request) => request.scope), [undefined, "/root/dest/a"]);
  assert.deepEqual(scan.cancelled, []);
  scan.send(1, [folder(0, null, "/root/dest"), folder(1, 0, "/root/dest/a", "scanning"), folder(2, 1, "/root/dest/a/nested", "scanning")], [file(1, "/root/dest/a/known", 10)]);
  assert.equal(scan.scanning(), true);
  scan.send(0, [folder(0, null, "/root"), folder(1, 0, "/root/source"), folder(2, 1, "/root/source/a", "incomplete"), folder(3, 0, "/root/other"), folder(4, 0, "/root/dest"), folder(5, 4, "/root/dest/a")], [file(2, "/root/source/a/stale", 888), file(5, "/root/dest/a/duplicate", 888), file(3, "/root/other/data", 50)], "Complete");
  assert.equal(scan.scanning(), true);
  assert.equal(scan.summary().totalBytes, 60);
  scan.send(1, [folder(1, 0, "/root/dest/a"), folder(2, 1, "/root/dest/a/nested")], [file(2, "/root/dest/a/nested/data", 20)], "Complete");
  const summary = scan.summary();
  const nodes = buildNodeMap(summary.root);
  assert.equal(nodes.get("/root/source")!.sizeBytes, 0);
  assert.equal(nodes.get("/root/dest")!.sizeBytes, 30);
  assert.equal(summary.totalBytes, 80);
  assert.equal(summary.root.state, "complete");
  assert.equal(scan.scanning(), false);
  assert.equal(scan.requests.length, 2);
  assertTotals(summary);
});

test("renaming an active folder twice cancels only its superseded scoped scan", async (context) => {
  const scan = await setup(context);
  scan.send(0, [folder(0, null, "/root"), folder(1, 0, "/root/a", "scanning"), folder(2, 0, "/root/b", "scanning")]);
  await scan.session.mutate({ kind: "relocate", path: "/root/a", newPath: "/root/renamed" }, async () => {});
  scan.send(1, [folder(0, null, "/root"), folder(1, 0, "/root/renamed", "scanning")], [file(1, "/root/renamed/known", 10)]);
  await scan.session.mutate({ kind: "relocate", path: "/root/renamed", newPath: "/root/final" }, async () => {});
  assert.deepEqual(scan.cancelled, [scan.requests[1]!.id]);
  scan.send(1, [folder(1, 0, "/root/renamed")], [file(1, "/root/renamed/stale", 999)], "Complete");
  scan.send(2, [folder(0, null, "/root"), folder(1, 0, "/root/final")], [file(1, "/root/final/known", 10)], "Complete");
  scan.send(0, [folder(0, null, "/root"), folder(1, 0, "/root/a", "incomplete"), folder(2, 0, "/root/b")], [file(2, "/root/b/data", 20)], "Complete");
  assert.deepEqual([...buildNodeMap(scan.summary().root).keys()].sort(), ["/root", "/root/b", "/root/final"]);
  assert.equal(scan.summary().totalBytes, 30);
  assertTotals(scan.summary());
});

test("file rename, delete, and move out of the root do not scan their siblings", async (context) => {
  const scan = await setup(context);
  scan.send(0, [folder(0, null, "/root", "scanning")], [file(0, "/root/a", 10), file(0, "/root/b", 20), file(0, "/root/c", 30)]);
  await scan.session.mutate({ kind: "relocate", path: "/root/a", newPath: "/root/renamed" }, async () => {});
  await scan.session.mutate({ kind: "delete", path: "/root/b" }, async () => {});
  await scan.session.mutate({ kind: "relocate", path: "/root/c", newPath: "/outside/c" }, async () => {});
  scan.send(0, [folder(0, null, "/root")], [file(0, "/root/late", 40)], "Complete");
  assert.deepEqual(scan.summary().root.files.map((entry) => entry.path), ["/root/late", "/root/renamed"]);
  assert.equal(scan.summary().totalBytes, 50);
  assert.equal(scan.requests.length, 1);
  assertTotals(scan.summary());
});

test("filter-sensitive renames inspect only the renamed entry using the original options", async (context) => {
  const scan = await setup(context, { ...options, filters: { ...options.filters, includeExtensions: ["txt"] } });
  scan.send(0, [folder(0, null, "/root")], [file(0, "/root/data.txt", 10)], "Complete");
  await scan.session.mutate({ kind: "relocate", path: "/root/data.txt", newPath: "/root/data.bin" }, async () => {});
  assert.equal(scan.requests[1]!.scope, "/root/data.bin");
  scan.send(1, [folder(0, null, "/root")], [], "Complete");
  assert.equal(scan.summary().fileCount, 0);
  assert.equal(scan.summary().largestFiles.length, 0);
  assertTotals(scan.summary());
});

test("creation and copy preserve active discovery, and deleting a copy suppresses late scoped events", async (context) => {
  const scan = await setup(context);
  scan.send(0, [folder(0, null, "/root", "scanning"), folder(1, 0, "/root/a")], [file(1, "/root/a/data", 10)]);
  await scan.session.mutate({ kind: "create", path: "/root/empty" }, async () => {});
  await scan.session.mutate({ kind: "copy", path: "/root/a", newPath: "/root/copy" }, async () => {});
  assert.equal(scan.requests.length, 2);
  scan.send(1, [folder(0, null, "/root"), folder(1, 0, "/root/copy", "scanning")], [file(1, "/root/copy/data", 10)]);
  await scan.session.mutate({ kind: "delete", path: "/root/copy" }, async () => {});
  scan.send(1, [folder(1, 0, "/root/copy")], [file(1, "/root/copy/stale", 999)], "Complete");
  scan.send(0, [folder(0, null, "/root"), folder(2, 0, "/root/empty"), folder(3, 0, "/root/copy")], [file(3, "/root/copy/stale", 999)], "Complete");
  assert.equal(scan.summary().dirCount, 2);
  assert.equal(scan.summary().totalBytes, 10);
  assert.deepEqual(scan.cancelled, [scan.requests[1]!.id]);
  assertTotals(scan.summary());
});

test("failed operations retain results and partial deletion refreshes only the affected folder", async (context) => {
  const scan = await setup(context);
  scan.send(0, [folder(0, null, "/root"), folder(1, 0, "/root/a"), folder(2, 0, "/root/b")], [file(1, "/root/a/data", 10), file(2, "/root/b/data", 20)], "Complete");
  const before = scan.summary();
  await assert.rejects(scan.session.mutate({ kind: "relocate", path: "/root/a", newPath: "/root/b" }, async () => { throw new Error("Destination exists"); }));
  assert.equal(scan.summary(), before);
  await assert.rejects(scan.session.mutate({ kind: "delete", path: "/root/a" }, async () => { throw new Error("Access denied"); }));
  assert.equal(scan.requests[1]!.scope, "/root/a");
  scan.send(1, [folder(0, null, "/root"), folder(1, 0, "/root/a")], [], "Complete");
  assert.equal(scan.summary().totalBytes, 20);
  assertTotals(scan.summary());
});

test("root rename follows the new path and root deletion leaves no stale results", async (context) => {
  const scan = await setup(context);
  scan.send(0, [folder(0, null, "/root")], [file(0, "/root/data", 10)], "Complete");
  await scan.session.mutate({ kind: "relocate", path: "/root", newPath: "/renamed" }, async () => {});
  assert.equal(scan.summary().root.path, "/renamed");
  assert.equal(scan.summary().root.files[0]!.path, "/renamed/data");
  assertTotals(scan.summary());
  await scan.session.mutate({ kind: "delete", path: "/renamed" }, async () => {});
  assert.equal(scan.summary(), null);
  assert.equal(scan.requests.length, 1);
});

test("path matching respects boundaries, Windows separators and case, and Linux case", () => {
  assert.equal(containsPath("/root/a", "/root/another"), false);
  assert.equal(containsPath("/root/A", "/root/a"), false);
  assert.equal(containsPath("C:\\Data\\A", "c:/data/a/child"), true);
  assert.equal(containsPath("C:\\Data\\A", "C:\\Data\\Another"), false);
  assert.equal(pathKey("\\\\server\\share\\Folder\\"), "//server/share/folder");
  assert.equal(parentPath("C:\\Data"), "C:\\");
  assert.equal(parentPath("/root"), "/");
});

test("a change from another window can move an entry into the scan or rename its ancestor", async (context) => {
  const scan = await setup(context);
  scan.send(0, [folder(0, null, "/root"), folder(1, 0, "/root/nested")], [file(1, "/root/nested/existing", 10)], "Complete");
  await scan.session.mutate({ kind: "relocate", path: "/outside/data", newPath: "/root/incoming" }, async () => {});
  assert.equal(scan.requests[1]!.scope, "/root/incoming");
  scan.send(1, [folder(0, null, "/root")], [file(0, "/root/incoming", 20)], "Complete");
  assert.equal(scan.summary().totalBytes, 30);
  await scan.session.mutate({ kind: "relocate", path: "/", newPath: "/moved" }, async () => {});
  assert.equal(scan.summary().root.path, "/moved/root");
  assert.equal(scan.summary().root.children[0]!.files[0]!.path, "/moved/root/nested/existing");
  assertTotals(scan.summary());
});

test("moving into an excluded, undiscovered parent does not leave synthetic folders", async (context) => {
  const scan = await setup(context, { ...options, filters: { ...options.filters, excludeNames: ["excluded"] } });
  scan.send(0, [folder(0, null, "/root"), folder(1, 0, "/root/a")], [file(1, "/root/a/data", 10)], "Complete");
  await scan.session.mutate({ kind: "relocate", path: "/root/a", newPath: "/root/excluded/a" }, async () => {});
  scan.send(1, [folder(0, null, "/root/excluded")], [], "Complete");
  assert.equal(scan.summary().root.children.length, 0);
  assert.equal(scan.summary().dirCount, 0);
  assert.equal(scan.summary().totalBytes, 0);
});

test("deleting within a scoped scan keeps the deletion when its ancestor publishes again", async (context) => {
  const scan = await setup(context);
  scan.send(0, [folder(0, null, "/root"), folder(1, 0, "/root/a", "scanning"), folder(2, 0, "/root/b", "scanning")]);
  await scan.session.mutate({ kind: "relocate", path: "/root/a", newPath: "/root/renamed" }, async () => {});
  scan.send(1, [folder(0, null, "/root"), folder(1, 0, "/root/renamed", "scanning"), folder(2, 1, "/root/renamed/nested", "scanning")], [file(2, "/root/renamed/nested/data", 10)]);
  await scan.session.mutate({ kind: "delete", path: "/root/renamed/nested" }, async () => {});
  scan.send(1, [folder(1, 0, "/root/renamed"), folder(2, 1, "/root/renamed/nested", "incomplete")], [file(2, "/root/renamed/nested/stale", 999), file(1, "/root/renamed/kept", 20)], "Complete");
  scan.send(0, [folder(0, null, "/root"), folder(1, 0, "/root/a", "incomplete"), folder(2, 0, "/root/b")], [file(2, "/root/b/data", 30)], "Complete");
  assert.equal(scan.summary().totalBytes, 50);
  assert.equal(buildNodeMap(scan.summary().root).has("/root/renamed/nested"), false);
  assert.equal(scan.summary().root.state, "complete");
  assert.deepEqual(scan.cancelled, []);
  assertTotals(scan.summary());
});

test("scoped errors and cancellation retain partial results and unrelated progress", async (context) => {
  const scan = await setup(context);
  scan.send(0, [folder(0, null, "/root"), folder(1, 0, "/root/a", "scanning"), folder(2, 0, "/root/b", "scanning")]);
  await scan.session.mutate({ kind: "relocate", path: "/root/a", newPath: "/root/renamed" }, async () => {});
  scan.send(1, [folder(0, null, "/root"), folder(1, 0, "/root/renamed", "scanning"), folder(2, 1, "/root/renamed/nested", "scanning")], [file(2, "/root/renamed/nested/partial", 10)]);
  scan.requests[1]!.handlers.onError("Access denied");
  assert.equal(scan.scanning(), true);
  assert.equal(buildNodeMap(scan.summary().root).get("/root/renamed/nested")!.state, "incomplete");
  scan.send(0, [folder(0, null, "/root", "incomplete"), folder(1, 0, "/root/a", "incomplete"), folder(2, 0, "/root/b", "incomplete")], [file(2, "/root/b/partial", 20)], "Cancel");
  assert.equal(scan.summary().totalBytes, 30);
  assert.equal(scan.scanning(), false);
  assert.deepEqual(scan.errors, ["Access denied"]);
  assertTotals(scan.summary());
});

test("completion while a filesystem operation is pending is retained when the operation finishes", async (context) => {
  const scan = await setup(context);
  scan.send(0, [folder(0, null, "/root"), folder(1, 0, "/root/a", "scanning"), folder(2, 0, "/root/b", "scanning")]);
  let finishOperation!: () => void;
  const completed = new Promise<void>((resolve) => { finishOperation = resolve; });
  const operation = scan.session.mutate({ kind: "relocate", path: "/root/a", newPath: "/root/renamed" }, () => completed);
  await Promise.resolve();
  scan.send(0, [folder(0, null, "/root"), folder(1, 0, "/root/a"), folder(2, 0, "/root/b")], [file(1, "/root/a/data", 10), file(2, "/root/b/data", 20)], "Complete");
  finishOperation();
  await operation;
  assert.equal(scan.summary().totalBytes, 30);
  assert.equal(scan.summary().root.children.find((node) => node.path === "/root/renamed")!.fileCount, 1);
  assert.equal(scan.requests.length, 1);
  assertTotals(scan.summary());
});

test("disposing aborts a scan whose listeners are still being registered", async () => {
  let finishStart!: (cleanup: () => void) => void;
  let signal: AbortSignal | undefined;
  const cancelled: string[] = [];
  let disposed = false;
  let unlistened = false;
  const scan = new LocalScan("pending", "/root", options, {
    start: async (_root, _options, _handlers, _id, _scope, abort) => {
      signal = abort;
      return new Promise((resolve) => { finishStart = resolve; });
    },
    cancel: async (id) => { cancelled.push(id); },
  }, () => assert.equal(disposed, false), assert.fail);
  const starting = scan.start();
  disposed = true;
  scan.dispose();
  assert.equal(signal!.aborted, true);
  finishStart(() => { unlistened = true; });
  await starting;
  assert.equal(unlistened, true);
  assert.deepEqual(cancelled, ["pending", "pending"]);
});
