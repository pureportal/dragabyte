import { test, expect } from "@playwright/test";
import { serveBuiltApp } from "./helpers.mjs";

const catalog = [
  ["Photo10.jpg", false, 300],
  ["Photo2.jpg", false, 200],
  ["notes.txt", false, 50],
  ["archive.zip", false, 500],
  ["folder", true, 0],
  ["library", true, 0],
  ["library/group-a", true, 0],
  ["library/group-a/album-01", true, 0],
  ["library/group-a/album-01/photo.jpg", false, 20],
  ["library/group-b", true, 0],
  ["library/group-b/album-02", true, 0],
  ["library/group-b/album-02/photo.jpg", false, 30],
  ["library/group-b/album-02/deeper", true, 0],
].map(([relative, isDirectory, size]) => ({
  path: `/fixture/${relative}`,
  name: relative.split("/").at(-1),
  isDirectory,
  size,
}));

async function openRenamer(page) {
  await serveBuiltApp(page);
  await page.addInitScript(
    ({ catalog }) => {
      const callbacks = new Map();
      let next = 1;
      window.__renameTest = {
        catalog,
        picked: [],
        calls: [],
        batches: [],
        failPath: "",
        delay: 0,
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
          const state = window.__renameTest;
          if (command === "get_launch_context")
            return { mode: "", path: null, paths: [] };
          if (command === "plugin:event|listen") return next++;
          if (command === "plugin:dialog|open") return state.picked;
          if (command === "collect_rename_items") {
            state.calls.push(args);
            const { options, paths } = args;
            if (state.delay)
              await new Promise((resolve) => setTimeout(resolve, state.delay));
            if (
              options.maxDepth !== null &&
              options.maxDepth < options.minDepth
            )
              throw "Invalid depth range";
            let regex;
            try {
              regex = options.pattern
                ? new RegExp(options.pattern, options.matchCase ? "" : "i")
                : null;
            } catch {
              throw "Invalid regex. Check the pattern.";
            }
            const found = new Map();
            for (const root of paths) {
              for (const item of state.catalog) {
                if (
                  item.path !== root &&
                  (!options.contents || !item.path.startsWith(root + "/"))
                )
                  continue;
                const relativePath =
                  item.path === root
                    ? item.name
                    : item.path.slice(root.length + 1);
                const depth =
                  item.path === root ? 0 : relativePath.split("/").length;
                if (
                  depth < options.minDepth &&
                  !(depth === 0 && !item.isDirectory)
                )
                  continue;
                if (options.maxDepth !== null && depth > options.maxDepth)
                  continue;
                if (
                  item.isDirectory
                    ? !options.includeFolders
                    : !options.includeFiles
                )
                  continue;
                if (
                  regex &&
                  !regex.test(options.matchPath ? relativePath : item.name)
                )
                  continue;
                found.set(item.path, { ...item, relativePath, depth });
              }
            }
            return [...found.values()];
          }
          if (command === "batch_rename") {
            state.batches.push(args.items);
            if (state.delay)
              await new Promise((resolve) => setTimeout(resolve, state.delay));
            return args.items.map((item) => ({
              path: item.path,
              newPath: item.new_path,
              error:
                item.path === state.failPath
                  ? "A file with this name already exists."
                  : null,
            }));
          }
          return null;
        },
      };
    },
    { catalog },
  );
  await page.goto("http://localhost/bulk-rename");
  await expect(
    page.getByRole("button", { name: "Add Files", exact: true }),
  ).toBeVisible();
}

async function addFiles(page) {
  await page.evaluate(
    (paths) => {
      window.__renameTest.picked = paths;
    },
    catalog.slice(0, 4).map((item) => item.path),
  );
  await page.getByRole("button", { name: "Add Files", exact: true }).click();
  await expect(page.getByRole("grid", { name: "Rename items" })).toBeVisible();
  await expect(page.getByLabel("Select notes.txt")).toBeVisible();
}

const row = (page, name) =>
  page
    .getByRole("row")
    .filter({ has: page.getByLabel(`Select ${name}`, { exact: true }) });
const selectedRows = (page) =>
  page.locator('[role="row"][aria-selected="true"]');

test.beforeEach(async ({ page }) => {
  await openRenamer(page);
});

