import { test, expect, site } from "./fixtures.mjs";

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`pages, images and touch targets fit at ${width}px`, async ({ page, events }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/imprint/", "/privacy/"]) {
      await page.goto(`${site}${route}`);
      if (await page.getByRole("dialog").isVisible()) {
        await page.getByRole("button", { name: "Reject", exact: true }).click();
      }
      await page.locator("img").evaluateAll((images) => {
        images.forEach((image) => { image.loading = "eager"; });
      });
      await expect.poll(() => page.locator("img").evaluateAll((images) =>
        images.every((image) => image.complete && image.naturalWidth > 0),
      )).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const controls = await page.locator("nav a, .brand, .studio-link, .button, .text-link, .download-link, address a, button:visible")
        .evaluateAll((elements) => elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return { text: element.textContent.trim(), x: bounds.x, right: bounds.right, height: bounds.height };
        }));
      for (const control of controls) {
        expect(control.x, `${route}: ${control.text}`).toBeGreaterThanOrEqual(0);
        expect(control.right, `${route}: ${control.text}`).toBeLessThanOrEqual(width);
        expect(control.height, `${route}: ${control.text}`).toBeGreaterThanOrEqual(44);
      }
    }
    expect(events).toEqual([]);
  });
}

test("legal navigation, section links and full-size screenshots work", async ({ page, events }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(site);
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  const screenshots = await page.locator("[data-screenshot]").count();
  for (let index = 0; index < screenshots; index += 1) {
    await page.locator("[data-screenshot]").nth(index).click();
    await expect.poll(() => page.locator("img").evaluate((image) => image.naturalWidth)).toBeGreaterThan(1000);
    await page.goBack();
  }
  await page.getByRole("navigation", { name: "Footer navigation" }).getByRole("link", { name: "Imprint", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Imprint", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Footer navigation" }).getByRole("link", { name: "Privacy", exact: true }).click();
  for (const link of await page.getByRole("navigation", { name: "Privacy policy sections" }).getByRole("link").all()) {
    const target = await link.getAttribute("href");
    await link.click();
    await expect(page.locator(`${target} h2`)).toBeInViewport();
  }
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Download", exact: false }).click();
  await expect(page.getByRole("heading", { name: "Get Dragabyte." })).toBeInViewport();
  expect(errors).toEqual([]);
  expect(events).toEqual([]);
});
