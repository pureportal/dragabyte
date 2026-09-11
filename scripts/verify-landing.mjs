import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";

const image = process.argv[2];
assert.ok(image, "Usage: node scripts/verify-landing.mjs <image>");

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const container = docker("run", "--detach", "--publish", "127.0.0.1::80", image);

try {
  const deadline = Date.now() + 45_000;
  while (true) {
    const state = JSON.parse(docker("inspect", "--format", "{{json .State}}", container));
    assert.ok(state.Running, "Landing container exited before becoming ready");
    if (state.Health?.Status === "healthy") break;
    assert.ok(Date.now() < deadline, "Landing container health check did not pass");
    await setTimeout(500);
  }

  const ports = JSON.parse(docker("inspect", "--format", "{{json .NetworkSettings.Ports}}", container));
  const base = new URL(`http://127.0.0.1:${ports["80/tcp"][0].HostPort}/`);
  const response = await fetch(base, { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  const html = await response.text();
  assert.match(html, /<title>Dragabyte\b/);
  assert.match(html, /https:\/\/github\.com\/pureportal\/dragabyte\/releases\/latest/);

  const assets = new Set();
  for (const [tag] of html.matchAll(/<(?:img|link)\b[^>]*>/g)) {
    const reference = /(?:src|href)="([^"]+)"/.exec(tag)?.[1];
    if (reference) assets.add(new URL(reference, base).href);
  }
  assert.ok(assets.size >= 3, "Expected the stylesheet, logo, and screenshot");
  for (const asset of assets) {
    const url = new URL(asset);
    assert.equal(url.origin, base.origin, `Asset must be bundled locally: ${url}`);
    const result = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    assert.equal(result.status, 200, `Missing asset: ${url.pathname}`);
    const expectedType = url.pathname.endsWith(".css") ? /text\/css/ : /image\//;
    assert.match(result.headers.get("content-type"), expectedType, url.pathname);
    assert.ok((await result.arrayBuffer()).byteLength > 0, `Empty asset: ${url.pathname}`);
  }

  for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(html.includes(`id="${anchor}"`), `Missing anchor: ${anchor}`);
  }
  const missing = await fetch(new URL("missing-page", base), { signal: AbortSignal.timeout(10_000) });
  assert.equal(missing.status, 404, "Missing pages must return 404");
  console.log(`Landing container passed: health check, HTML, ${assets.size} assets, anchors, and 404 response.`);
} catch (error) {
  execFileSync("docker", ["logs", container], { stdio: "inherit" });
  throw error;
} finally {
  docker("rm", "--force", container);
}
