import { createServer } from "node:http";
import { test } from "@playwright/test";
import { verifyLandingContent } from "../../../scripts/landing-content-checks.mjs";
import { assetResponse } from "./fixtures.mjs";

test("built pages pass the existing landing content checks", async () => {
  const server = createServer(async (request, response) => {
    const asset = await assetResponse(`http://127.0.0.1${request.url}`);
    response.writeHead(asset.status, { "Content-Type": asset.contentType || "text/plain" });
    response.end(asset.body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await verifyLandingContent(new URL(`http://127.0.0.1:${server.address().port}/`));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
