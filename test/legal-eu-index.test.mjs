import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { lintLegal } from "../tools/lint-legal.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR = join(ROOT, "packs/legal/L2-supranational/nl/eu-law-index");
const entries = parse(readFileSync(join(DIR, "index.yaml"), "utf8")).entries;
const corpus = parse(readFileSync(join(DIR, "corpus.yaml"), "utf8"));

test("the EU law index stub lints clean", () => assert.deepEqual(lintLegal(ROOT), []));
test("corpus is index_only, unreviewed, with no articles and no topic index", () => {
  assert.equal(corpus.status, "index_only");
  assert.equal(corpus.reviewed, false);
  assert.equal(corpus.instrument, "eu-law-index");
  assert.deepEqual(readdirSync(join(DIR, "articles")).filter((f) => f.endsWith(".md")), []);
  assert.ok(!readdirSync(DIR).includes("topic-index.json"), "an index_only corpus has no citable articles, so no topic index");
});
test("one row per topic area, all identifiers still TODO, vendor pending", () => {
  assert.deepEqual(entries.map((e) => e.topic_area), ["data-protection", "public-order-cooperation", "waste", "environment"]);
  for (const e of entries) {
    assert.equal(e.act_title, "TODO"); assert.equal(e.celex_id, "TODO"); assert.equal(e.eur_lex_url, "TODO");
    assert.equal(e.vendor_status, "pending");
    assert.ok([1, 2].includes(e.seed));
    assert.ok(e.why_relevant.length > 0);
    assert.ok(!/[–—]/.test(e.why_relevant));
  }
});
test("loader rule is documented in the index", () => {
  const t = readFileSync(join(DIR, "index.yaml"), "utf8");
  assert.match(t, /never produces an article citation/);
  assert.match(t, /no applicable article found in L2 \(version\)/);
});
