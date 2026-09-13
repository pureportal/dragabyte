import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { verifyLandingContent } from "./landing-content-checks.mjs";

const image = process.argv[2];
assert.ok(image, "Usage: node scripts/verify-landing.mjs <image>");

const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8" }).trim();
const container = docker(
  "run",
  "--detach",
  "--publish",
  "127.0.0.1::80",
  image,
);

try {
  const deadline = Date.now() + 45_000;
  while (true) {
    const state = JSON.parse(
      docker("inspect", "--format", "{{json .State}}", container),
    );
    assert.ok(state.Running, "Landing container exited before becoming ready");
    if (state.Health?.Status === "healthy") break;
    assert.ok(
      Date.now() < deadline,
      "Landing container health check did not pass",
    );
    await setTimeout(500);
  }

  const ports = JSON.parse(
    docker("inspect", "--format", "{{json .NetworkSettings.Ports}}", container),
  );
  const base = new URL(`http://127.0.0.1:${ports["80/tcp"][0].HostPort}/`);
  await verifyLandingContent(base);
  console.log("Landing container health check passed.");
} catch (error) {
  execFileSync("docker", ["logs", container], { stdio: "inherit" });
  throw error;
} finally {
  docker("rm", "--force", container);
}
