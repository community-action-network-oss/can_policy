// Legal ingest (10-u42): vendored official source -> articles/*.md, corpus.yaml skeleton, draft topic-index.json.
// Offline and deterministic. Article text is copied byte for byte (CRLF to LF only), LEGAL-SOURCE-1.
// Usage: node tools/legal-ingest.mjs <corpus-dir> [--check]
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { sha256 } from "./pack-hash.mjs";
import { htmlToText } from "./legal-ingest/html.mjs";

const bytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const yml = (o) => stringify(o, { lineWidth: 0 });
const PROVENANCE = ["official_publisher", "source_url", "retrieval_date", "license"];
const DRAFT_MARKER = "topic-index.draft.yaml";

function fail(msg) { throw new Error(msg); }

// Text of the source in the form articles are cut from: LF only, HTML reduced to text.
function loadSource(dir) {
  const sp = join(dir, "sources", "source.yaml");
  if (!existsSync(sp)) fail("sources/source.yaml is missing");
  const src = parse(readFileSync(sp, "utf8")) ?? {};
  const missing = PROVENANCE.filter((k) => !src[k]);
  if (missing.length) fail(`source.yaml lacks ${missing.join(", ")} (LEGAL-SOURCE-1); provenance is never invented`);
  for (const k of ["instrument", "version", "effective_from", "file", "format", "split"]) if (!src[k]) fail(`source.yaml lacks ${k}`);
  if (!["txt", "html"].includes(src.format)) fail("source.yaml format must be txt or html");
  if (!src.split.heading || !src.split.language) fail("source.yaml split needs heading and language");
  if (/^[a-z][a-z0-9+.-]*:/i.test(src.file) || src.file.includes("..") || src.file.startsWith("/")) fail("source.yaml file must be a plain path inside sources/ (offline only)");
  const fp = join(dir, "sources", src.file);
  if (!existsSync(fp)) fail(`sources/${src.file} is missing; vendor the official file first (docs/legal-corpora.md)`);
  const raw = readFileSync(fp);
  if (src.sha256 && sha256(raw) !== src.sha256) fail(`sources/${src.file} sha256 differs from source.yaml; the vendored file changed`);
  const lf = raw.toString("utf8").replaceAll("\r\n", "\n");
  return { src, text: src.format === "html" ? htmlToText(lf) : lf };
}

// Layer, jurisdiction and corpus path come from the directory: .../packs/legal/<L#-name>/<jurisdiction>/<corpus...>
function identity(dir) {
  const segs = resolve(dir).split(sep);
  const i = segs.lastIndexOf("legal");
  const rest = i > 0 && segs[i - 1] === "packs" ? segs.slice(i + 1) : [];
  const layer = rest[0]?.match(/^(L[1-6])-/)?.[1];
  if (!layer || rest.length < 3) fail("corpus dir must be packs/legal/<L1..L6>-<name>/<jurisdiction>/<corpus>");
  return { layer, jurisdiction: rest[1], id: rest.slice(1).join("-"), prefix: [layer, ...rest.slice(1)].join("/") };
}

export function split(text, src, prefix) {
  const head = new RegExp(src.split.heading), chap = src.split.chapter ? new RegExp(src.split.chapter) : null;
  const group = src.split.number_group ?? 1;
  const cuts = []; // {at, end?, key?, heading?, chapter}
  let off = 0, chapter = null;
  for (const line of text.split("\n")) {
    const h = head.exec(line), c = chap?.exec(line);
    if (h) {
      const num = h[group];
      if (!num) fail(`heading "${line}" has no number in group ${group}`);
      const key = "art-" + num.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
      cuts.push({ at: off, key, heading: line.trim(), chapter });
    } else if (c) {
      cuts.push({ at: off, stop: true });
      chapter = (c[1] ?? c[0]).trim();
    }
    off += line.length + 1;
  }
  const arts = [], seen = new Set();
  cuts.forEach((c, i) => {
    if (c.stop) return;
    const end = i + 1 < cuts.length ? cuts[i + 1].at : text.length;
    if (seen.has(c.key)) fail(`duplicate article heading ${c.key} ("${c.heading}")`);
    seen.add(c.key);
    const body = text.slice(c.at, end);
    const b0 = Buffer.byteLength(text.slice(0, c.at)), b1 = b0 + Buffer.byteLength(body);
    const loc = `sources/${src.file}${c.chapter ? `, chapter ${c.chapter}` : ""}, bytes ${b0}-${b1} of ${src.format === "html" ? "extracted" : "LF"} text`;
    arts.push({ key: c.key, body, front: { article_id: `${prefix}/${c.key}`, article_key: c.key, heading: c.heading, language: src.split.language, source_locator: loc, text_sha256: sha256(body) } });
  });
  if (!arts.length) fail("no article heading matched split.heading");
  return arts.sort((a, b) => bytes(`${a.key}.md`, `${b.key}.md`)); // same order the lint uses
}

