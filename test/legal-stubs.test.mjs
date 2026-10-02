import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { lintLegal } from "../tools/lint-legal.mjs";
import { listStack } from "../tools/list-stack.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const STUBS = [
  ["packs/legal/L4-national/nl/statutes", "nl-statutes", "L4", "statute"],
  ["packs/legal/L5-regional/nl/noord-holland", "nl-noord-holland", "L5", null],
  ["packs/legal/L6-city/nl-amsterdam/bylaws", "nl-amsterdam-bylaws", "L6", "bylaw"],
];
const ALLOWED = (k) => ["topic_area", k, "official_url", "why_relevant", "seed", "vendor_status"];
// A stub row may carry only index fields; any other key (article text, body, quote) is rejected.
export const rowErrors = (row, srcKey) => [
  ...Object.keys(row).filter((k) => !ALLOWED(srcKey).includes(k)).map((k) => `unexpected key ${k}`),
  ...(row[srcKey] !== "TODO" ? ["source not TODO"] : []),
];

test("all stubs lint clean", () => assert.deepEqual(lintLegal(ROOT), []));

for (const [dir, id, layer, key] of STUBS) {
  test(`${id} is an unreviewed index_only binding stub with pending review and no articles`, () => {
    const d = join(ROOT, dir), c = parse(readFileSync(join(d, "corpus.yaml"), "utf8"));
    assert.equal(c.id, id); assert.equal(c.layer, layer);
    assert.equal(c.status, "index_only"); assert.equal(c.reviewed, false); assert.equal(c.mode, "binding");
    assert.ok(existsSync(join(d, "review/PENDING.md")));
    assert.match(readFileSync(join(d, "README.md"), "utf8"), /UNREVIEWED STUB/);
    assert.ok(!existsSync(join(d, "articles")) || readdirSync(join(d, "articles")).every((f) => !f.endsWith(".md")));
    const t = readFileSync(join(d, "index.yaml"), "utf8");
    assert.match(t, /never produces an article citation|filled only if a seed needs it/);
    const rows = parse(t).entries;
    if (!key) return assert.deepEqual(rows, []);
    assert.ok(rows.length > 0);
    for (const r of rows) {
      assert.deepEqual(rowErrors(r, key), []);
      assert.equal(r.official_url, "TODO"); assert.equal(r.vendor_status, "pending");
      assert.ok(!/[–—]/.test(r.why_relevant));
    }
  });
}

test("row lint rejects article text", () => {
  assert.deepEqual(rowErrors({ topic_area: "x", statute: "TODO", article_text: "..." }, "statute"), ["unexpected key article_text"]);
  assert.deepEqual(rowErrors({ topic_area: "x", statute: "Some Act" }, "statute"), ["source not TODO"]);
});

test("list-stack nl-amsterdam prints all six layers with status", () => {
  const rows = listStack(ROOT, "nl-amsterdam");
  assert.deepEqual([...new Set(rows.map((r) => r.layer))], ["L1", "L2", "L3", "L4", "L5", "L6"]);
  for (const [, id, layer] of STUBS) {
    const r = rows.find((x) => x.layer === layer);
    assert.equal(r.id, id); assert.equal(r.status, "index_only"); assert.equal(r.reviewed, false);
  }
  assert.equal(rows.find((r) => r.layer === "L2").id, "nl-eu-law-index");
});
