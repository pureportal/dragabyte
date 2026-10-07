import { expect } from "@playwright/test";
import { serveBuiltApp } from "./helpers.mjs";

const folders = [
  ["parent", ["parent/child"]],
  ["parent/child", []],
  ["leaf", []],
].map(([relativePath, children]) => ({
  path: `/fixture/${relativePath}`,
  source: "/fixture",
  name: relativePath.split("/").at(-1),
  relativePath,
  depth: relativePath.split("/").length,
  modified: 1_790_000_000,
  children: children.map((path) => `/fixture/${path}`),
}));

export async function openEmptyFolders(page) {
  await serveBuiltApp(page);
  await page.addInitScript(
    ({ folders }) => {
      const callbacks = new Map();
      const listeners = new Map();
      let next = 1;
      let resumeRemoval;
      window.__emptyFoldersTest = {
        folders,
        picked: ["/fixture"],
        previews: [],
        removals: [],
        cancellations: new Set(),
        findDelay: 0,
        pauseRemovalAfter: null,
        failPath: "",
        error: "",
        searchErrors: [],
      };
      const progress = (id, processed, total, found) => {
        const callback = callbacks.get(listeners.get("empty-folders-progress"));
        callback?.({
          event: "empty-folders-progress",
          id: 0,
          payload: { id, processed, total, found, path: "/fixture" },
        });
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      window.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main", windowLabel: "main" },
        },
        transformCallback(callback) {
          const id = next++;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback(id) {
          callbacks.delete(id);
        },
        async invoke(command, args = {}) {
          const state = window.__emptyFoldersTest;
          if (command === "get_launch_context")
            return { mode: "", path: null, paths: [] };
          if (command === "plugin:event|listen") {
            listeners.set(args.event, args.handler);
            return next++;
          }
          if (command === "plugin:dialog|open") return state.picked;
          if (command === "cancel_empty_folders") {
            state.cancellations.add(args.id);
            resumeRemoval?.();
            resumeRemoval = undefined;
            return;
          }
          if (command === "preview_empty_folders") {
            state.previews.push(args);
            progress(args.id, 1, null, 0);
            if (state.findDelay)
              await new Promise((resolve) =>
                setTimeout(resolve, state.findDelay),
              );
            if (state.error) throw state.error;
            return {
              folders: state.folders,
              errors: state.searchErrors,
              inspected: 5,
              cancelled: state.cancellations.has(args.id),
            };
          }
          if (command === "remove_empty_folders_preview") {
            state.removals.push(args);
            const outcomes = [];
            const paths = args.paths.toSorted(
              (a, b) => b.split("/").length - a.split("/").length,
            );
            for (const path of paths) {
              if (outcomes.length === state.pauseRemovalAfter)
                await new Promise((resolve) => {
                  resumeRemoval = resolve;
                });
              if (state.cancellations.has(args.id)) break;
              outcomes.push({
                path,
                error:
                  path === state.failPath
                    ? "Folder is no longer empty. Find folders again."
                    : null,
              });
              progress(args.id, outcomes.length, paths.length, 0);
            }
            return { outcomes, cancelled: state.cancellations.has(args.id) };
          }
          return null;
        },
      };
    },
    { folders },
  );
  await page.goto("http://localhost/empty-folders");
  await expect(
    page.getByRole("heading", { name: "Remove empty folders" }),
  ).toBeVisible();
}

export async function previewEmptyFolders(page) {
  await page
    .getByRole("button", { name: "Choose folders", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Find empty folders", exact: true })
    .click();
  await expect(
    page.getByLabel("Remove parent/child", { exact: true }),
  ).toBeVisible();
}