test("additive clicks, shift clicks and shift arrows preserve selection and support deselect all", async ({
  page,
}) => {
  await addFiles(page);
  await row(page, "Photo10.jpg")
    .getByText("Photo10.jpg", { exact: true })
    .first()
    .click();
  await row(page, "notes.txt")
    .getByText("notes.txt", { exact: true })
    .first()
    .click();
  await expect(selectedRows(page)).toHaveCount(2);
  await row(page, "archive.zip")
    .getByText("archive.zip", { exact: true })
    .first()
    .click({ modifiers: ["Shift"] });
  await expect(selectedRows(page)).toHaveCount(3);
  await page.keyboard.press("Shift+ArrowUp");
  await expect(selectedRows(page)).toHaveCount(2);
  await page.keyboard.press("Shift+ArrowDown");
  await expect(selectedRows(page)).toHaveCount(3);
  await row(page, "archive.zip")
    .getByText("archive.zip", { exact: true })
    .first()
    .click();
  await expect(selectedRows(page)).toHaveCount(3);
  await page.getByRole("button", { name: "Deselect all" }).click();
  await expect(selectedRows(page)).toHaveCount(0);
  await row(page, "Photo10.jpg").focus();
  await page.keyboard.press("Control+a");
  await expect(selectedRows(page)).toHaveCount(4);
  await page.keyboard.press("Escape");
  await expect(selectedRows(page)).toHaveCount(0);
});