function topicIndex(arts, dir, prefix) {
  const sp = join(dir, "topics.seed.yaml");
  const seed = existsSync(sp) ? (parse(readFileSync(sp, "utf8"))?.topics ?? {}) : {};
  const rules = Object.keys(seed).sort(bytes).map((t) => [t, new RegExp(`(?<![\\p{L}\\p{N}])(?:${seed[t].map((w) => String(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}])`, "iu")]);
  return arts.map((a) => ({
    article_id: `${prefix}/${a.key}`,
    topics: rules.filter(([, re]) => re.test(a.body)).map(([t]) => t),
    actors: [], actions: [], constraint_kinds: [], always_for_dps: [], topic_ban: false, // a lawyer decides any ban (LEGAL-CORPUS-1)
  }));
}

// Expected file contents, relative to the corpus dir. Existing corpus.yaml and pack.yaml are kept (only content_hash moves),
// and an approved topic index (marker deleted) is never touched.
export function plan(dir) {
  const { src, text } = loadSource(dir), id = identity(dir);
  const arts = split(text, src, id.prefix), files = new Map();
  for (const a of arts) files.set(`articles/${a.key}.md`, `---\n${yml(a.front)}---\n${a.body}`);
  const contentHash = sha256(arts.map((a) => a.body).join(""));
  const cp = join(dir, "corpus.yaml");
  if (existsSync(cp)) files.set("corpus.yaml", readFileSync(cp, "utf8").replace(/^content_hash:.*$/m, yml({ content_hash: contentHash }).trim()));
  else {
    const c = { id: id.id, layer: id.layer, jurisdiction: id.jurisdiction, instrument: src.instrument, official_publisher: src.official_publisher, source_url: src.source_url, retrieval_date: src.retrieval_date, version: src.version, effective_from: src.effective_from, effective_to: src.effective_to ?? null, language: src.split.language };
    if (src.translations) c.translations = src.translations;
    Object.assign(c, { license: src.license, content_hash: contentHash });
    if (src.mode) c.mode = src.mode;
    Object.assign(c, { status: "draft", reviewed: false, reviewer: "none" });
    if (src.fictional) c.fictional = true;
    files.set("corpus.yaml", yml(c));
  }
  if (!existsSync(join(dir, "pack.yaml"))) files.set("pack.yaml", yml({ name: id.id, version: src.version, layer: "legal", parent: null, jurisdiction: id.jurisdiction, effective_from: src.effective_from, status: "draft" }));
  const draft = existsSync(join(dir, DRAFT_MARKER)) || !existsSync(join(dir, "topic-index.json"));
  if (draft) {
    files.set("topic-index.json", JSON.stringify(topicIndex(arts, dir, id.prefix), null, 2) + "\n");
    files.set(DRAFT_MARKER, "# Generated by tools/legal-ingest.mjs. Keyword matches only; a lawyer approves this index (LEGAL-CORPUS-1).\n# Delete this file when the index is approved; the tool then never rewrites topic-index.json.\ndraft: true\n");
  }
  return files;
}

// Returns problems (empty when the tree matches the source). With check false, writes the tree first.
export function ingest(dir, { check = false } = {}) {
  const files = plan(dir), problems = [];
  const adir = join(dir, "articles");
  const stale = existsSync(adir) ? readdirSync(adir).filter((f) => f.endsWith(".md") && !files.has(`articles/${f}`)) : [];
  if (check) {
    for (const [rel, want] of files) {
      const p = join(dir, rel);
      if (!existsSync(p)) problems.push(`${rel}: missing`);
      else if (readFileSync(p, "utf8").replaceAll("\r\n", "\n") !== want) problems.push(`${rel}: differs from the source`);
    }
    stale.forEach((f) => problems.push(`articles/${f}: not in the source`));
    return problems;
  }
  mkdirSync(adir, { recursive: true });
  stale.forEach((f) => rmSync(join(adir, f)));
  for (const [rel, body] of files) writeFileSync(join(dir, rel), body);
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), check = args.includes("--check"), dirs = args.filter((a) => a !== "--check");
  try {
    if (dirs.length !== 1) fail("usage: node tools/legal-ingest.mjs <corpus-dir> [--check]");
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(dirs[0])) fail("offline only: this tool refuses URLs; vendor the file by hand (docs/legal-corpora.md)");
    const problems = ingest(dirs[0], { check });
    problems.forEach((p) => console.error("legal-ingest: " + p));
    if (problems.length) process.exit(1);
    console.log(check ? "legal-ingest: articles match the source" : "legal-ingest: wrote articles, corpus.yaml and draft topic index");
  } catch (e) {
    console.error("legal-ingest: " + e.message);
    process.exit(1);
  }
}
