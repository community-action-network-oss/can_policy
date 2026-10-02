// Legal corpus lint (10-u41, LEGAL-SOURCE-1). lintLegal(root) returns readable errors; no-op when packs/legal is absent.
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { legalDirs, sha256 } from "./pack-hash.mjs";

const S = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
const ajv = new Ajv2020({ allErrors: true });
const load = (n) => ajv.compile(JSON.parse(readFileSync(join(S, n), "utf8")));
const corpusV = load("legal-corpus.schema.json"), articleV = load("legal-article.schema.json"), indexV = load("topic-index.schema.json");
const fmt = (errs) => errs.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
const bytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const REQUIRED = ["id", "layer", "jurisdiction", "instrument", "official_publisher", "source_url", "retrieval_date", "version", "effective_from", "effective_to", "language", "license", "content_hash", "status", "reviewed", "reviewer"];

// Frontmatter and body of a markdown file. Body is every byte after the closing "---" line, CRLF as LF.
export function splitArticle(text) {
  const t = text.replaceAll("\r\n", "\n");
  const m = t.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  return m ? { front: parse(m[1]), body: m[2] } : null;
}
const listMd = (d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".md")).sort(bytes) : []);

export function lintLegal(root) {
  const errors = [];
  for (const dir of legalDirs(root)) {
    const err = (m) => errors.push(`${dir}: ${m}`);
    const abs = join(root, dir), segs = dir.split("/").slice(2); // [layer dir, jurisdiction, ...corpus]
    const lay = segs[0].match(/^(L[1-6])-/)?.[1];
    if (!lay || segs.length < 3) { err("path must be packs/legal/<L1..L6>-<name>/<jurisdiction>/<corpus>"); continue; }
    const prefix = [lay, ...segs.slice(1)].join("/"), id = segs.slice(1).join("-");
    // corpus.yaml
    if (!existsSync(join(abs, "corpus.yaml"))) { err("missing corpus.yaml (LEGAL-SOURCE-1)"); continue; }
    let c;
    try { c = parse(readFileSync(join(abs, "corpus.yaml"), "utf8")); } catch (e) { err(`corpus.yaml: invalid YAML (${e.message})`); continue; }
    const missing = REQUIRED.filter((k) => c?.[k] === undefined);
    if (missing.length) { err(`corpus.yaml: missing provenance field(s) ${missing.join(", ")} (LEGAL-SOURCE-1)`); continue; }
    if (!corpusV(c)) { err(`corpus.yaml: fails corpus schema: ${fmt(corpusV.errors)}`); continue; }
    if (c.layer !== lay) err(`corpus.yaml: layer ${c.layer} does not match its directory (${lay})`);
    if (c.jurisdiction !== segs[1]) err(`corpus.yaml: jurisdiction ${c.jurisdiction} does not match its directory (${segs[1]})`);
    if (c.id !== id) err(`corpus.yaml: id must be ${id}`);
    if ((c.translations ?? []).some((t) => t.language === c.language)) err(`corpus.yaml: translation in the authoritative language ${c.language}; a translation is never the authority`);
    // pack.yaml agrees with corpus.yaml
    if (existsSync(join(abs, "pack.yaml"))) {
      const y = parse(readFileSync(join(abs, "pack.yaml"), "utf8"));
      if (y?.version !== c.version) err(`pack.yaml version ${y?.version} differs from corpus.yaml version ${c.version}`);
      if (y?.effective_from !== c.effective_from) err("pack.yaml effective_from differs from corpus.yaml");
      if ((c.status === "ratified") !== (y?.status === "ratified")) err("pack.yaml status must be ratified exactly when corpus.yaml status is ratified");
    }
    // articles
    const keys = [], bodies = [];
    for (const f of listMd(join(abs, "articles"))) {
      const key = f.slice(0, -3), rel = `articles/${f}`;
      const a = splitArticle(readFileSync(join(abs, rel), "utf8"));
      if (!a || !a.front) { err(`${rel}: missing frontmatter`); continue; }
      if (a.front.topic_ban !== undefined) { err(`${rel}: topic_ban is never set in an article, only in topic-index.json`); continue; }
      if (!a.front.source_locator) { err(`${rel}: missing source_locator`); continue; }
      if (!articleV(a.front)) { err(`${rel}: fails article schema: ${fmt(articleV.errors)}`); continue; }
      if (a.front.article_key !== key) err(`${rel}: article_key must equal the file name (${key})`);
      if (a.front.article_id !== `${prefix}/${key}`) err(`${rel}: article_id must be ${prefix}/${key}`);
      if (a.front.language !== c.language) err(`${rel}: language ${a.front.language} is not the authoritative language ${c.language}; a translation cannot be the cited text`);
      if (sha256(a.body) !== a.front.text_sha256) err(`${rel}: text_sha256 does not match the article text`);
      keys.push(`${prefix}/${key}`); bodies.push(a.body);
    }
    if (c.status !== "index_only") {
      if (!keys.length) err("no articles");
      if (!existsSync(join(abs, "sources")) || !readdirSync(join(abs, "sources")).some((f) => !f.startsWith("."))) err("sources/ must hold the vendored official file (LEGAL-SOURCE-1)");
    }
    if (keys.length && sha256(bodies.join("")) !== c.content_hash) err("content_hash does not match the concatenated article texts in key order");
    // topic index
    const ip = join(abs, "topic-index.json");
    if (!existsSync(ip)) { if (keys.length) err("missing topic-index.json"); }
    else {
      let ix; try { ix = JSON.parse(readFileSync(ip, "utf8")); } catch (e) { err(`topic-index.json: not valid JSON (${e.message})`); ix = null; }
      if (ix && !indexV(ix)) err(`topic-index.json: fails topic index schema: ${fmt(indexV.errors)}`);
      else if (ix) {
        const count = new Map();
        for (const e of ix) {
          count.set(e.article_id, (count.get(e.article_id) ?? 0) + 1);
          if (!keys.includes(e.article_id)) err(`topic-index.json: ${e.article_id} does not resolve to an article`);
          if (e.topic_ban === true && c.reviewed !== true) err(`topic-index.json: ${e.article_id} sets topic_ban but corpus.yaml has reviewed: false`);
        }
        for (const k of keys) if (count.get(k) !== 1) err(`topic-index.json: article ${k} must be covered by exactly one entry (found ${count.get(k) ?? 0})`);
      }
    }
    // review records
    const recs = listMd(join(abs, "review")).map((f) => splitArticle(readFileSync(join(abs, "review", f), "utf8"))?.front);
    const complete = recs.some((r) => r && r.reviewer && r.qualification && r.scope && r.date);
    if ((c.status === "ratified" || c.reviewed === true) && !complete) err(`${c.status === "ratified" ? "status: ratified" : "reviewed: true"} needs a review record in review/*.md with reviewer, qualification, scope and date`);
    if (c.status === "ratified" && (c.reviewed !== true || c.reviewer === "none")) err("status: ratified needs reviewed: true and a reviewer record");
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errs = lintLegal(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
  errs.forEach((e) => console.error("lint-legal: " + e));
  process.exit(errs.length ? 1 : 0);
}
