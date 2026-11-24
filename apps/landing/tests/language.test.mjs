import { test, expect, site } from "./fixtures.mjs";

const languageKey = "dragabyte.language";

test("German pages are fully localized and link to German legal pages", async ({ page, events }) => {
  await page.goto(`${site}/de/`);
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("dialog")).toContainText("Dürfen wir mit Swetrix");
  await page.getByRole("button", { name: "Ablehnen", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sehen Sie, wo Ihr Speicher bleibt.");
  await expect(page.locator(".download-link")).toHaveCount(5);
  const footer = page.getByRole("navigation", { name: "Fußzeilennavigation" });
  await expect(footer.getByRole("link", { name: "Nutzungsbedingungen" })).toHaveAttribute("href", "https://pureportal.io/de/terms");
  await expect(footer.getByRole("button", { name: "Datenschutzeinstellungen" })).toBeVisible();
  await footer.getByRole("link", { name: "Impressum", exact: true }).click();
  await expect(page).toHaveURL(`${site}/de/imprint/`);
  await expect(page.getByRole("heading", { name: "Angaben nach § 5 DDG" })).toBeVisible();
  await page.getByRole("navigation", { name: "Fußzeilennavigation" }).getByRole("link", { name: "Datenschutz", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Datenschutzerklärung", level: 1 })).toBeVisible();
  for (const link of await page.getByRole("navigation", { name: "Abschnitte der Datenschutzerklärung" }).getByRole("link").all()) {
    const target = await link.getAttribute("href");
    await expect(page.locator(`${target} h2`)).toHaveCount(1);
  }
  expect(events).toEqual([]);
});

test("English pages link to the English terms and switch language on request", async ({ page, events }) => {
  await page.goto(site);
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Footer navigation" }).getByRole("link", { name: "Terms" }))
    .toHaveAttribute("href", "https://pureportal.io/terms");
  await page.getByRole("link", { name: "Deutsch" }).click();
  await expect(page).toHaveURL(`${site}/de/`);
  expect(await page.evaluate((key) => localStorage.getItem(key), languageKey)).toBe("de");
  await page.goto(`${site}/privacy/`);
  await expect(page).toHaveURL(`${site}/de/privacy/`);
  await page.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(`${site}/privacy/`);
  await page.goto(`${site}/de/imprint/`);
  await expect(page).toHaveURL(`${site}/imprint/`);
  expect(events).toEqual([]);
});

test.describe("with a German browser", () => {
  test.use({ locale: "de-DE" });
  test("the English entry page opens in German until English is chosen", async ({ page, events }) => {
    await page.goto(`${site}/#download`);
    await expect(page).toHaveURL(`${site}/de/#download`);
    await page.locator('[data-choice="rejected"]').click();
    await page.getByRole("link", { name: "English" }).click();
    await expect(page).toHaveURL(`${site}/`);
    await page.reload();
    await expect(page).toHaveURL(`${site}/`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(events).toEqual([]);
  });
});
