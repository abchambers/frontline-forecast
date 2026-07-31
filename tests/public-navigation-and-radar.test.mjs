import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("signed-in users do not receive a redundant public sign-in tab", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /item\.target !== "login" \|\| !session/);
});

test("the dashboard timeline can load frames after it is opened", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(activeSection !== "radar" && !radarLoop\) return;/);
});

test("school-contact grants explain an inactive license before the membership write", async () => {
  const actions = await readFile(new URL("../company-hq/app/actions.ts", import.meta.url), "utf8");
  assert.match(actions, /Set the school license to Trial or Active before assigning school contacts\./);
});
