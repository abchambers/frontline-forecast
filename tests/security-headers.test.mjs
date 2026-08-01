import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public security headers deny framing and define a restrictive CSP", async () => {
  const headers = await readFile("src/lib/security-headers.ts", "utf8");
  const config = await readFile("next.config.ts", "utf8");

  assert.match(headers, /Content-Security-Policy/);
  assert.match(headers, /default-src 'self'/);
  assert.match(headers, /object-src 'none'/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /form-action 'self'/);
  assert.match(headers, /Referrer-Policy/);
  assert.match(config, /securityHeaders/);
});
