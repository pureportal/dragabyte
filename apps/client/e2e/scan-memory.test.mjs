import { test, expect } from "@playwright/test";
import { appendFile, readFile } from "node:fs/promises";
import process from "node:process";
import { serveBuiltApp } from "./helpers.mjs";

async function openScanner(page, config) {
  await serveBuiltApp(page);
  await page.addInitScript(({ events, fileCount = 250000 }) => {
    const callbacks = new Map();
    const listeners = new Map();
    let next = 1;
    const root = events ? events[0].update.folders[0].path : "C:\\Memory Fixture\\资料";
    window.__scanMemoryTest = { opened: [], errors: [], scans: 0 };
    const emit = (event, payload) => {
      for (const listener of listeners.values()) {
        if (listener.event === event) callbacks.get(listener.handler)?.({ event, id: 0, payload });
      }
    };
    const replay = async (id) => {
      if (events) {
        for (const { kind, update } of events) {
          emit(`scan-${kind === "progress" ? "progress" : kind === "complete" ? "complete" : "cancelled"}`, { ...update, id });
          await new Promise((resume) => setTimeout(resume, 1));
        }
        return;
      }
      const folder = {
        id: 0, parentId: null, path: root, name: "资料", sizeBytes: 0, fileCount: 0, dirCount: 0,
        state: "scanning", readState: "scanning", skippedEntries: 0,
      };
      let sequence = 0;
      let largestFiles = [];
      const send = (files, complete = false) => {
        emit(complete ? "scan-complete" : "scan-progress", {
          id, sequence: sequence++, folders: [{ ...folder }], files, totalBytes: folder.sizeBytes,
          fileCount: folder.fileCount, dirCount: 0, skippedEntries: 0, largestFiles, durationMs: sequence * 100,
        });
      };
      send([]);
      for (let offset = 0; offset < fileCount; offset += 1024) {
        const files = [];
        for (let index = offset; index < Math.min(fileCount, offset + 1024); index += 1) {
          const name = `file-${String(index).padStart(7, "0")}.bin`;
          const file = { name, path: `${root}\\${name}`, sizeBytes: index + 1, modified: 1791324000000 };
          files.push({ parentId: 0, file });
          folder.sizeBytes += file.sizeBytes;
          folder.fileCount += 1;
        }
        largestFiles = [...files.map(({ file }) => file).reverse(), ...largestFiles].slice(0, 100);
        send(files);
        await new Promise((resume) => setTimeout(resume, 1));
      }
      folder.state = folder.readState = "complete";
      send([], true);
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" },
      },
      transformCallback(callback) { const id = next++; callbacks.set(id, callback); return id; },
      unregisterCallback(id) { callbacks.delete(id); },
      async invoke(command, args = {}) {
        if (command === "get_launch_context") return { mode: "", path: null, paths: [] };
        if (command === "is_context_menu_enabled") return true;
        if (command === "plugin:dialog|open") return root;
        if (command === "plugin:event|listen") {
          const id = next++;
          listeners.set(id, args);
          return id;
        }
        if (command === "plugin:event|unlisten") { listeners.delete(args.eventId); return; }
        if (command === "open_path") { window.__scanMemoryTest.opened.push(args.path); return; }
        if (command === "scan_path") {
          window.__scanMemoryTest.scans += 1;
          void replay(args.id).catch((error) => {
            window.__scanMemoryTest.errors.push(String(error));
            emit("scan-error", { id: args.id, message: String(error) });
          });
        }
        return null;
      },
    };
  }, config);
  await page.goto("http://localhost/");
  await page.getByRole("button", { name: "Scan Folder", exact: true }).click();
}

test("a large scan keeps file rows virtual and resolves paths after completion and restart", async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openScanner(page, { fileCount: 250000 });
  await expect(page.getByText("250,000 files", { exact: true })).toBeVisible({ timeout: 45000 });
  await expect(page.getByRole("button", { name: "Scan Folder", exact: true })).toBeEnabled();
  const session = process.env.DRAGABYTE_BROWSER_MEMORY_RESULTS ? await page.context().newCDPSession(page) : null;
  const measureHeap = async () => {
    await session.send("HeapProfiler.collectGarbage");
    return (await session.send("Runtime.getHeapUsage")).usedSize;
  };
  const collapsedHeap = session ? await measureHeap() : 0;
  await page.getByRole("button", { name: "Files: Off", exact: true }).click();
  const explorer = page.getByLabel("Folders and files", { exact: true });
  const first = explorer.getByTitle("C:\\Memory Fixture\\资料\\file-0249999.bin", { exact: true });
  await expect(first).toBeVisible();
  if (session) {
    const expandedHeap = await measureHeap();
    await appendFile(process.env.DRAGABYTE_BROWSER_MEMORY_RESULTS, JSON.stringify({
      fileCount: 250000, collapsedHeapMiB: collapsedHeap / 1024 ** 2,
      expandedHeapMiB: expandedHeap / 1024 ** 2,
    }) + "\n");
    await session.detach();
  }
  expect(await explorer.locator("[data-row-index]").count()).toBeLessThan(30);
  await first.dblclick();
  await expect.poll(() => page.evaluate(() => window.__scanMemoryTest.opened)).toEqual(["C:\\Memory Fixture\\资料\\file-0249999.bin"]);
  await first.click();
  await first.locator("xpath=ancestor::*[@data-row-index]").press("End");
  await expect(explorer.getByTitle("C:\\Memory Fixture\\资料\\file-0000000.bin", { exact: true })).toBeVisible();
  expect(await explorer.locator("[data-row-index]").count()).toBeLessThan(30);
  await page.getByRole("button", { name: "Scan Folder", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__scanMemoryTest.scans)).toBe(2);
  await expect(page.getByText("250,000 files", { exact: true })).toBeVisible({ timeout: 45000 });
  await expect(page.getByRole("button", { name: "Scan Folder", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__scanMemoryTest.errors)).toEqual([]);
  expect(errors).toEqual([]);
});

test("real filesystem scan events retain complete counts and open the original paths", async ({ page }) => {
  test.skip(!process.env.DRAGABYTE_SCAN_EVENTS, "Set DRAGABYTE_SCAN_EVENTS to a native scan-stream recording.");
  const events = (await readFile(process.env.DRAGABYTE_SCAN_EVENTS, "utf8")).replace(/^\uFEFF/, "").trim().split(/\r?\n/).map((line) => JSON.parse(line));
  const final = events.at(-1).update;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openScanner(page, { events });
  await expect(page.getByText(`${final.fileCount.toLocaleString("en-US")} files`, { exact: true })).toBeVisible();
  await expect(page.getByText(`${final.dirCount.toLocaleString("en-US")} folders`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scan Folder", exact: true })).toBeEnabled();
  const largest = final.largestFiles[0];
  await page.getByTitle(largest.path, { exact: true }).first().dispatchEvent("contextmenu", { clientX: 900, clientY: 300 });
  await page.getByRole("menuitem", { name: "Open File", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__scanMemoryTest.opened)).toEqual([largest.path]);
  expect(await page.evaluate(() => window.__scanMemoryTest.errors)).toEqual([]);
  expect(errors).toEqual([]);
});
