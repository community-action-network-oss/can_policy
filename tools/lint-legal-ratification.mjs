// LEGAL-CORPUS-1 gate (10-u54): review record before ratification, citations resolve, human reviewer.
// CLI: node tools/lint-legal-ratification.mjs [root] [--against <git ref>]
import { parse } from "yaml";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { legalDirs, walk } from "./pack-hash.mjs";
import { splitArticle } from "./lint-legal.mjs";
import { frontMatter } from "./lint-ratifications.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const yml = (f) => parse(readFileSync(f, "utf8")) ?? {};
const md = (d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".md")).sort() : []);
const HUMAN_NO = /\b(claude|gpt|llm|bot|ai)\b/i;
const day = (v) => (v == null ? NaN : Date.parse(v instanceof Date ? v.toISOString() : String(v)));

// Map "L4/nl/statutes" -> corpus facts and its articles (key -> text_sha256).
export function corpusIndex(root) {
  const out = new Map();
  for (const dir of legalDirs(root)) {
    if (!existsSync(join(root, dir, "corpus.yaml"))) continue;
    const c = yml(join(root, dir, "corpus.yaml")), segs = dir.split("/").slice(2);
    const articles = new Map(md(join(root, dir, "articles")).map((f) => [f.slice(0, -3), splitArticle(readFileSync(join(root, dir, "articles", f), "utf8"))?.front?.text_sha256]));
    let hash12 = null;
    try { hash12 = JSON.parse(readFileSync(join(root, dir, "manifest.json"), "utf8")).pack_hash.slice(0, 12); } catch { /* no manifest yet */ }
    out.set([segs[0].slice(0, 2), ...segs.slice(1)].join("/"), { dir, c, articles, hash12 });
  }
  return out;
}

// One citation problem or null. cite = {layer, article_id, corpus_version?}.
export function checkCite(idx, cite, needVersion = true) {
  const id = cite.article_id, cut = id.lastIndexOf("/");
  const k = idx.get(id.slice(0, cut));
  if (!k) return `${id}: no corpus for it in packs/legal`;
  if (!k.articles.has(id.slice(cut + 1))) return `${id}: corpus ${k.c.id} (${k.c.status}) has no such article`;
  if (cite.layer !== k.c.layer) return `${id}: layer ${cite.layer} but the corpus is ${k.c.layer}`;
  if (!needVersion) return null;
  if (cite.corpus_version) {
    const [cid, rest] = String(cite.corpus_version).split("@"), [ver, h] = (rest ?? "").split("+");
    if (cid !== k.c.id || ver !== k.c.version || (h && k.hash12 && h !== k.hash12)) return `${id}: corpus_version ${cite.corpus_version} is not the pinned ${k.c.id}@${k.c.version}${k.hash12 ? "+" + k.hash12 : ""}`;
  } else return `${id}: citation has no corpus_version`;
  return null;
}

const cites = (v, out = []) => {
  if (Array.isArray(v)) v.forEach((x) => cites(x, out));
  else if (v && typeof v === "object") { if (typeof v.article_id === "string") out.push(v); else Object.values(v).forEach((x) => cites(x, out)); }
  return out;
};

// Every citation in decision-points examples, eval sets and prompts.
export function lintCitations(root) {
  const idx = corpusIndex(root), errors = [];
  for (const f of walk(root, "decision-points")) {
    const isPrompt = f.endsWith("/prompt.md"), isData = /\/(examples|eval)\/.*\.(jsonl?|ya?ml)$/.test(f);
    if (!isPrompt && !isData) continue;
    const text = readFileSync(join(root, f), "utf8"), bad = (m) => errors.push(`${f}: unresolved citation ${m}`);
    let found = [];
    try {
      if (isPrompt) found = [...text.matchAll(/\bL[1-6]\/[a-z0-9-]+\/[a-z0-9-]+(?:\/[a-z0-9-]+)+/g)].map((m) => ({ article_id: m[0], layer: m[0].slice(0, 2) }));
      else if (f.endsWith(".jsonl")) found = text.split("\n").filter((l) => l.trim()).flatMap((l) => cites(JSON.parse(l)));
      else found = cites(f.endsWith(".json") ? JSON.parse(text) : parse(text));
    } catch (e) { errors.push(`${f}: cannot read for citation check (${e.message})`); continue; }
    for (const c of found) {
      const m = checkCite(idx, c, !isPrompt);
      if (m) bad(m);
    }
  }
  return errors;
}

