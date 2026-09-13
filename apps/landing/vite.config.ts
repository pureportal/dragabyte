import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  appType: "mpa",
  base: "./",
  publicDir: fileURLToPath(new URL("../../assets", import.meta.url)),
  html: {
    additionalAssetSources: {
      a: {
        srcAttributes: ["href"],
        filter: ({ attributes }) => "data-screenshot" in attributes,
      },
    },
  },
  plugins: [
    {
      name: "landing-release-version",
      transformIndexHtml(html) {
        return html.replaceAll("__DRAGABYTE_VERSION__", version);
      },
    },
  ],
  build: {
    rolldownOptions: {
      input: {
        home: fileURLToPath(new URL("./index.html", import.meta.url)),
        imprint: fileURLToPath(
          new URL("./imprint/index.html", import.meta.url),
        ),
        privacy: fileURLToPath(
          new URL("./privacy/index.html", import.meta.url),
        ),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
  },
});
