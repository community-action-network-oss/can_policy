// 10-u67: the planted fiktiva-north differences. Do not delete: reuse e2e and archive eval rely on them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { lint } from "../tools/lint.mjs";

const REPO = new URL("..", import.meta.url).pathname;
const L = (p) => join(REPO, "packs/legal", p);
const art = (c, k) => readFileSync(join(L(c), "articles", k + ".md"), "utf8");
const body = (t) => t.replace(/^---\n[\s\S]*?\n---\n/, "");
const stack = (j) => parse(readFileSync(join(REPO, "packs/jurisdictions", j, "pack.yaml"), "utf8")).legal_stack;
const corpus = (c) => parse(readFileSync(join(L(c), "corpus.yaml"), "utf8"));
const NORTH = { L2: "L2-supranational/fiktiva/north-union", L4: "L4-national/fiktiva/north-statutes", L6: "L6-city/fiktiva/north-bylaws" };

test("repo lints clean with fiktiva-north", () => assert.deepEqual(lint(REPO), []));

test("overlay and corpora are labelled fictional", () => {
  assert.equal(parse(readFileSync(join(REPO, "packs/jurisdictions/fiktiva-north/reviewer.yaml"), "utf8")).fictional, true);
  for (const c of Object.values(NORTH)) { assert.equal(corpus(c).fictional, true); assert.match(corpus(c).source_url, /^https:\/\/example\.org\//); }
});

test("(a) north L4 forbids collection fees; no fiktiva-city article does", () => {
  assert.match(body(art(NORTH.L4, "art-7")), /No public body may charge a collection fee/);
  for (const c of ["L4-national/fiktiva/statutes", "L6-city/fiktiva/bylaws"])
    for (const f of readdirSync(join(L(c), "articles"))) assert.doesNotMatch(art(c, f.slice(0, -3)), /collection fee/i);
});

test("(b) north L6 allows permit-free stalls that fiktiva-city requires a permit for", () => {
  assert.match(body(art(NORTH.L6, "art-3")), /needs no permit/);
  assert.match(body(art("L6-city/fiktiva/bylaws", "art-3")), /needs a stall permit/);
});

test("(c) the L2 control article is identical in both", () => {
  assert.equal(body(art(NORTH.L2, "art-4")).trim(), body(art("L2-supranational/fiktiva/union", "art-4")).trim());
});

test("(d) corpus version strings differ at L4", () => {
  const n = stack("fiktiva-north")[3], c = stack("fiktiva-city")[3];
  assert.notEqual(n.version, c.version);
  assert.notEqual(n.pack_hash, c.pack_hash);
});

test("(e) L5 is not_applicable in north, pinned in city", () => {
  assert.equal(stack("fiktiva-north")[4].mode, "not_applicable");
  assert.ok(stack("fiktiva-city")[4].corpus);
});

test("competence differs in at least one office; context fixtures use known bands", () => {
  const y = (j, f) => parse(readFileSync(join(REPO, "packs/jurisdictions", j, f), "utf8"));
  const n = y("fiktiva-north", "competence.yaml").topics, c = y("fiktiva-city", "competence.yaml").topics;
  assert.ok(Object.keys(n).some((k) => n[k] !== c[k]));
  const bands = JSON.parse(readFileSync(join(REPO, "content-schemas/_shared/bands.json"), "utf8"));
  const t = y("fiktiva-north", "context-fixtures.yaml").typical_problem;
  assert.ok(bands.budget_band.includes(t.budget_band) && bands.resource_people.includes(t.resource_people) && bands.climate_class.includes(t.climate_class));
  assert.ok(existsSync(join(REPO, "packs/jurisdictions/fiktiva-north/README.md")));
});
