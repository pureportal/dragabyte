import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

export async function serveBuiltApp(page) {
  const dist = resolve("dist");
  await page.route("http://localhost/**", async (route) => {
    const pathname = decodeURIComponent(
      new URL(route.request().url()).pathname,
    );
    const file = pathname.startsWith("/assets/")
      ? resolve(dist, pathname.slice(1))
      : resolve(dist, "index.html");
    if (!file.startsWith(dist + sep)) return route.abort();
    const contentType =
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".png": "image/png",
        ".svg": "image/svg+xml",
      }[extname(file)] ?? "application/octet-stream";
    await route.fulfill({ body: await readFile(file), contentType });
  });
}
