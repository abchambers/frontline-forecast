import assert from "node:assert/strict";
import test from "node:test";
import { callerCanManageClassroom, isUuid } from "../src/lib/classroom-invite-access.ts";

const CALLER = "11111111-1111-4111-8111-111111111111";
const CLASSROOM = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const base = { supabaseUrl: "https://x.supabase.co", anonKey: "anon", authorization: "Bearer caller-token", callerId: CALLER, classroomId: CLASSROOM };

// Fake PostgREST: answers by table name from a fixture.
function fakeFetch(fixture) {
  return async (url) => {
    const table = String(url).split("/rest/v1/")[1].split("?")[0];
    const value = fixture[table];
    if (value === "error") return new Response("{}", { status: 500 });
    if (value === "throw") throw new TypeError("Load failed");
    return new Response(JSON.stringify(value ?? []), { status: 200 });
  };
}

const allowed = (fixture) => callerCanManageClassroom({ ...base, fetchImpl: fakeFetch(fixture) });

test("uuid validation rejects anything that could be smuggled into a query string", () => {
  assert.equal(isUuid(CALLER), true);
  for (const bad of ["", "abc", `${CALLER}&role=eq.owner`, `${CALLER}\n`, null, undefined, 42]) assert.equal(isUuid(bad), false, String(bad));
});

test("a platform owner or admin may invite", async () => {
  assert.equal(await allowed({ profiles: [{ role: "owner" }] }), true);
  assert.equal(await allowed({ profiles: [{ role: "admin" }] }), true);
});

test("an instructor or assistant of that class may invite", async () => {
  assert.equal(await allowed({ profiles: [{ role: "student" }], classroom_memberships: [{ role: "instructor" }] }), true);
  assert.equal(await allowed({ profiles: [{ role: "student" }], classroom_memberships: [{ role: "assistant" }] }), true);
});

test("an owner/admin/instructor of the class's school may invite even without a class membership", async () => {
  for (const role of ["owner", "admin", "instructor"]) {
    assert.equal(await allowed({ profiles: [{ role: "member" }], classroom_memberships: [], classrooms: [{ organization_id: ORG }], organization_memberships: [{ role }] }), true, role);
  }
});

test("a student, an unrelated signed-in account, or a mere school member may NOT invite", async () => {
  assert.equal(await allowed({ profiles: [{ role: "student" }], classroom_memberships: [{ role: "student" }], classrooms: [{ organization_id: ORG }], organization_memberships: [{ role: "student" }] }), false);
  assert.equal(await allowed({ profiles: [{ role: "member" }], classroom_memberships: [], classrooms: [], organization_memberships: [] }), false);
  assert.equal(await allowed({ profiles: [], classroom_memberships: [], classrooms: [{ organization_id: ORG }], organization_memberships: [] }), false);
});

test("it fails closed on any database error or network failure", async () => {
  assert.equal(await allowed({ profiles: "error", classroom_memberships: "error", classrooms: "error" }), false);
  assert.equal(await allowed({ profiles: "throw", classroom_memberships: "throw", classrooms: "throw" }), false);
  assert.equal(await allowed({ profiles: [{ role: "student" }], classroom_memberships: [], classrooms: [{ organization_id: "not-a-uuid" }] }), false);
});

test("a malformed caller or classroom id is refused before any request is made", async () => {
  let calls = 0;
  const counting = async () => { calls += 1; return new Response("[]"); };
  assert.equal(await callerCanManageClassroom({ ...base, classroomId: "x&role=eq.owner", fetchImpl: counting }), false);
  assert.equal(await callerCanManageClassroom({ ...base, callerId: "nope", fetchImpl: counting }), false);
  assert.equal(calls, 0);
});

test("reads are made with the caller's own token, never a service key", async () => {
  const seen = [];
  await callerCanManageClassroom({ ...base, fetchImpl: async (url, init) => { seen.push(init.headers); return new Response("[]"); } });
  assert.ok(seen.length > 0);
  for (const headers of seen) { assert.equal(headers.Authorization, "Bearer caller-token"); assert.equal(headers.apikey, "anon"); }
});
