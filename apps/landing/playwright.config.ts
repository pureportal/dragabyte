import { defineConfig } from "@playwright/test";
import process from "node:process";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: true,
  workers: 2,
  timeout: 45_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    headless: true,
  },
});
