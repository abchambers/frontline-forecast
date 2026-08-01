import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public application overrides the vulnerable Next transitive toolchain", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(manifest.dependencies.next, "16.2.12");
  assert.equal(manifest.overrides?.postcss, "8.5.25");
  assert.equal(manifest.overrides?.sharp, "0.35.3");
});
