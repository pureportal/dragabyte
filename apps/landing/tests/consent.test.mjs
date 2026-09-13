import { test, expect, site, collector, consentKey, assetResponse } from "./fixtures.mjs";

async function triggerActivity(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent("error", { error: new TypeError("private error text") }));
    window.dispatchEvent(new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(), reason: new Error("private rejection text"),
    }));
  });
  await page.locator("#download").scrollIntoViewIfNeeded();
  const download = page.waitForEvent("download");
  await page.locator(".download-link").first().click();
  await download;
}

test("no choice and rejection send nothing; downloads and privacy remain usable", async ({ page, events }) => {
  await page.clock.install();
  await page.goto(site);
  await expect(page.getByRole("dialog")).toBeVisible();
  await triggerActivity(page);
  await page.clock.fastForward(60_000);
  expect(events).toEqual([]);
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await triggerActivity(page);
  await page.clock.fastForward(60_000);
  expect(events).toEqual([]);
  await page.goto(`${site}/privacy/`);
  await expect(page.getByRole("heading", { name: "Privacy policy", exact: true })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), consentKey)).toBe("rejected");
  expect(events).toEqual([]);
});

test("acceptance sends page, campaign, interaction, error and heartbeat data to Dragabyte", async ({ page, events }) => {
  await page.clock.install();
  await page.goto(`${site}/?utm_source=newsletter&utm_campaign=autumn&email=private@example.com&token=secret#download`, {
    referer: "https://example.org/private?token=secret",
  });
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect.poll(() => events.filter(({ url }) => url === collector).length).toBe(1);
  await triggerActivity(page);
  await page.clock.fastForward(28_000);
  await expect.poll(() => events.some(({ url }) => url.endsWith("/hb"))).toBe(true);
  const view = events.find(({ url }) => url === collector).payload;
  expect(view).toMatchObject({ pid: "3AO7nkgbztMj", pg: "/", so: "newsletter", ca: "autumn", ref: "https://example.org" });
  expect(events.some(({ payload }) => payload.ev === "download_section")).toBe(true);
  expect(events.some(({ payload }) => payload.ev === "download_click" && payload.meta.format === "exe")).toBe(true);
  expect(events.filter(({ url }) => url.endsWith("/error"))).toHaveLength(2);
  expect(JSON.stringify(events)).not.toMatch(/private@|private error|private rejection|token=secret|\/private/);
  for (const event of events) {
    expect(event.payload.pid).toBe("3AO7nkgbztMj");
    expect(event.headers["x-api-key"]).toBeUndefined();
    expect(event.headers.cookie).toBeUndefined();
  }
  await page.goto(`${site}/imprint/`);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect.poll(() => events.some(({ url, payload }) => url === collector && payload.pg === "/imprint/")).toBe(true);
});

test("acceptance records real navigation performance", async ({ page, events }) => {
  await page.goto(site);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect.poll(() => events.some(({ url }) => url === collector)).toBe(true);
  const view = events.find(({ url }) => url === collector).payload;
  expect(Object.keys(view.perf)).toHaveLength(8);
  expect(Object.values(view.perf).every((value) => typeof value === "number" && value >= 0)).toBe(true);
});

test("withdrawal stops all tracking immediately and can be reversed without duplicate handlers", async ({ page, events }) => {
  await page.clock.install();
  await page.goto(site);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect.poll(() => events.some(({ url }) => url === collector)).toBe(true);
  await page.getByRole("button", { name: "Privacy settings", exact: true }).click();
  await page.getByRole("button", { name: "Withdraw consent" }).click();
  const afterWithdrawal = events.length;
  await triggerActivity(page);
  await page.clock.fastForward(90_000);
  expect(events).toHaveLength(afterWithdrawal);
  await page.reload();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(events).toHaveLength(afterWithdrawal);
  await page.getByRole("button", { name: "Privacy settings", exact: true }).click();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect.poll(() => events.filter(({ url }) => url === collector).length).toBe(2);
  await triggerActivity(page);
  await expect.poll(() => events.filter(({ payload }) => payload.ev === "download_click").length).toBe(1);
});

