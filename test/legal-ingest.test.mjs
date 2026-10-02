import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { ingest } from "../tools/legal-ingest.mjs";
import { lintLegal, splitArticle } from "../tools/lint-legal.mjs";
import { walk } from "../tools/pack-hash.mjs";

const SRC = new URL("./fixtures/legal-source", import.meta.url).pathname;
const CLI = new URL("../tools/legal-ingest.mjs", import.meta.url).pathname;
const L = "packs/legal/L6-city/fiktiva";

// Fresh copy of the fixture tree; returns {root, dir(name)}.
function setup() {
  const root = mkdtempSync(join(tmpdir(), "can-ingest-"));
  cpSync(SRC, root, { recursive: true });
  return { root, dir: (n) => join(root, L, n) };
}
const snapshot = (d, prefix = "") => Object.fromEntries(walk(d).filter((f) => f.startsWith(prefix)).map((f) => [f, readFileSync(join(d, f), "utf8")]));
const editSrc = (d, file, fn) => writeFileSync(join(d, "sources", file), fn(readFileSync(join(d, "sources", file), "utf8")));
const throwsRe = (fn, re) => assert.throws(fn, (e) => re.test(e.message));

for (const [name, n] of [["txt", "ingest-txt"], ["html", "ingest-html"]]) {
  test(`${name}: ingest is byte stable, passes --check and lints clean`, () => {
    const { root, dir } = setup(), d = dir(n);
    assert.deepEqual(ingest(d), []);
    const first = snapshot(d);
    assert.deepEqual(ingest(d), []);
    assert.deepEqual(snapshot(d), first);
    assert.deepEqual(ingest(d, { check: true }), []);
    assert.deepEqual(lintLegal(root), []); // hashes, locators, coverage, pack.yaml agreement
    const c = parse(first["corpus.yaml"]);
    assert.equal(c.status, "draft"); assert.equal(c.reviewed, false); assert.equal(c.reviewer, "none");
    assert.equal(c.official_publisher, "City of Fiktiva (fictional)"); assert.equal(c.retrieval_date, "2026-10-03");
    assert.match(first["topic-index.draft.yaml"], /draft: true/);
    for (const e of JSON.parse(first["topic-index.json"])) assert.equal(e.topic_ban, false);
    rmSync(root, { recursive: true });
  });
}

test("txt: article text is the source text byte for byte, and CRLF input gives the same articles", () => {
  const { root, dir } = setup(), d = dir("ingest-txt");
  ingest(d);
  assert.deepEqual(readdirSync(join(d, "articles")).sort(), ["art-1.md", "art-10.md", "art-2.md", "art-3.md", "art-4.md"]);
  const src = readFileSync(join(d, "sources/fiktiva-code.txt"), "utf8");
  const a1 = splitArticle(readFileSync(join(d, "articles/art-1.md"), "utf8"));
  assert.ok(src.includes(a1.body)); // verbatim, including the soft-wrapped line
  assert.ok(a1.body.startsWith("Article 1 Public notice\n") && a1.body.includes("on its\nmunicipal"));
  assert.ok(!a1.body.includes("CHAPTER")); // chapter lines end an article and are never copied into one
  assert.equal(a1.front.heading, "Article 1 Public notice");
  assert.match(a1.front.source_locator, /chapter I, bytes \d+-\d+ of LF text/);
  const before = snapshot(d, "articles/");
  editSrc(d, "fiktiva-code.txt", (t) => t.replaceAll("\n", "\r\n"));
  assert.deepEqual(ingest(d), []);
  assert.deepEqual(snapshot(d, "articles/"), before);
  rmSync(root, { recursive: true });
});

test("txt: topics come from the seed; the tool never sets a ban", () => {
  const { root, dir } = setup(), d = dir("ingest-txt");
  ingest(d);
  const ix = Object.fromEntries(JSON.parse(readFileSync(join(d, "topic-index.json"), "utf8")).map((e) => [e.article_id, e]));
  assert.deepEqual(ix["L6/fiktiva/ingest-txt/art-1"].topics, ["public-notice"]);
  assert.deepEqual(ix["L6/fiktiva/ingest-txt/art-4"].topics, ["public-notice"]);
  assert.deepEqual(ix["L6/fiktiva/ingest-txt/art-10"].topics, ["appeal"]);
  assert.deepEqual(ix["L6/fiktiva/ingest-txt/art-2"].topics, ["public-space"]);
  rmSync(root, { recursive: true });
});

