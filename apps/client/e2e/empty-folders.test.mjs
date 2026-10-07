import { test, expect } from "@playwright/test";
import { openEmptyFolders, previewEmptyFolders } from "./empty-folders-fixture.mjs";

test.beforeEach(async ({ page }) => {
  await openEmptyFolders(page);
});

test("navigation, previews and child exclusions keep the removal selection consistent", async ({
  page,
}) => {
  await expect(
    page.getByRole("link", { name: "Remove empty folders" }),
  ).toHaveAttribute("href", "/empty-folders");
  await previewEmptyFolders(page);
  await page.screenshot({ path: "test-results/empty-folders-desktop.png" });
  await expect(
    page.getByRole("button", { name: "Remove selected (3)", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Remove parent/child", { exact: true }).uncheck();
  await expect(
    page.getByLabel("Remove parent", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Remove selected (1)", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Remove parent", { exact: true }).check();
  await expect(
    page.getByLabel("Remove parent/child", { exact: true }),
  ).toBeChecked();
  await page.getByLabel("Search folder preview").fill("leaf");
  await page.getByLabel("Select all visible folders").uncheck();
  await expect(
    page.getByRole("button", { name: "Remove selected (2)", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Remove selected (2)", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Remove empty folders?",
  });
  await expect(confirmation).toContainText(
    "Permanently remove 2 selected folders?",
  );
  await expect(
    confirmation.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(() => window.__emptyFoldersTest.removals.length),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Remove selected (2)", exact: true })
    .click();
  await confirmation
    .getByRole("button", { name: "Remove folders", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("2 folders removed.");
  expect(
    await page.evaluate(() =>
      window.__emptyFoldersTest.removals[0].paths.toSorted(),
    ),
  ).toEqual(["/fixture/parent", "/fixture/parent/child"]);
});

test("all filters reach the backend and editing settings invalidates the preview", async ({
  page,
}) => {
  await previewEmptyFolders(page);
  await page.getByLabel("Include names", { exact: true }).fill("Cache, Temp");
  await expect(
    page.getByLabel("Remove parent/child", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Remove selected", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Exclude names", { exact: true }).fill("Keep");
  await page
    .getByLabel("Include paths", { exact: true })
    .fill("parent\\nested");
  await page.getByLabel("Exclude paths", { exact: true }).fill("archive");
  await page.getByLabel("Minimum depth", { exact: true }).fill("2");
  await page.getByLabel("Maximum depth", { exact: true }).fill("4");
  await page.getByLabel("Include hidden folders").check();
  await page.getByLabel("Include empty folder chains").uncheck();
  await page.getByText("Regex and age", { exact: true }).click();
  await page.getByLabel("Include regex", { exact: true }).fill("^temp");
  await page.getByLabel("Exclude regex", { exact: true }).fill("keep$");
  await page.getByLabel("Regex target", { exact: true }).selectOption("path");
  await page.getByLabel("Minimum age (days)", { exact: true }).fill("1");
  await page.getByLabel("Maximum age (days)", { exact: true }).fill("10");
  await page.getByLabel("Match case", { exact: true }).check();
  await page
    .getByRole("button", { name: "Find empty folders", exact: true })
    .click();
  await expect(
    page.getByLabel("Remove parent/child", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => window.__emptyFoldersTest.previews.at(-1).options,
    ),
  ).toEqual({
    minDepth: 2,
    maxDepth: 4,
    includeHidden: true,
    emptyAfterRemoval: false,
    includeNames: ["Cache", "Temp"],
    excludeNames: ["Keep"],
    includePaths: ["parent/nested"],
    excludePaths: ["archive"],
    includeRegex: "^temp",
    excludeRegex: "keep$",
    regexMatchPath: true,
    matchCase: true,
    minAgeDays: 1,
    maxAgeDays: 10,
  });
  await page.reload();
  await expect(page.getByLabel("Include names", { exact: true })).toHaveValue(
    "Cache, Temp",
  );
  await expect(
    page.getByRole("button", { name: "Remove selected", exact: true }),
  ).toBeDisabled();
});

test("failed removals keep only failed items selected for retry", async ({
  page,
}) => {
  await previewEmptyFolders(page);
  await page.evaluate(() => {
    window.__emptyFoldersTest.failPath = "/fixture/leaf";
  });
  await page
    .getByRole("button", { name: "Remove selected (3)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove folders", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "2 folders removed. 1 failed.",
  );
  await expect(
    page.getByText("Folder is no longer empty. Find folders again.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Remove parent/child", { exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    window.__emptyFoldersTest.failPath = "";
  });
  await page
    .getByRole("button", { name: "Remove selected (1)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove folders", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("3 folders removed.");
  expect(
    await page.evaluate(() => window.__emptyFoldersTest.removals.at(-1).paths),
  ).toEqual(["/fixture/leaf"]);
});

test("search cancellation disables partial previews and locks filters during work", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Choose folders", exact: true })
    .click();
  await page.evaluate(() => {
    window.__emptyFoldersTest.findDelay = 500;
  });
  await page
    .getByRole("button", { name: "Find empty folders", exact: true })
    .click();
  await expect(
    page.getByLabel("Include names", { exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Search cancelled. Find folders again to remove them.",
  );
  await expect(
    page.getByRole("button", { name: "Remove selected", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Include names", { exact: true })).toBeEnabled();
});

test("removal cancellation retains unfinished folders for the next attempt", async ({
  page,
}) => {
  await previewEmptyFolders(page);
  await page.evaluate(() => {
    window.__emptyFoldersTest.pauseRemovalAfter = 1;
  });
  await page
    .getByRole("button", { name: "Remove selected (3)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove folders", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "1 of 3 folders processed",
  );
  await expect(
    page.getByRole("button", { name: "Choose folders", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "1 folder removed. Removal cancelled.",
  );
  await expect(
    page.getByRole("button", { name: "Remove selected (2)", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    window.__emptyFoldersTest.pauseRemovalAfter = null;
  });
  await page
    .getByRole("button", { name: "Remove selected (2)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove folders", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("3 folders removed.");
});

test("multiple sources, manually entered paths and empty results require a fresh search", async ({
  page,
}) => {
  await previewEmptyFolders(page);
  await page.getByLabel("Folder path", { exact: true }).fill("/second");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Remove selected", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    window.__emptyFoldersTest.folders = [];
  });
  await page
    .getByRole("button", { name: "Find empty folders", exact: true })
    .click();
  await expect(
    page.getByText("No empty folders found", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.__emptyFoldersTest.previews.at(-1).paths),
  ).toEqual(["/fixture", "/second"]);
  await page.getByLabel("Remove source /second", { exact: true }).click();
  await expect(
    page.getByText("Choose folders to search", { exact: true }),
  ).toBeVisible();
});

test("errors and invalid ranges prevent removal and can be corrected", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Choose folders", exact: true })
    .click();
  await page.getByLabel("Minimum depth", { exact: true }).fill("3");
  await page.getByLabel("Maximum depth", { exact: true }).fill("2");
  await expect(
    page.getByRole("button", { name: "Find empty folders", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Maximum depth", { exact: true }).fill("4");
  await page.evaluate(() => {
    window.__emptyFoldersTest.error = "Invalid include regex: unclosed bracket";
  });
  await page
    .getByRole("button", { name: "Find empty folders", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Invalid include regex: unclosed bracket",
  );
  await expect(
    page.getByRole("button", { name: "Remove selected", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    window.__emptyFoldersTest.error = "";
    window.__emptyFoldersTest.searchErrors = [
      { path: "/fixture/private", message: "Access denied" },
    ];
  });
  await page
    .getByRole("button", { name: "Find empty folders", exact: true })
    .click();
  await page.getByText("Search errors (1)", { exact: true }).click();
  await expect(page.getByText("Access denied", { exact: true })).toBeVisible();
});

test("preview virtualization and narrow layouts stay usable", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__emptyFoldersTest.folders = Array.from(
      { length: 2000 },
      (_, index) => ({
        path: `/fixture/folder-${index}`,
        source: "/fixture",
        name: `folder-${index}`,
        relativePath: `folder-${index}`,
        depth: 1,
        modified: null,
        children: [],
      }),
    );
  });
  await page
    .getByRole("button", { name: "Choose folders", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Find empty folders", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove selected (2000)", exact: true }),
  ).toBeEnabled();
  expect(
    await page
      .getByRole("region", { name: "Empty folder preview" })
      .getByRole("checkbox")
      .count(),
  ).toBeLessThan(40);
  await page.getByLabel("Search folder preview").fill("folder-1999");
  await expect(
    page.getByLabel("Remove folder-1999", { exact: true }),
  ).toBeVisible();
  for (const width of [800, 640, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(
      page.getByRole("link", { name: "Remove empty folders", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "test-results/empty-folders-390.png",
    fullPage: true,
  });
});
