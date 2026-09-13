import assert from "node:assert/strict";

export async function verifyLandingContent(base) {
  const pages = new Map();
  const assets = new Set();
  const routes = [
    ["", /<title>Dragabyte\b/],
    ["imprint/", /<title>Imprint — Dragabyte<\/title>/],
    ["privacy/", /<title>Privacy policy — Dragabyte<\/title>/],
  ];

  for (const [route, title] of routes) {
    const url = new URL(route, base);
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, `Missing page: ${url.pathname}`);
    assert.match(response.headers.get("content-type"), /text\/html/);
    const html = await response.text();
    assert.match(html, title);
    assert.doesNotMatch(html, /__DRAGABYTE_VERSION__/);
    assert.match(html, /<script\b[^>]*type="module"[^>]*src="[^"]+"/);
    pages.set(url.href, html);

    for (const [tag] of html.matchAll(/<(?:img|link|script)\b[^>]*>/g)) {
      const reference = /(?:src|href)="([^"]+)"/.exec(tag)?.[1];
      if (reference) assets.add(new URL(reference, url).href);
    }
  }

  const home = pages.get(base.href);
  const downloads = [
    ...home.matchAll(
      /href="(https:\/\/github\.com\/pureportal\/dragabyte\/releases\/download\/v([^/]+)\/([^"]+))"/g,
    ),
  ];
  assert.equal(downloads.length, 5, "Expected five direct desktop downloads");
  assert.equal(new Set(downloads.map(([, url]) => url)).size, 5);
  assert.equal(new Set(downloads.map(([, , version]) => version)).size, 1);
  for (const [, , version, name] of downloads) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.ok(name.includes(version), `Download version mismatch: ${name}`);
  }
  for (const extension of [".exe", ".msi", ".deb", ".rpm", ".AppImage"]) {
    assert.ok(
      downloads.some(([, url]) => url.endsWith(extension)),
      `Missing ${extension} download`,
    );
  }
  for (const route of ["imprint/", "privacy/"]) {
    assert.ok(home.includes(`href="./${route}"`), `Missing ${route} link`);
    assert.match(
      pages.get(new URL(route, base).href),
      /mailto:support@pureportal\.io/,
    );
  }

  assert.ok(assets.size >= 5, "Expected local stylesheets and product images");
  for (const asset of assets) {
    const url = new URL(asset);
    assert.equal(
      url.origin,
      base.origin,
      `Asset must be bundled locally: ${url}`,
    );
    assert.ok(
      url.pathname.startsWith(base.pathname),
      `Asset escaped the site path: ${url}`,
    );
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, `Missing asset: ${url.pathname}`);
    const expectedType = url.pathname.endsWith(".js")
      ? /(?:text|application)\/javascript/
      : url.pathname.endsWith(".css")
      ? /text\/css/
      : /image\//;
    assert.match(
      response.headers.get("content-type"),
      expectedType,
      url.pathname,
    );
    assert.ok(
      (await response.arrayBuffer()).byteLength > 0,
      `Empty asset: ${url.pathname}`,
    );
  }

  for (const [page, html] of pages) {
    for (const [, reference] of html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
      const url = new URL(reference, page);
      if (url.origin !== base.origin) continue;
      assert.ok(
        url.pathname.startsWith(base.pathname),
        `Link escaped the site path: ${url}`,
      );
      const anchor = url.hash.slice(1);
      url.hash = "";
      if (assets.has(url.href)) continue;
      const target = pages.get(url.href);
      assert.ok(target, `Unknown page link: ${url}`);
      if (anchor)
        assert.ok(
          target.includes(`id="${anchor}"`),
          `Missing anchor: ${url}#${anchor}`,
        );
    }
  }

  const missing = await fetch(new URL("missing-page", base), {
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(missing.status, 404, "Missing pages must return 404");
  console.log(
    `Landing content passed: ${pages.size} pages, ${assets.size} local assets, five downloads, navigation, and 404 response.`,
  );
}
