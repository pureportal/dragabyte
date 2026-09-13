import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base } from "@playwright/test";

export const site = "https://dragabyte.app";
export const collector = "https://swetrix.pureportal.io/backend/v1/log";
export const consentKey = "dragabyte.analytics-consent";
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const contentTypes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
};

export async function assetResponse(url) {
  const pathname = decodeURIComponent(new URL(url).pathname);
  const file = resolve(dist, `.${pathname}`, ...(pathname.endsWith("/") ? ["index.html"] : []));
  if (!file.startsWith(dist.endsWith(sep) ? dist : `${dist}${sep}`)) {
    return { status: 403, body: "Forbidden" };
  }
  try {
    return { status: 200, contentType: contentTypes[extname(file)], body: await readFile(file) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { status: 404, contentType: "text/plain", body: "Not found" };
  }
}

export const test = base.extend({
  events: async ({ context }, use) => {
    const events = [];
    await context.route(`${site}/**`, async (route) => {
      await route.fulfill(await assetResponse(route.request().url()));
    });
    await context.route(`${collector}**`, async (route) => {
      const request = route.request();
      events.push({ url: request.url(), payload: request.postDataJSON(), headers: request.headers() });
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await context.route("https://github.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        headers: { "content-disposition": 'attachment; filename="dragabyte-test"' },
        body: "download fixture",
      });
    });
    await use(events);
  },
});

export { expect } from "@playwright/test";
