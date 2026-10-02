import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lint } from "../tools/lint.mjs";
import { buildAll } from "../tools/build-pack.mjs";

const VALID = new URL("./fixtures/valid", import.meta.url).pathname;
const REPO = new URL("..", import.meta.url).pathname;
const J = "packs/jurisdictions/fiktiva-city/rules.yaml";
const BASE = `protected_core: [PC-1]
rules:
- id: PC-1
  tier: rights
  enforcement: hold
- id: P-1
  tier: procedure
  enforcement: needs_revision
`;

// Fixture tree with a base that has a protected rule, then a fiktiva-city overlay with the given rules.
function overlay(rulesYaml, extra = {}) {
  const d = mkdtempSync(join(tmpdir(), "can-overlay-"));
  cpSync(VALID, d, { recursive: true });
  writeFileSync(join(d, "packs/base/rules.yaml"), BASE);
  writeFileSync(join(d, J), rulesYaml);
  writeFileSync(join(d, "packs/jurisdictions/fiktiva-city/reviewer.yaml"), "reviewer: none\nfictional: true\n");
  writeFileSync(join(d, "packs/jurisdictions/fiktiva-city/sources.md"), extra.sources ?? "This overlay is invented.\n");
  buildAll(d).outputs.forEach((o) => writeFileSync(join(d, o.rel), JSON.stringify(o.data, null, 2) + "\n"));
  const errs = lint(d);
  rmSync(d, { recursive: true });
  return errs;
}
const rule = (o) => `rules:\n- id: ${o.id}\n  tier: ${o.tier ?? "procedure"}\n  enforcement: ${o.enf ?? "needs_revision"}\n${o.narrows ? `  narrows: ${o.narrows}\n` : ""}`;
const has = (errs, re) => assert.ok(errs.some((e) => re.test(e)), `expected ${re}, got ${JSON.stringify(errs)}`);

test("the real fiktiva-city overlay lints clean", () => assert.deepEqual(lint(REPO), []));
test("a new rule, and a stricter narrowing, pass", () => {
  assert.deepEqual(overlay(rule({ id: "NEW-1" })), []);
  assert.deepEqual(overlay(rule({ id: "P-1", narrows: "P-1", enf: "reject" })), []);
});
test("lowering enforcement fails", () => has(overlay(rule({ id: "P-1", narrows: "P-1", enf: "advisory" })), /weakens enforcement/));
test("changing a tier fails", () => has(overlay(rule({ id: "P-1", narrows: "P-1", tier: "privacy" })), /changes the tier/));
test("touching protected_core fails even when stricter", () => has(overlay(rule({ id: "PC-1", narrows: "PC-1", tier: "rights", enf: "hold" })), /protected_core rule/));
test("reusing a higher id without narrows fails", () => has(overlay(rule({ id: "P-1", enf: "reject" })), /without 'narrows: P-1'/));
test("narrows with nothing to narrow fails", () => has(overlay(rule({ id: "NEW-1", narrows: "NEW-1" })), /no higher layer/));
test("overlay may not list protected_core", () => has(overlay("protected_core: [P-1]\n" + rule({ id: "NEW-1" })), /only the base pack may list protected_core/));
test("fictional overlay must say invented", () => has(overlay(rule({ id: "NEW-1" }), { sources: "Real stuff.\n" }), /must state that it is invented/));
