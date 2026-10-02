import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintLegalRatification, legalFlips } from "../tools/lint-legal-ratification.mjs";

const LEGAL = new URL("./fixtures/legal/valid", import.meta.url).pathname;
const C = "packs/legal/L6-city/fiktiva/bylaws";
const HASH = "f27f28f5841843ce2451ae12d9ef05e59d93f333bbeefb50c12e3b05ecac2859";
const REVIEW = (o = {}) => `---\nreviewer: "Mr J. Example"\nqualification: "advocaat, Fiktiva bar"\nscope: "whole corpus"\ndate: 2026-10-01\nexpires: 2099-01-01\ncontent_hash: "${HASH}"\n${o.extra ?? ""}---\nReviewed.\n`;

function tree({ review, ratify = true, extra = {} } = {}) {
  const d = mkdtempSync(join(tmpdir(), "can-lr-"));
  cpSync(LEGAL, d, { recursive: true });
  if (review) writeFileSync(join(d, C, "review", "r1.md"), review);
  if (ratify) { mkdirSync(join(d, "ratifications")); writeFileSync(join(d, "ratifications", "fiktiva-bylaws-0.1.0.md"), "---\npack: fiktiva-bylaws\nversion: x\n---\nbody\n"); }
  if (extra.dp) { mkdirSync(join(d, "decision-points/DP-X/examples"), { recursive: true }); writeFileSync(join(d, "decision-points/DP-X/examples/e.jsonl"), JSON.stringify({ legal_cites: [extra.dp] }) + "\n"); }
  return d;
}
const run = (o) => { const d = tree(o), notes = [], e = lintLegalRatification(d, notes); rmSync(d, { recursive: true }); return { e, notes }; };

test("a corpus with no ratification and no review is reported unreviewed, not failed", () => {
  const { e, notes } = run({ ratify: false });
  assert.deepEqual(e, []);
  assert.ok(notes.some((n) => /fiktiva-bylaws.*unreviewed/.test(n)));
});
test("a ratification with no review record cannot ratify", () => assert.ok(run().e.some((m) => /no review record/.test(m))));
test("a complete, current review passes the record checks", () => {
  const e = run({ review: REVIEW() }).e.filter((m) => !/reviewed: true/.test(m));
  assert.deepEqual(e, []);
});
test("a review of an older corpus hash fails", () => assert.ok(run({ review: REVIEW().replace(HASH, "0".repeat(64)) }).e.some((m) => /corpus changed since the review/.test(m))));
test("an expired review fails", () => assert.ok(run({ review: REVIEW().replace("2099-01-01", "2020-01-01") }).e.some((m) => /expires/.test(m))));
test("an AI reviewer fails", () => assert.ok(run({ review: REVIEW().replace("Mr J. Example", "Claude") }).e.some((m) => /named human/.test(m))));
test("authored_by ai without a reviewer fails even before ratification", () => {
  const { e } = run({ ratify: false, review: "---\nauthored_by: ai\n---\nx\n" });
  assert.ok(e.some((m) => /authored_by: ai needs a named human/.test(m)));
});
test("an unresolved citation in a DP example fails", () => {
  const { e } = run({ ratify: false, extra: { dp: { layer: "L6", article_id: `L6/fiktiva/bylaws/art-9`, corpus_version: "fiktiva-bylaws@0.1.0" } } });
  assert.ok(e.some((m) => /unresolved citation .*art-9/.test(m)));
});
test("a resolving citation passes, a stale corpus_version fails", () => {
  const ok = { layer: "L6", article_id: "L6/fiktiva/bylaws/art-1", corpus_version: "fiktiva-bylaws@0.1.0" };
  assert.deepEqual(run({ ratify: false, extra: { dp: ok } }).e, []);
  assert.ok(run({ ratify: false, extra: { dp: { ...ok, corpus_version: "fiktiva-bylaws@0.0.9" } } }).e.some((m) => /not the pinned/.test(m)));
});
test("the real repo is clean and reports its stubs unreviewed", () => {
  const notes = [];
  assert.deepEqual(lintLegalRatification(new URL("..", import.meta.url).pathname, notes), []);
  assert.ok(notes.some((n) => /unreviewed/.test(n)));
});
test("legalFlips groups flips by layer and article and counts touched resolutions", () => {
  const cite = { layer: "L6", article_id: "L6/fiktiva/bylaws/art-1" };
  const decisions = new Map([["a", { decision_id: "a", legal_cites: [cite] }], ["b", { decision_id: "b", legal_cites: [cite] }]]);
  const r = legalFlips([{ decision_id: "a" }], decisions, new Map(), null, LEGAL);
  assert.equal(r.by_layer.L6.flips, 1);
  assert.equal(r.by_article["L6/fiktiva/bylaws/art-1"].flips, 1);
  assert.equal(r.resolutions_touched, 2);
  assert.equal(legalFlips([], decisions, new Map(), LEGAL, LEGAL).resolutions_touched, 0);
});