test("disable and force enable override filters and execution uses only changed enabled rows", async ({
  page,
}) => {
  await addFiles(page);
  await page.getByRole("button", { name: "Add Prefix", exact: true }).click();
  await page.getByPlaceholder("Text to add").fill("new-");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("button", { name: "+ Exclude", exact: true }).click();
  await page.getByPlaceholder("Filter text...").fill("notes");
  await expect(page.getByLabel("Rename mode for notes.txt")).toHaveValue(
    "auto",
  );
  await expect(row(page, "notes.txt").getByRole("gridcell").nth(3)).toHaveText(
    "notes.txt",
  );
  await row(page, "notes.txt").getByLabel("Select notes.txt").check();
  await page.getByRole("button", { name: "Force enable", exact: true }).click();
  await expect(page.getByLabel("Rename mode for notes.txt")).toHaveValue(
    "enabled",
  );
  await expect(row(page, "notes.txt").getByText("new-notes.txt")).toBeVisible();
  await page.getByLabel("Rename mode for archive.zip").selectOption("disabled");
  await expect(
    page.getByRole("button", { name: "Rename 3 items", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Rename 3 items", exact: true })
    .click();
  const batches = await page.evaluate(() => window.__renameTest.batches);
  expect(batches[0].map((item) => item.path)).toEqual([
    "/fixture/Photo10.jpg",
    "/fixture/Photo2.jpg",
    "/fixture/notes.txt",
  ]);
  await expect(
    page.getByRole("button", { name: "Rename", exact: true }),
  ).toBeDisabled();
});

test("natural sorting preserves selection and controls numbering order", async ({
  page,
}) => {
  await addFiles(page);
  await page.getByLabel("Select Photo10.jpg", { exact: true }).check();
  await page.getByLabel("Sort rows").selectOption("originalName");
  const names = await page
    .locator("[data-row-id]")
    .evaluateAll((rows) =>
      rows.map((row) => row.querySelector("input").getAttribute("aria-label")),
    );
  expect(names).toEqual([
    "Select archive.zip",
    "Select notes.txt",
    "Select Photo2.jpg",
    "Select Photo10.jpg",
  ]);
  await expect(
    page.getByLabel("Select Photo10.jpg", { exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Numbering", exact: true }).click();
  await expect(row(page, "Photo2.jpg").getByText("Photo2-3.jpg")).toBeVisible();
  await page
    .getByRole("button", { name: "Sort descending", exact: true })
    .click();
  await expect(
    row(page, "Photo10.jpg").getByText("Photo10-1.jpg"),
  ).toBeVisible();
});

test("removal removes list entries without invoking filesystem operations", async ({
  page,
}) => {
  await addFiles(page);
  await page.getByLabel("Select notes.txt").check();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByLabel("Select notes.txt")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Remove archive.zip from list" })
    .click();
  await expect(page.getByLabel("Select archive.zip")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear list" }).click();
  await expect(page.getByRole("grid")).toHaveCount(0);
  expect(await page.evaluate(() => window.__renameTest.batches)).toEqual([]);
});

test("advanced import previews only folders at exact depth and allows excluding individual matches", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import", exact: true });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    window.__renameTest.picked = ["/fixture/library"];
  });
  await dialog.getByRole("button", { name: "Choose folders" }).click();
  await dialog.getByLabel("Import item type").selectOption("folders");
  await dialog.getByRole("button", { name: "Advanced" }).click();
  await dialog.getByLabel("Maximum depth", { exact: true }).fill("2");
  await dialog.getByLabel("Minimum depth", { exact: true }).fill("2");
  await dialog.getByLabel("Import regex", { exact: true }).fill("^album-\\d+$");
  await expect(
    dialog.getByRole("button", { name: "Add 2 items", exact: true }),
  ).toBeEnabled();
  await expect(
    dialog.getByLabel("Import group-a/album-01", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("Import group-b/album-02", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("photo.jpg", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("Import group-a/album-01", { exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Add 1 item", exact: true }).click();
  await expect(page.getByLabel("Select album-02")).toBeVisible();
  await expect(page.getByLabel("Select album-01")).toHaveCount(0);
});

test("single and multiple file imports preview duplicates and show regex errors", async ({
  page,
}) => {
  await addFiles(page);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import", exact: true });
  await page.evaluate(() => {
    window.__renameTest.picked = [
      "/fixture/notes.txt",
      "/fixture/library/group-a/album-01/photo.jpg",
    ];
  });
  await dialog.getByRole("button", { name: "Choose files" }).click();
  await expect(
    dialog.getByRole("button", { name: "Add 1 item", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Advanced" }).click();
  await dialog.getByLabel("Import regex", { exact: true }).fill("[");
  await expect(dialog.getByRole("alert")).toContainText("Invalid regex");
  await expect(dialog.getByRole("button", { name: /^Add/ })).toBeDisabled();
  await dialog.getByLabel("Import regex", { exact: true }).fill("");
  await expect(
    dialog.getByRole("button", { name: "Add 1 item", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Add 1 item", exact: true }).click();
  await expect(page.getByLabel("Select photo.jpg")).toBeVisible();
});

test("partial failure keeps failed paths and prevents repeated prefixing on successful rows", async ({
  page,
}) => {
  await addFiles(page);
  await page.getByRole("button", { name: "Add Prefix" }).click();
  await page.getByPlaceholder("Text to add").fill("new-");
  await page.evaluate(() => {
    window.__renameTest.failPath = "/fixture/notes.txt";
    window.__renameTest.delay = 200;
  });
  await page
    .getByRole("button", { name: "Rename 4 items", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add Files", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText(
    "1 item could not be renamed",
  );
  await expect(
    page.getByLabel("Select notes.txt", { exact: true }),
  ).toBeVisible();
  await expect(
    row(page, "notes.txt").getByText("A file with this name already exists."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Rename 1 item", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    window.__renameTest.failPath = "";
  });
  await page
    .getByRole("button", { name: "Rename 1 item", exact: true })
    .click();
  await expect(
    page.getByLabel("Select new-notes.txt", { exact: true }),
  ).toBeVisible();
  expect((await page.evaluate(() => window.__renameTest.batches))[1]).toEqual([
    { path: "/fixture/notes.txt", new_path: "/fixture/new-notes.txt" },
  ]);
});

test("keyboard ranges include rows beyond the rendered window and work from checkboxes", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__renameTest.catalog = Array.from({ length: 500 }, (_, index) => ({
      path: `/fixture/item-${index}.txt`,
      name: `item-${index}.txt`,
      isDirectory: false,
      size: index,
    }));
    window.__renameTest.picked = window.__renameTest.catalog.map(
      (item) => item.path,
    );
  });
  await page.getByRole("button", { name: "Add Files", exact: true }).click();
  await page.getByLabel("Select item-0.txt", { exact: true }).check();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
  await page.keyboard.press("Shift+End");
  await expect(page.getByText("500 selected", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Select item-499.txt", { exact: true }),
  ).toBeVisible();
  expect(await page.locator("[data-row-id]").count()).toBeLessThan(40);
  await page.getByRole("button", { name: "Deselect all", exact: true }).click();
  await expect(page.getByText("500 selected", { exact: true })).toHaveCount(0);
});

test("changing import options discards in-flight previews and blocks stale additions", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import", exact: true });
  await page.evaluate(() => {
    window.__renameTest.picked = ["/fixture/library"];
    window.__renameTest.delay = 350;
  });
  await dialog.getByRole("button", { name: "Choose folders" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__renameTest.calls.length))
    .toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "Advanced" }).click();
  await dialog
    .getByLabel("Import regex", { exact: true })
    .fill("^does-not-match$");
  await expect(dialog.getByRole("button", { name: /^Add/ })).toBeDisabled();
  await expect(
    dialog.getByText("No matching items", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Add/ })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("grid")).toHaveCount(0);
});

test("responsive list and import dialog fit desktop and compact windows without page errors", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await addFiles(page);
  await page.getByRole("button", { name: "Add Prefix" }).click();
  await page.getByPlaceholder("Text to add").fill("2026-");
  await page.getByLabel("Select Photo10.jpg", { exact: true }).check();
  for (const [width, height] of [
    [1200, 800],
    [800, 600],
    [640, 480],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(
      page.getByRole("button", { name: "Import", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`rename-${width}.png`) });
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Import", exact: true });
    await dialog.getByRole("button", { name: "Advanced" }).click();
    const box = await dialog.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    await page.screenshot({ path: testInfo.outputPath(`import-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
