import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintLegal } from "../tools/lint-legal.mjs";
import { lint } from "../tools/lint.mjs";
import { buildAll } from "../tools/build-pack.mjs";
import { discoverPacks, canonicalManifest } from "../tools/pack-hash.mjs";

const LEGAL = new URL("./fixtures/legal/valid", import.meta.url).pathname;
const VALID = new URL("./fixtures/valid", import.meta.url).pathname;
const C = "packs/legal/L6-city/fiktiva/bylaws";

function variant(mutate, base = LEGAL) {
  const d = mkdtempSync(join(tmpdir(), "can-legal-"));
  cpSync(base, d, { recursive: true });
  mutate(d);
  return d;
}
const edit = (d, rel, fn) => writeFileSync(join(d, C, rel), fn(readFileSync(join(d, C, rel), "utf8")));
const errsOf = (mutate) => { const d = variant(mutate); const e = lintLegal(d); rmSync(d, { recursive: true }); return e; };
const expect = (mutate, re) => { const e = errsOf(mutate); assert.ok(e.some((m) => re.test(m)), `expected ${re}, got ${JSON.stringify(e)}`); return e; };

test("the valid synthetic corpus lints clean", () => assert.deepEqual(lintLegal(LEGAL), []));
test("the real repo has no legal lint errors", () => assert.deepEqual(lintLegal(new URL("..", import.meta.url).pathname), []));

test("LEGAL-SOURCE-1: missing official_publisher fails", () => expect((d) => edit(d, "corpus.yaml", (t) => t.replace(/^official_publisher:.*\n/m, "")), /missing provenance field\(s\) official_publisher \(LEGAL-SOURCE-1\)/));
test("LEGAL-SOURCE-1: hash drift fails", () => expect((d) => edit(d, "articles/art-1.md", (t) => t.replace("fourteen", "fifteen")), /text_sha256 does not match/));
test("LEGAL-SOURCE-1: content_hash that does not match the text fails", () => expect((d) => edit(d, "corpus.yaml", (t) => t.replace(/content_hash: .*/, `content_hash: "${"0".repeat(64)}"`)), /content_hash does not match/));
test("an uncovered article fails", () => expect((d) => edit(d, "topic-index.json", (t) => JSON.stringify(JSON.parse(t).slice(1))), /art-1 must be covered by exactly one entry \(found 0\)/));
test("an index entry with no article fails", () => expect((d) => edit(d, "topic-index.json", (t) => JSON.stringify([...JSON.parse(t), { ...JSON.parse(t)[0], article_id: "L6/fiktiva/bylaws/art-9" }])), /art-9 does not resolve/));
test("topic_ban on an unreviewed corpus fails", () => expect((d) => edit(d, "topic-index.json", (t) => { const x = JSON.parse(t); x[0].topic_ban = true; x[0].ban_scope = ["public-notice"]; return JSON.stringify(x); }), /sets topic_ban but corpus.yaml has reviewed: false/));
test("topic_ban without ban_scope fails", () => expect((d) => edit(d, "topic-index.json", (t) => { const x = JSON.parse(t); x[0].topic_ban = true; return JSON.stringify(x); }), /fails topic index schema/));
test("topic_ban in an article fails", () => expect((d) => edit(d, "articles/art-1.md", (t) => t.replace("language: en", "language: en\ntopic_ban: true")), /topic_ban is never set in an article/));
test("an article without source_locator fails", () => expect((d) => edit(d, "articles/art-2.md", (t) => t.replace(/^source_locator:.*\n/m, "")), /art-2.md: missing source_locator/));
test("a translation used as the authority fails", () => {
  expect((d) => edit(d, "articles/art-1.md", (t) => t.replace("language: en", "language: nl")), /not the authoritative language/);
  expect((d) => edit(d, "corpus.yaml", (t) => t.replace("  - language: nl", "  - language: en")), /never the authority/);
});
test("status ratified without a review record fails", () => expect((d) => edit(d, "corpus.yaml", (t) => t.replace("status: draft", "status: ratified").replace("reviewed: false", "reviewed: true").replace("reviewer: none", "reviewer: {name: A, qualification: B, date: 2026-10-02, scope: C}")), /needs a review record/));
test("a complete review record lets ratified pass", () => {
  const d = variant((x) => {
    edit(x, "corpus.yaml", (t) => t.replace("status: draft", "status: ratified").replace("reviewed: false", "reviewed: true").replace("reviewer: none", "reviewer: {name: A Lawyer, qualification: invented bar of Fiktiva, date: 2026-10-02, scope: all articles}"));
    edit(x, "pack.yaml", (t) => t.replace("draft", "ratified"));
    writeFileSync(join(x, C, "review/2026-10-02.md"), "---\nreviewer: A Lawyer\nqualification: invented bar of Fiktiva\nscope: all articles\ndate: 2026-10-02\n---\nInvented review.\n");
  });
  const e = lintLegal(d); rmSync(d, { recursive: true });
  assert.deepEqual(e, []);
});

test("the pack hash moves with one article byte and not with CRLF", () => {
  const hashOf = (d) => { const p = discoverPacks(d).find((q) => q.layer === "legal"); return canonicalManifest(d, p).pack_hash; };
  const base = hashOf(LEGAL);
  const d = variant((x) => edit(x, "articles/art-1.md", (t) => t.replace("fourteen", "fifteen")));
  assert.notEqual(hashOf(d), base); rmSync(d, { recursive: true });
  const crlf = variant((x) => edit(x, "articles/art-1.md", (t) => t.replaceAll("\n", "\r\n")));
  assert.equal(hashOf(crlf), base); rmSync(crlf, { recursive: true });
});

test("a legal pack lints and builds inside a full tree without touching release.json", () => {
  const d = mkdtempSync(join(tmpdir(), "can-legal-full-"));
  cpSync(VALID, d, { recursive: true });
  const before = readFileSync(join(d, "release.json"), "utf8");
  mkdirSync(join(d, "packs/legal"), { recursive: true });
  cpSync(join(LEGAL, "packs/legal"), join(d, "packs/legal"), { recursive: true });
  const { outputs } = buildAll(d);
  outputs.forEach((o) => writeFileSync(join(d, o.rel), JSON.stringify(o.data, null, 2) + "\n"));
  assert.equal(readFileSync(join(d, "release.json"), "utf8"), before);
  assert.deepEqual(lint(d), []);
  rmSync(d, { recursive: true });
});
