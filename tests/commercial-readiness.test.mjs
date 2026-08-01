import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("commercial readiness distinguishes code controls from account controls", async () => {
  const document = await readFile("operations-hq/COMMERCIAL_READINESS_CONTROLS.md", "utf8");

  for (const required of ["SUPABASE_SERVICE_ROLE_KEY", "durable rate limit", "restore drill", "leaked-password protection"]) {
    assert.match(document, new RegExp(required, "i"));
  }
});