export function lintLegalRatification(root, notes = [], { against } = {}) {
  const errors = [], idx = corpusIndex(root);
  const git = (a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const records = new Map(); // corpus id -> ratification front matters
  const rdir = join(root, "ratifications");
  for (const f of md(rdir)) {
    let r; try { r = frontMatter(readFileSync(join(rdir, f), "utf8")); } catch { continue; }
    if (r?.pack) records.set(r.pack, [...(records.get(r.pack) ?? []), { ...r, _f: `ratifications/${f}` }]);
  }
  for (const { dir, c } of idx.values()) {
    const err = (m) => errors.push(`${dir}: ${m}`);
    const recs = records.get(c.id) ?? [];
    const revs = md(join(root, dir, "review")).map((f) => ({ f, front: splitArticle(readFileSync(join(root, dir, "review", f), "utf8"))?.front ?? {} }));
    const complete = revs.filter(({ front: r }) => r.reviewer && r.qualification && r.scope && r.date);
    const gated = c.status === "ratified" || recs.length > 0;
    if (!gated) {
      notes.push(`lint-legal-ratification: note: ${c.id} is ${c.status === "index_only" ? "an index_only stub" : "not ratified"}, unreviewed (reviewed: ${c.reviewed})`);
    }
    for (const { f, front: r } of revs) {
      if (r.authored_by === "ai" && !(r.reviewer && !HUMAN_NO.test(String(r.reviewer?.name ?? r.reviewer)))) err(`review/${f}: authored_by: ai needs a named human reviewer`);
    }
    if (!gated && !against) continue;
    if (gated) {
      const who = recs.length ? recs.map((r) => r._f).join(", ") : "status: ratified";
      if (!complete.length) err(`${who}: no review record in review/*.md with reviewer, qualification, scope and date (LEGAL-CORPUS-1)`);
      for (const { f, front: r } of complete) {
        if (HUMAN_NO.test(String(r.reviewer?.name ?? r.reviewer))) err(`review/${f}: reviewer must be a named human, not '${r.reviewer?.name ?? r.reviewer}'`);
        if (!(day(r.expires) > Date.now())) err(`review/${f}: expires is missing or not in the future`);
        if (r.content_hash !== c.content_hash) err(`review/${f}: content_hash ${String(r.content_hash).slice(0, 12)} is not the corpus content_hash ${c.content_hash.slice(0, 12)}; the corpus changed since the review`);
      }
      if (!existsSync(join(root, dir, "topic-index.json"))) err("missing topic-index.json; topic coverage and topic_ban are rechecked at ratification");
      if (c.reviewed !== true) err("ratification needs reviewed: true in corpus.yaml");
    }
    if (against) {
      let old = null;
      try { old = yml_str(git(["show", `${against}:./${dir}/corpus.yaml`])); } catch { /* new at ref */ }
      if (old && old.content_hash !== c.content_hash && (gated || old.status === "ratified")) {
        let added = [];
        try { added = git(["diff", "--name-status", against, "--", `${dir}/review`]).split("\n").filter((l) => l.startsWith("A\t")); } catch { /* none */ }
        if (!added.length) err(`content_hash changed against ${against} with no new review record in review/ (LEGAL-CORPUS-1)`);
      }
      try {
        const log = git(["log", "--format=%H%x00%B%x01", `${against}..HEAD`, "--", dir]).split("\x01").filter((x) => /^\s*AI-Authored:\s*true\s*$/im.test(x));
        if (log.length && gated && !complete.length) err(`${log.length} commit(s) carry an AI-Authored trailer and the corpus has no human review record`);
      } catch { /* no history range */ }
    }
  }
  errors.push(...lintCitations(root));
  return errors;
}
const yml_str = (t) => parse(t) ?? {};

// Replay support: flips and past-resolution estimate by layer and article. decisions/heads carry legal_cites.
export function legalFlips(flips, decisions, heads, baseRoot, headRoot) {
  const bi = baseRoot ? corpusIndex(baseRoot) : null, hi = corpusIndex(headRoot);
  const changed = (a) => {
    if (!bi) return null;
    const cut = a.lastIndexOf("/"), p = a.slice(0, cut), k = a.slice(cut + 1);
    return bi.get(p)?.articles.get(k) !== hi.get(p)?.articles.get(k);
  };
  const cited = (id) => [...(decisions.get(id)?.legal_cites ?? []), ...(heads.get(id)?.legal_cites ?? [])].map((c) => c.article_id);
  const by_layer = {}, by_article = {}, touched = new Set();
  for (const f of flips) for (const a of new Set(cited(f.decision_id))) {
    (by_layer[a.slice(0, 2)] ??= { flips: 0 }).flips++;
    (by_article[a] ??= { flips: 0 }).flips++;
  }
  const changedArticles = {};
  for (const [id, d] of decisions) for (const a of new Set(cited(id))) if (changed(a) !== false) { touched.add(id); changedArticles[a] = (changedArticles[a] ?? 0) + 1; }
  return { by_layer, by_article, changed_article_basis: bi ? "base vs head text_sha256" : "no --base: every cited article counts as changed", resolutions_touched: touched.size, resolutions_touched_by_article: changedArticles };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), i = args.indexOf("--against");
  const against = i >= 0 ? args[i + 1] : undefined;
  const root = resolve(args.find((a, j) => !a.startsWith("--") && j !== i + 1) ?? join(HERE, ".."));
  const notes = [], errs = lintLegalRatification(root, notes, { against });
  notes.forEach((n) => console.log(n));
  errs.forEach((x) => console.error("lint-legal-ratification: " + x));
  console.log(errs.length ? `lint-legal-ratification: ${errs.length} error(s)` : "lint-legal-ratification: ok");
  process.exit(errs.length ? 1 : 0);
}