test("html: tags and scripts are dropped, entities decoded, wording untouched", () => {
  const { root, dir } = setup(), d = dir("ingest-html");
  ingest(d);
  const a1 = splitArticle(readFileSync(join(d, "articles/art-1.md"), "utf8")).body;
  assert.equal(a1, "Article 1 Public notice\nINVENTED TEXT. The City of Fiktiva & its board publish every public notice\nfor fourteen days.\n".replace(" ", " "));
  assert.ok(!existsSync(join(d, "articles/art-9.md"))); // script content is not an article
  assert.ok(splitArticle(readFileSync(join(d, "articles/art-3.md"), "utf8")).body.includes("open — from"));
  rmSync(root, { recursive: true });
});

test("a duplicated heading fails", () => {
  const { root, dir } = setup(), d = dir("ingest-txt");
  editSrc(d, "fiktiva-code.txt", (t) => t.replace("Article 10 Appeals", "Article 4 Appeals"));
  throwsRe(() => ingest(d), /duplicate article heading art-4/);
  assert.ok(!existsSync(join(d, "articles")));
  rmSync(root, { recursive: true });
});

test("a source edited after ingest fails --check", () => {
  const { root, dir } = setup(), d = dir("ingest-txt");
  ingest(d);
  editSrc(d, "fiktiva-code.txt", (t) => t.replace("fourteen", "fifteen"));
  const p = ingest(d, { check: true });
  assert.ok(p.some((m) => /art-1\.md: differs/.test(m)) && p.some((m) => /corpus\.yaml: differs/.test(m)), JSON.stringify(p));
  assert.equal(spawnSync(process.execPath, [CLI, d, "--check"]).status, 1);
  rmSync(root, { recursive: true });
});

test("--check also fails on an edited article and on a stale article", () => {
  const { root, dir } = setup(), d = dir("ingest-txt");
  ingest(d);
  writeFileSync(join(d, "articles/art-2.md"), readFileSync(join(d, "articles/art-2.md"), "utf8").replace("fifty", "sixty"));
  writeFileSync(join(d, "articles/art-77.md"), "x");
  const p = ingest(d, { check: true });
  assert.ok(p.some((m) => /art-2\.md: differs/.test(m)) && p.some((m) => /art-77\.md: not in the source/.test(m)), JSON.stringify(p));
  rmSync(root, { recursive: true });
});

test("source.yaml sha256 must match the vendored file", () => {
  const { root, dir } = setup(), d = dir("ingest-txt");
  editSrc(d, "source.yaml", (t) => t + `sha256: "${"0".repeat(64)}"\n`);
  throwsRe(() => ingest(d), /sha256 differs/);
  rmSync(root, { recursive: true });
});

for (const k of ["official_publisher", "source_url", "retrieval_date", "license"]) {
  test(`source.yaml without ${k} is refused`, () => {
    const { root, dir } = setup(), d = dir("ingest-txt");
    editSrc(d, "source.yaml", (t) => t.replace(new RegExp(`^${k}:.*\\n`, "m"), ""));
    throwsRe(() => ingest(d), new RegExp(`lacks ${k}`));
    rmSync(root, { recursive: true });
  });
}

test("reruns keep a reviewed corpus.yaml and an approved topic index", () => {
  const { root, dir } = setup(), d = dir("ingest-txt");
  ingest(d);
  writeFileSync(join(d, "corpus.yaml"), readFileSync(join(d, "corpus.yaml"), "utf8").replace("status: draft", "status: index_only"));
  rmSync(join(d, "topic-index.draft.yaml")); // a lawyer approved the index
  const ix = readFileSync(join(d, "topic-index.json"), "utf8").replace('"public-notice"', '"edited-by-lawyer"');
  writeFileSync(join(d, "topic-index.json"), ix);
  assert.deepEqual(ingest(d), []);
  assert.match(readFileSync(join(d, "corpus.yaml"), "utf8"), /status: index_only/);
  assert.equal(readFileSync(join(d, "topic-index.json"), "utf8"), ix);
  assert.ok(!existsSync(join(d, "topic-index.draft.yaml")));
  assert.deepEqual(ingest(d, { check: true }), []);
  rmSync(root, { recursive: true });
});

test("the CLI refuses a URL argument", () => {
  const r = spawnSync(process.execPath, [CLI, "https://example.invalid/code.txt"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /offline only/);
});

test("the tool has no network code path", () => {
  const files = ["tools/legal-ingest.mjs", "tools/legal-ingest/html.mjs"].map((f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
  const net = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](?:node:)?(?:https?|http2|net|tls|dns|dgram|undici|axios|node-fetch|got)["']|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/;
  files.forEach((t) => assert.ok(!net.test(t)));
});
