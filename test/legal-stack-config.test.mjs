import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { lint } from "../tools/lint.mjs";

const REPO = new URL("..", import.meta.url).pathname;
const read = (r) => parse(readFileSync(join(REPO, r), "utf8"));
const PACKS = ["nl-amsterdam", "fiktiva-city"];

// Copy of the repo with fiktiva-city's pack.yaml edited; only legal_stack errors are returned.
function withStack(edit) {
  const dir = mkdtempSync(join(tmpdir(), "can-stack-"));
  cpSync(REPO, dir, { recursive: true, filter: (s) => !/\/(node_modules|\.git)(\/|$)/.test(s) });
  const f = join(dir, "packs/jurisdictions/fiktiva-city/pack.yaml"), y = parse(readFileSync(f, "utf8"));
  edit(y.legal_stack);
  writeFileSync(f, stringify(y));
  const errs = lint(dir).filter((e) => /legal_stack/.test(e));
  rmSync(dir, { recursive: true });
  return errs;
}
const fails = (errs, re) => assert.ok(errs.some((e) => re.test(e)), `expected ${re}, got ${JSON.stringify(errs)}`);

test("the repo passes with no legal_stack errors", () => assert.deepEqual(lint(REPO).filter((e) => /legal_stack/.test(e)), []));

for (const p of PACKS) {
  test(`${p} lists L1 to L6 once, in order, with mode`, () => {
    const st = read(`packs/jurisdictions/${p}/pack.yaml`).legal_stack;
    assert.deepEqual(st.map((l) => l.layer), ["L1", "L2", "L3", "L4", "L5", "L6"]);
    for (const l of st) assert.ok(["binding", "reference", "not_applicable"].includes(l.mode));
  });
}
test("fiktiva-city pins a corpus on every layer", () => {
  for (const l of read("packs/jurisdictions/fiktiva-city/pack.yaml").legal_stack) assert.match(l.pack_hash, /^[0-9a-f]{64}$/);
});

test("a stack with a missing layer fails", () => fails(withStack((s) => s.splice(2, 1)), /legal_stack/));
test("a layer out of order fails", () => fails(withStack((s) => s.reverse()), /must be L1/));
test("a pack_hash that does not match fails", () => fails(withStack((s) => { s[3].pack_hash = "0".repeat(64); }), /pack_hash does not match/));
test("a version that does not match fails", () => fails(withStack((s) => { s[3].version = "9.9.9"; }), /version 9\.9\.9/));
test("binding on an index_only corpus needs the acknowledgement", () => fails(withStack((s) => { delete s[3].acknowledged_index_only; }), /acknowledged_index_only/));
test("not_applicable is refused outside L2 and L5", () => fails(withStack((s) => { s[3] = { layer: "L4", corpus: null, mode: "not_applicable", reason: "x" }; }), /only L2 and L5/));
test("not_applicable without a reason fails the schema", () => fails(withStack((s) => { s[1] = { layer: "L2", corpus: null, mode: "not_applicable" }; }), /legal_stack|fails pack schema/));

test("limits.yaml holds the legal retrieval keys with the defaults", () => {
  const r = read("limits.yaml").legal.retrieval;
  assert.equal(r.max_articles_per_layer.value, 3);
  assert.equal(r.token_budget_per_run.value, 2500);
  assert.equal(r.low_confidence_floor.value, 0.6);
  assert.ok(Array.isArray(r.risky_topics.value) && r.risky_topics.value.length > 0);
  assert.deepEqual(lint(REPO).filter((e) => e.startsWith("limits.yaml")), []);
});
