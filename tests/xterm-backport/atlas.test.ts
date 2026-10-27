import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "../..");
const { cases } = require("./cases.cjs") as {
  cases: Record<string, (root: string) => void>;
};
for (const [name, run] of Object.entries(cases)) test(name, () => run(root));

test("installed source and both executable bundles match the reproducible backport", () => {
  expect(execFileSync(process.execPath, ["scripts/xterm-backport.mjs", "--check"], { cwd: root, encoding: "utf8" }))
    .toContain("source, ESM/UMD bundles, maps and manifest match");
});

test("ESM and UMD retain the stable public addon API", async () => {
  const esm = await import("@xterm/addon-webgl");
  const umd = require("@xterm/addon-webgl") as typeof esm;
  for (const api of [esm, umd]) {
    const addon = new api.WebglAddon();
    expect(typeof addon.activate).toBe("function");
    expect(typeof addon.onContextLoss).toBe("function");
    expect(typeof addon.onChangeTextureAtlas).toBe("function");
  }
});