for (const choice of ["accepted", "rejected"]) {
  test(`closing privacy settings preserves ${choice} consent and restores focus`, async ({ page, events }) => {
    await page.clock.install();
    await page.goto(site);
    await expect(page.getByRole("button", { name: "Close privacy settings" })).toBeHidden();
    await page.getByRole("button", { name: choice === "accepted" ? "Accept" : "Reject", exact: true }).click();
    if (choice === "accepted") {
      await expect.poll(() => events.filter(({ url }) => url === collector).length).toBe(1);
    }
    const settings = page.getByRole("button", { name: "Privacy settings", exact: true });
    await settings.evaluate((button) => button.click());
    await page.getByRole("button", { name: "Close privacy settings" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(settings).toBeFocused();
    await settings.press("Enter");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(settings).toBeFocused();
    expect(await page.evaluate((key) => localStorage.getItem(key), consentKey)).toBe(choice);
    await page.clock.fastForward(28_000);
    if (choice === "accepted") {
      await expect.poll(() => events.some(({ url }) => url.endsWith("/hb"))).toBe(true);
      expect(events.filter(({ url }) => url === collector)).toHaveLength(1);
    } else {
      expect(events).toEqual([]);
    }
  });
}

test("clearing consent in another tab updates an already open dialog", async ({ page, context, events }) => {
  await page.goto(site);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect.poll(() => events.some(({ url }) => url === collector)).toBe(true);
  const second = await context.newPage();
  await second.goto(`${site}/privacy/`);
  await page.getByRole("button", { name: "Privacy settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Withdraw consent" })).toBeVisible();
  await second.evaluate(() => localStorage.clear());
  await expect(page.getByRole("button", { name: "Reject", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close privacy settings" })).toBeHidden();
  expect(await page.evaluate((key) => localStorage.getItem(key), consentKey)).toBeNull();
});

test("withdrawal and clearing storage synchronize between open pages", async ({ page, context, events }) => {
  await page.goto(site);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect.poll(() => events.some(({ url }) => url === collector)).toBe(true);
  const second = await context.newPage();
  await second.goto(`${site}/privacy/`);
  await expect(second.getByRole("dialog")).not.toBeVisible();
  await second.locator("footer").getByRole("button", { name: "Privacy settings" }).click();
  await second.getByRole("button", { name: "Withdraw consent" }).click();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), consentKey)).toBe("rejected");
  const count = events.length;
  await triggerActivity(page);
  expect(events).toHaveLength(count);
  await second.evaluate(() => localStorage.clear());
  await page.bringToFront();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(events).toHaveLength(count);
});

test("withdrawal while the analytics module loads cannot start tracking", async ({ page, context, events }) => {
  let release;
  let requested;
  const started = new Promise((resolve) => { requested = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  await context.route(/\/assets\/analytics-[^/]+\.js$/, async (route) => {
    requested();
    await pending;
    await route.fallback();
  });
  await page.goto(site);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await started;
  await page.getByRole("button", { name: "Privacy settings", exact: true }).click();
  await page.getByRole("button", { name: "Withdraw consent" }).click();
  release();
  await triggerActivity(page);
  expect(events).toEqual([]);
});

test("unavailable storage fails closed and reports how to recover", async ({ page, events }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("blocked", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("blocked", "SecurityError"); };
  });
  await page.goto(site);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Allow browser storage");
  await expect(page.getByRole("dialog")).toBeVisible();
  await triggerActivity(page);
  expect(events).toEqual([]);
});

test("keyboard controls and mobile layout remain usable", async ({ page, events }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(`${site}/privacy/`);
  await expect(page.getByRole("button", { name: "Reject", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeFocused();
  const bounds = await page.getByRole("dialog").boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(360);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(640);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await page.locator("footer").getByRole("button", { name: "Privacy settings" }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", `${site}/privacy/`);
  expect(events).toEqual([]);
});

test("all five direct downloads retain their targets and identify the package", async ({ page, events }) => {
  await page.goto(site);
  const links = await page.locator(".download-link").evaluateAll((links) => links.map((link) => link.href));
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect.poll(() => events.some(({ url }) => url === collector)).toBe(true);
  for (const link of await page.locator(".download-link").all()) {
    await Promise.all([page.waitForEvent("download"), link.click()]);
  }
  await expect.poll(() => events.filter(({ payload }) => payload.ev === "download_click").length).toBe(5);
  expect(events.filter(({ payload }) => payload.ev === "download_click").map(({ payload }) => payload.meta.format))
    .toEqual(["exe", "msi", "deb", "rpm", "appimage"]);
  expect(await page.locator(".download-link").evaluateAll((links) => links.map((link) => link.href))).toEqual(links);
});

test("preview origins cannot send production analytics", async ({ page, context, events }) => {
  await context.route("https://preview.dragabyte.test/**", async (route) => {
    await route.fulfill(await assetResponse(route.request().url()));
  });
  await page.goto("https://preview.dragabyte.test/");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await triggerActivity(page);
  expect(events).toEqual([]);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("content and downloads remain available without tracking", async ({ page, events }) => {
    await page.goto(site);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator(".download-link")).toHaveCount(5);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Privacy settings" })).toHaveCount(0);
    expect(events).toEqual([]);
  });
});
