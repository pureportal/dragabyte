import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const [moduleDirectory = resolve(import.meta.dirname, "../apps/client/src/features/scan"), count = "250000", shape = "nested"] = process.argv.slice(2);
const fileCount = Number(count);
assert.ok(Number.isSafeInteger(fileCount) && fileCount > 0);
assert.ok(["nested", "wide"].includes(shape));
assert.ok(global.gc, "Run with --expose-gc and --experimental-transform-types.");
const load = (name) => import(pathToFileURL(resolve(moduleDirectory, `${name}.ts`)).href);
const { ScanResults } = await load("scanResults");
const { ScanChanges } = await load("scanChanges");
const { buildTreeItems, buildNodeMap } = await load("treeData");
const results = new ScanResults("memory");
const rootPath = "C:\\scan-fixture\\projects\\customer-archive\\2026\\documents\\department\\source-data";
const changes = new ScanChanges(rootPath);
const folderCount = shape === "wide" ? 1 : Math.min(5000, fileCount);
const folders = Array.from({ length: folderCount + 1 }, (_, id) => ({
  id, parentId: id === 0 ? null : 0, path: id === 0 ? rootPath : `${rootPath}\\folder-${id}`,
  name: id === 0 ? "source-data" : `folder-${id}`, sizeBytes: 0, fileCount: 0, dirCount: 0,
  state: "scanning", readState: "scanning", skippedEntries: 0,
}));
let sequence = 0;
let totalBytes = 0;
let discovered = 0;
const update = (changed, files) => ({
  id: "memory", sequence: sequence++, folders: changed, files, totalBytes, fileCount: discovered,
  dirCount: folderCount, skippedEntries: 0, largestFiles: [], durationMs: 0,
});
let summary = null;
let peakHeap = 0;
const sample = () => { peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed); };
global.gc();
const initialHeap = process.memoryUsage().heapUsed;
const start = performance.now();
summary = results.apply([update(folders, [])]);
changes.update(summary);
changes.snapshot();
for (let offset = 0; offset < fileCount; offset += 1024) {
  const files = [];
  const changed = new Set([0]);
  const end = Math.min(fileCount, offset + 1024);
  for (let index = offset; index < end; index += 1) {
    const parentId = shape === "wide" ? 1 : Math.floor(index * folderCount / fileCount) + 1;
    const name = `file-${String(index).padStart(7, "0")}.bin`;
    const sizeBytes = (index % 31 + 1) * 1024;
    files.push({ parentId, file: { name, path: `${folders[parentId].path}\\${name}`, sizeBytes, modified: 1791324000000 } });
    folders[parentId].sizeBytes += sizeBytes;
    folders[parentId].fileCount += 1;
    changed.add(parentId);
    totalBytes += sizeBytes;
    discovered += 1;
  }
  folders[0].sizeBytes = totalBytes;
  folders[0].fileCount = discovered;
  folders[0].dirCount = folderCount;
  const event = JSON.parse(JSON.stringify(update([...changed].map((id) => folders[id]), files)));
  summary = results.apply([event]);
  changes.update(summary);
  changes.snapshot();
  sample();
  await new Promise((resume) => setImmediate(resume));
}
for (const folder of folders) folder.state = folder.readState = "complete";
summary = results.apply([JSON.parse(JSON.stringify(update(folders, [])))]);
changes.update(summary);
summary = changes.snapshot();
const scanMs = performance.now() - start;
sample();
global.gc();
const retainedHeap = process.memoryUsage().heapUsed;
assert.equal(summary.totalBytes, totalBytes);
assert.equal(summary.fileCount, fileCount);
assert.equal(summary.dirCount, folderCount);
const nodes = buildNodeMap(summary.root);
assert.equal(nodes.size, folderCount + 1);
const expansionStart = performance.now();
const rows = buildTreeItems(summary.root, new Set(nodes.keys()), true, false);
const expansionMs = performance.now() - expansionStart;
assert.equal(rows.length, fileCount + folderCount + 1);
let countedFiles = 0;
let countedBytes = 0;
for (const node of nodes.values()) {
  countedFiles += node.files.length;
  countedBytes += node.files.reduce((sum, file) => sum + file.sizeBytes, 0);
}
assert.equal(countedFiles, fileCount);
assert.equal(countedBytes, totalBytes);
assert.equal(rows.slice(0, 20).length, Math.min(20, rows.length));
assert.ok(rows.at(-1).path.startsWith(rootPath));
sample();
global.gc();
const expandedHeap = process.memoryUsage().heapUsed;
const mib = (bytes) => Number((bytes / 1024 ** 2).toFixed(2));
console.log(JSON.stringify({
  fileCount, folderCount, shape, scanMs: Math.round(scanMs), expansionMs: Number(expansionMs.toFixed(2)), totalBytes,
  peakHeapMiB: mib(peakHeap - initialHeap), retainedHeapMiB: mib(retainedHeap - initialHeap),
  expandedHeapMiB: mib(expandedHeap - initialHeap), maxRssMiB: mib(process.resourceUsage().maxRSS * 1024),
}));
