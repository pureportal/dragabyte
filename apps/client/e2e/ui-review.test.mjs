import { test, expect } from "@playwright/test";
import { openEmptyFolders, previewEmptyFolders } from "./empty-folders-fixture.mjs";

test.beforeEach(async ({ page }) => {
  await openEmptyFolders(page);
});

test("medium windows keep the preview and search action in view", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await previewEmptyFolders(page);
  await page.screenshot({ path: "test-results/empty-folders-800.png" });
  const action = page.getByRole("button", {
    name: "Find empty folders", exact: true,
  });
  await expect(action).toBeInViewport({ ratio: 1 });
  await expect(
    page.getByRole("region", { name: "Empty folder preview" }),
  ).toBeInViewport({ ratio: 1 });
  await page.getByLabel("Minimum depth", { exact: true }).fill("3");
  await page.getByLabel("Maximum depth", { exact: true }).fill("2");
  await expect(page.getByRole("alert")).toBeInViewport({ ratio: 1 });
});

test("window controls have accessible names and reduced motion is respected", async ({ page }) => {
  for (const name of [
    "Minimize window", "Maximize or restore window", "Close window",
  ]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    window.__emptyFoldersTest.findDelay = 500;
  });
  await page.getByRole("button", { name: "Choose folders", exact: true }).click();
  await page.getByRole("button", { name: "Find empty folders", exact: true }).click();
  expect(
    await page.locator(".animate-spin").evaluate(
      (element) => getComputedStyle(element).animationDuration,
    ),
  ).toBe("0s");
});

test("filtered previews disclose hidden selections and start fresh after settings change", async ({ page }) => {
  await previewEmptyFolders(page);
  await page.getByLabel("Search folder preview").fill("  leaf  ");
  await expect(page.getByText("Preview (1 of 3)", { exact: true })).toBeVisible();
  const remove = page.getByRole("button", {
    name: "Remove selected (3)", exact: true,
  });
  await remove.click();
  const dialog = page.getByRole("dialog", { name: "Remove empty folders?" });
  await expect(dialog).toContainText("2 are hidden by the search.");
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Remove folders", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(remove).toBeFocused();
  await page.getByRole("button", { name: "Clear folder search", exact: true }).click();
  await expect(page.getByLabel("Search folder preview")).toHaveValue("");
  await page.getByLabel("Search folder preview").fill("leaf");
  await page.getByLabel("Include names", { exact: true }).fill("parent");
  await page.getByRole("button", { name: "Find empty folders", exact: true }).click();
  await expect(page.getByLabel("Search folder preview")).toHaveValue("");
  await expect(page.getByLabel("Remove parent", { exact: true })).toBeVisible();
});

test("adding a duplicate source preserves the preview and selection", async ({ page }) => {
  await previewEmptyFolders(page);
  await page.getByLabel("Remove leaf", { exact: true }).uncheck();
  await page.getByLabel("Folder path", { exact: true }).fill("/fixture");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Remove selected (2)", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Remove leaf", { exact: true })).not.toBeChecked();
});

test("all tools fit desktop and narrow windows", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const tool of ["Scanner", "Renamer", "Remove empty folders"]) {
    await page.getByRole("link", { name: tool, exact: true }).click();
    for (const [width, height] of [
      [1200, 800], [1024, 768], [800, 600], [640, 480], [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      const overflow = await page.locator("main").evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      );
      expect(overflow, `${tool} at ${width}×${height}`).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: `test-results/ui-${tool.split(" ")[0].toLowerCase()}-${width}.png`,
      });
    }
  }
  expect(errors).toEqual([]);
});

test("scan search remains visible across window sizes and can be cleared", async ({ page }) => {
  await page.getByRole("link", { name: "Scanner", exact: true }).click();
  const search = page.getByRole("textbox", {
    name: "Search scan results", exact: true,
  });
  await search.fill("notes");
  for (const width of [1200, 800, 640, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(search).toBeInViewport({ ratio: 1 });
    await expect(search).toHaveValue("notes");
  }
  await page.getByRole("button", { name: "Clear scan search", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Simple Filters", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Advanced Filters", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Advanced Filters", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
