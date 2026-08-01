import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migrationsDirectory = path.resolve("supabase/migrations");

async function reconciliationMigration() {
  const files = await readdir(migrationsDirectory);
  const migration = files.find((file) => file.endsWith("_reconcile_school_branding_and_staff_policy.sql"));

  assert.ok(migration, "expected a forward-only reconciliation migration");
  return readFile(path.join(migrationsDirectory, migration), "utf8");
}

test("the production baseline reconciliation records branding and staff seat policy", async () => {
  const migration = await reconciliationMigration();

  assert.match(migration, /create table if not exists public\.organization_branding/);
  assert.match(migration, /new\.role in \('owner', 'admin', 'instructor', 'reviewer'\)/);
  assert.match(migration, /create or replace function frontline_private\.enforce_classroom_membership_capacity/);
});

test("the reconciliation keeps privileged RPCs unavailable to anonymous callers", async () => {
  const migration = await reconciliationMigration();

  for (const signature of [
    "public.create_classroom_join_code(uuid, text, timestamptz, integer)",
    "public.redeem_classroom_join_code(text)",
    "public.redeem_organization_license(text)",
  ]) {
    assert.match(migration, new RegExp(`revoke all on function ${signature.replace(/[().]/g, "\\$&")} from public, anon`, "i"));
  }
});
