// Lint and tests for the synthetic archive eval set (13-u18). tools/lint.mjs is not in this unit's writes, so the lint lives here
// (as in schema-archive-content.test.mjs) and runs inside `npm run test`, which `npm run verify` runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const J = (p) => JSON.parse(readFileSync(p, "utf8"));
const PERSONAL = /[@＠]|:\/\/|www\.|http|\d{7}/i; // same shape as tools/lint-candidates.mjs
const DASH = /[—–]/;
// Personal-data and real-incident deny-list: titles before names, street addresses, phone and id words.
const DENY = [/\b(Mr|Mrs|Ms|Dr|Mevrouw|Meneer|Heer|Mw)\.?\s+[A-Z][a-z]+/, /\b\d{1,4}[a-z]?\s+[A-Z][a-z]+(straat|laan|gracht|street|road|avenue)\b/i, /\b(bsn|passport|iban|whatsapp|telegram|instagram)\b/i];
const DIMS_OK = ["problem_type", "constraints", "resources_budget", "scale", "geography_climate", "institutions", "legal_stack", "language"];
const BANDS = ["none", "<1k", "<10k", "<100k", ">=100k"], PEOPLE = ["none", "<5", "<20", ">=20"], POP = ["<100", "<1k", "<10k", "<100k", "<1M", ">=1M", "unknown"];

const mkAjv = () => {
  const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
  ["version", "pack", "x-ui", "x-guidance", "x-checks", "x-version"].forEach((keyword) => ajv.addKeyword({ keyword }));
  return ajv;
};
const fmt = (errs) => errs.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");

// Explanation truth, one function so data and checker cannot drift.
export const dimValue = (c, d) => ({
  problem_type: () => c.problem_type,
  constraints: () => [...new Set(c.constraints.map((x) => x.type))].sort().join(","),
  resources_budget: () => `${c.resource_band.people}|${c.budget_band.band}`,
  scale: () => c.population_scale,
  geography_climate: () => `${c.geography.settlement_class}|${c.geography.climate_class}`,
  institutions: () => [...c.institutions].sort().join(","),
  legal_stack: () => c.legal_stack.map((s) => `${s.layer}:${s.corpus_version}`).join(","),
  language: () => c.language,
}[d]());
export const dimVerdict = (q, r, d) => {
  const a = dimValue(q, d), b = dimValue(r, d);
  if (a === b) return "same";
  if (d === "problem_type" || d === "language") return "different";
  if (d === "scale") return Math.abs(POP.indexOf(q.population_scale) - POP.indexOf(r.population_scale)) <= 1 ? "close" : "different";
  if (d === "resources_budget") return Math.abs(PEOPLE.indexOf(q.resource_band.people) - PEOPLE.indexOf(r.resource_band.people)) <= 1 && Math.abs(BANDS.indexOf(q.budget_band.band) - BANDS.indexOf(r.budget_band.band)) <= 1 ? "close" : "different";
  if (d === "geography_climate") return q.geography.settlement_class === r.geography.settlement_class || q.geography.climate_class === r.geography.climate_class ? "close" : "different";
  const sa = new Set(a.split(",")), sb = new Set(b.split(",")), inter = [...sa].filter((x) => sb.has(x)).length;
  if (d === "legal_stack") {
    const ca = new Set(q.legal_stack.map((s) => s.corpus_version.split("@")[0])), cb = new Set(r.legal_stack.map((s) => s.corpus_version.split("@")[0]));
    const same = ca.size === cb.size && [...ca].every((x) => cb.has(x));
    return same || (inter > 0 && q.legal_stack.map((s) => s.layer).join() === r.legal_stack.map((s) => s.layer).join()) ? "close" : "different";
  }
  return inter > 0 ? "close" : "different";
};

// Structured identifiers (corpus pins contain '@', URIs are host-checked separately), not free text.
const STRUCTURED = new Set(["uri", "source_url", "corpus_version", "policy_version", "source_corpus_version", "target_corpus_version", "query_value", "record_value"]);
const strings = (v, key = "", out = []) => {
  if (typeof v === "string") { if (!STRUCTURED.has(key)) out.push(v); }
  else if (Array.isArray(v)) v.forEach((x) => strings(x, key, out));
  else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => strings(x, k, out));
  return out;
};
const uris = (v, out = []) => {
  if (Array.isArray(v)) v.forEach((x) => uris(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (k === "uri" || k === "source_url") && typeof x === "string" ? out.push(x) : uris(x, out);
  return out;
};
const frontMatter = (f) => parse(readFileSync(f, "utf8").split("---")[1]);

// lintEvalArchive(root, dir) returns readable errors. dir defaults to <root>/evals/archive.
export function lintEvalArchive(root = ROOT, dir = join(root, "evals", "archive")) {
  const errors = [], err = (m) => errors.push(m);
  const limits = parse(readFileSync(join(root, "limits.yaml"), "utf8"));
  const arch = limits.archive;
  const schema = J(join(root, "schemas", "eval-archive.schema.json"));
  const evalV = new Ajv2020({ strict: true, strictTypes: true, strictRequired: true, allErrors: true }).compile(schema); // schemas stay strict, strictTypes and strictRequired
  const ajv = mkAjv();
  const arSchema = J(join(root, "content-schemas", "archive_record", "schema.json"));
  const { id: _drop, ...arBody } = arSchema;
  ajv.addSchema({ ...arBody, $id: "archive_record" });
  const recV = ajv.getSchema("archive_record"), ctxV = ajv.getSchema("archive_record#/properties/context_profile");

  // jurisdiction facts straight from the packs
  const stacks = {}, raw = {};
  for (const id of ["nl-amsterdam", "fiktiva-city", "fiktiva-north"]) {
    const y = parse(readFileSync(join(root, "packs", "jurisdictions", id, "pack.yaml"), "utf8"));
    raw[id] = y.legal_stack;
    stacks[id] = Object.fromEntries(y.legal_stack.filter((l) => l.corpus).map((l) => [l.layer, `${l.corpus}@${l.version}+${l.pack_hash.slice(0, 12)}`]));
  }

  // thresholds
  const th = parse(readFileSync(join(dir, "thresholds.yaml"), "utf8"));
  if (!evalV(th)) err(`thresholds.yaml fails eval-archive schema: ${fmt(evalV.errors)}`);
  const pathIn = (p) => p.split(".").reduce((o, k) => o?.[k], limits);
  for (const p of th.limits_used ?? []) if (pathIn(p) === undefined) err(`thresholds.yaml: limits_used '${p}' is not in limits.yaml`);
  for (const p of [th.recall_at_k?.k_from_limit, th.cross_language_recall_gap?.floor_from_limit]) if (p && !(th.limits_used ?? []).includes(p)) err(`thresholds.yaml: '${p}' must also be listed in limits_used`);
  if (th.recall_at_k?.k !== undefined) err("thresholds.yaml: recall_at_k.k must come from limits (k_from_limit), not a literal");
  const DIMS = Object.keys(arch.rank_weights).filter((k) => !["provisional", "note"].includes(k));
  if (JSON.stringify([...DIMS].sort()) !== JSON.stringify([...DIMS_OK].sort())) err(`limits archive.rank_weights dimensions changed (${DIMS.join(",")}); update the explanation truth in test/eval-archive.test.mjs and the pairs in fit/differences.json`);

  // records
  const recFiles = readdirSync(join(dir, "records")).filter((f) => f.endsWith(".json"));
  const recs = {};
  for (const f of recFiles) {
    let r; try { r = J(join(dir, "records", f)); } catch (e) { err(`records/${f}: not valid JSON`); continue; }
    if (r.id + ".json" !== f) err(`records/${f}: file name must be the record id`);
    if (!recV(r)) { err(`records/${f}: fails archive_record schema: ${fmt(recV.errors)}`); continue; }
    if (r.source !== "simulation") err(`records/${f}: source must be 'simulation'`);
    recs[r.id] = r;
    const names = new Set(r.executed_path.map((s) => s.name));
    for (const s of r.executed_path) if ((s.outcome === "blocked" || s.outcome === "abandoned") && !r.challenges.some((c) => c.stage === s.name)) err(`records/${f}: ARCHIVE-1 stage ${s.name} is ${s.outcome} with no challenge`);
    for (const c of r.challenges) if (!names.has(c.stage)) err(`records/${f}: challenge stage ${c.stage} not in executed_path`);
    if (r.terminal_state === "stuck" && r.outcome.unresolved !== true) err(`records/${f}: stuck needs unresolved true`);
    for (const s of r.executed_path) for (const d of s.depends_on) if (!names.has(d)) err(`records/${f}: ${s.name} depends on unknown ${d}`);
  }
  if (recFiles.length < (th.min_sizes?.records ?? 24)) err(`only ${recFiles.length} records, minimum is ${th.min_sizes?.records}`);
  const meta = J(join(dir, "record-meta.json"));
  if (!evalV(meta)) err(`record-meta.json fails eval-archive schema: ${fmt(evalV.errors)}`);
  const metaBy = Object.fromEntries((meta.records ?? []).map((m) => [m.id, m]));
  for (const id of Object.keys(recs)) if (!metaBy[id]) err(`record ${id} has no entry in record-meta.json`);
  for (const id of Object.keys(metaBy)) if (!recs[id]) err(`record-meta.json: ${id} has no record file`);
  const variants = new Set((meta.records ?? []).map((m) => m.variant)), jurs = new Set((meta.records ?? []).map((m) => m.jurisdiction)), seeds = new Set((meta.records ?? []).map((m) => m.seed));
  for (const v of ["happy", "revise", "stuck", "blocked", "redirected"]) if (!variants.has(v)) err(`no record with variant ${v}`);
  for (const j of ["nl-amsterdam", "fiktiva-city", "fiktiva-north"]) if (!jurs.has(j)) err(`no record for ${j}`);
  if (seeds.size < 2) err("records must derive from seeds 1 and 2");
  // record legal stacks match the current pins unless marked stale
  for (const m of meta.records ?? []) {
    const r = recs[m.id]; if (!r) continue;
    for (const s of r.context_profile.legal_stack) {
      const want = stacks[m.jurisdiction][s.layer];
      if (s.corpus_version === m.stale_pin?.corpus_version && s.layer === m.stale_pin.layer) continue;
      if (s.corpus_version !== want) err(`record ${m.id}: ${s.layer} corpus_version '${s.corpus_version}' is not the ${m.jurisdiction} pin '${want}'`);
    }
    if (m.stale_pin && !r.context_profile.legal_stack.some((s) => s.layer === m.stale_pin.layer && s.corpus_version === m.stale_pin.corpus_version)) err(`record ${m.id}: stale_pin not present in its legal_stack`);
  }

  // queries
  const queries = [];
  for (const f of readdirSync(join(dir, "queries")).filter((n) => n.endsWith(".json"))) {
    const d = J(join(dir, "queries", f));
    if (!evalV(d)) { err(`queries/${f} fails eval-archive schema: ${fmt(evalV.errors)}`); continue; }
    queries.push(...d.queries);
  }
  const qBy = {}; const seen = new Set();
  for (const q of queries) { if (seen.has(q.id)) err(`duplicate query id ${q.id}`); seen.add(q.id); qBy[q.id] = q; }
  if (queries.length < (th.min_sizes?.queries ?? 30)) err(`only ${queries.length} queries, minimum is ${th.min_sizes?.queries}`);
  for (const q of queries) {
    let canon; try { canon = Intl.getCanonicalLocales(q.language)[0]; } catch { canon = null; }
    if (canon !== q.language) err(`query ${q.id}: '${q.language}' is not a canonical BCP 47 tag`);
    if (!ctxV(q.context_profile)) err(`query ${q.id}: context_profile invalid: ${fmt(ctxV.errors)}`);
    else {
      if (q.context_profile.language !== q.language) err(`query ${q.id}: context_profile.language differs from language`);
      const stack = Object.entries(stacks[q.jurisdiction]).map(([layer, corpus_version]) => ({ layer, corpus_version }));
      if (q.seed_condition !== "none" || q.group !== "distractor" || true) if (JSON.stringify(q.context_profile.legal_stack) !== JSON.stringify(stack)) err(`query ${q.id}: legal_stack is not the ${q.jurisdiction} pin`);
    }
    const ids = q.judgments.map((j) => j.record_id);
    for (const id of ids) if (!recs[id]) err(`query ${q.id}: judgment refers to unknown record ${id}`);
    if (new Set(ids).size !== ids.length) err(`query ${q.id}: duplicate judgments`);
    const rel = q.judgments.filter((j) => j.grade > 0).map((j) => j.record_id).sort();
    if (JSON.stringify(rel) !== JSON.stringify([...q.relevant_record_ids].sort())) err(`query ${q.id}: relevant_record_ids differ from judgments with grade above 0`);
    if (q.expect_empty !== (rel.length === 0)) err(`query ${q.id}: expect_empty must be true exactly when nothing is relevant`);
    if (q.group === "distractor" && !q.distractor) err(`query ${q.id}: distractor needs a distractor block`);
    if (q.group === "translation" && !q.translation) err(`query ${q.id}: translation needs a translation block`);
    if (q.translation && ["sw", "hi"].includes(q.language) && (q.translation.method !== "machine" || q.translation.reviewed !== false)) err(`query ${q.id}: ${q.language} must be marked machine and unreviewed`);
    for (const k of ["paraphrase_of", "translation_of"]) if (q[k]) {
      const s = qBy[q[k]];
      if (!s) err(`query ${q.id}: ${k} '${q[k]}' does not exist`);
      else if (JSON.stringify([...s.judgments].sort((a, b) => a.record_id.localeCompare(b.record_id))) !== JSON.stringify([...q.judgments].sort((a, b) => a.record_id.localeCompare(b.record_id)))) err(`query ${q.id}: judgments must equal those of ${q[k]} (needed for the cross-language gap)`);
    }
  }
  const langs = new Set(queries.map((q) => q.language));
  for (const l of ["nl", "en", "sw", "hi"]) if (!langs.has(l)) err(`no query in language ${l}`);
  for (const g of ["core", "paraphrase", "translation", "distractor"]) if (!queries.some((q) => q.group === g)) err(`no ${g} queries`);
  for (const k of ["same_words_different_type", "same_type_incompatible_legal_stack"]) if (!queries.some((q) => q.distractor?.kind === k)) err(`no distractor of kind ${k}`);
  for (const s of ["seed-1", "seed-2"]) if (!queries.some((q) => q.seed_condition === s && q.group === "paraphrase")) err(`no paraphrase of ${s}`);

  // fit: legality
  const leg = J(join(dir, "fit", "legality.json"));
  if (!evalV(leg)) err(`fit/legality.json fails eval-archive schema: ${fmt(evalV.errors)}`);
  const covered = new Set();
  for (const c of leg.cases ?? []) {
    const m = /^unlawful_at_(L[1-6])$/.exec(c.expected_result);
    if (m) {
      covered.add(m[1]);
      if (!c.expected_citation) err(`fit ${c.id}: unlawful case needs expected_citation`);
      else if (c.expected_citation.layer !== m[1]) err(`fit ${c.id}: citation layer ${c.expected_citation.layer} differs from result ${c.expected_result}`);
    }
    const cit = c.expected_citation;
    if (cit) {
      const [layer, ...rest] = cit.article_id.split("/"), key = rest.pop(), corpusId = rest.join("-");
      if (layer !== cit.layer) err(`fit ${c.id}: article_id layer prefix differs from layer`);
      if (cit.corpus_version !== stacks[c.target_jurisdiction]?.[cit.layer]) err(`fit ${c.id}: corpus_version '${cit.corpus_version}' is not the ${c.target_jurisdiction} ${cit.layer} pin`);
      if (!cit.corpus_version?.startsWith(corpusId + "@")) err(`fit ${c.id}: corpus_version does not name corpus ${corpusId}`);
      const dirs = readdirSync(join(root, "packs", "legal")).filter((n) => n.startsWith(layer + "-")).map((n) => join(root, "packs", "legal", n, rest[0], rest.slice(1).join("/"), "articles", key + ".md"));
      const file = dirs.find((p) => existsSync(p));
      if (!file) err(`fit ${c.id}: article ${cit.article_id} does not resolve to a file`);
      else if (frontMatter(file).article_id !== cit.article_id) err(`fit ${c.id}: article front matter id differs from ${cit.article_id}`);
    }
  }
  for (const l of ["L2", "L3", "L4", "L5", "L6"]) if (!covered.has(l)) err(`no planted illegal-at-${l} case`);
  // Silence is not permission (DP-LEGALITY): lawful needs a cited article; a reference layer informs but never makes a stage unlawful (legal-stack.md).
  const refLayer = (jur, layer) => raw[jur]?.find((l) => l.layer === layer)?.mode === "reference";
  for (const c of leg.cases ?? []) {
    if (c.expected_result === "lawful" && !c.expected_citation) err(`fit ${c.id}: lawful with no citation rests on silence (none_found), expected unknown`);
    const m = /^unlawful_at_(L[1-6])$/.exec(c.expected_result);
    if (m && refLayer(c.target_jurisdiction, m[1])) err(`fit ${c.id}: ${m[1]} is a reference layer for ${c.target_jurisdiction}, it cannot make an option unlawful`);
  }
  if (!(leg.cases ?? []).some((c) => c.expected_result === "unknown" && c.expected_citation?.layer === "L1")) err("fit/legality.json needs a reference-layer L1 case expected as unknown");
  for (const r of Object.values(recs)) for (const o of r.options ?? []) {
    const jur = metaBy[r.id]?.jurisdiction, c = (leg.cases ?? []).find((x) => x.target_jurisdiction === jur && x.option_summary === o.summary);
    if (o.legality === "lawful" && c && !c.expected_citation) err(`record ${r.id}: option '${o.summary}' is lawful by silence only`);
    const m = /^unlawful_at_(L[1-6])$/.exec(o.legality ?? "");
    if (m && refLayer(jur, m[1])) err(`record ${r.id}: ${m[1]} is a reference layer, option cannot be ${o.legality}`);
  }
  if (!(leg.cases ?? []).some((c) => c.expected_result === "lawful")) err("fit/legality.json needs at least one lawful control");

  // fit: budget
  const bud = J(join(dir, "fit", "budget.json"));
  if (!evalV(bud)) err(`fit/budget.json fails eval-archive schema: ${fmt(evalV.errors)}`);
  const decl = { "nl-amsterdam": { b: "<100k", p: "<20" }, "fiktiva-city": { b: "<10k", p: "<20" }, "fiktiva-north": { b: "<1k", p: "<5" } };
  const ctxFx = parse(readFileSync(join(root, "packs", "jurisdictions", "fiktiva-north", "context-fixtures.yaml"), "utf8"));
  if (ctxFx.typical_problem.budget_band !== decl["fiktiva-north"].b) err("context-fixtures.yaml north budget band changed; update fit/budget.json");
  for (const c of bud.cases ?? []) {
    const r = recs[c.source_record_id];
    if (!r) { err(`fit ${c.id}: unknown record ${c.source_record_id}`); continue; }
    const need = { budget_band: r.context_profile.budget_band.band, resource_people: r.context_profile.resource_band.people };
    if (JSON.stringify(need) !== JSON.stringify(c.source_need)) err(`fit ${c.id}: source_need differs from the record`);
    const dims = [];
    if (BANDS.indexOf(need.budget_band) > BANDS.indexOf(c.declared.budget_band)) dims.push("budget_band");
    if (PEOPLE.indexOf(need.resource_people) > PEOPLE.indexOf(c.declared.resource_people)) dims.push("resource_band");
    if (c.declared.budget_band !== decl[c.target_jurisdiction]?.b || c.declared.resource_people !== decl[c.target_jurisdiction]?.p) err(`fit ${c.id}: declared context differs from the ${c.target_jurisdiction} typical context`);
    if (c.expected_fit !== (dims.length ? "exceeds" : "fits") || JSON.stringify(c.gap_dimensions) !== JSON.stringify(dims)) err(`fit ${c.id}: expected_fit or gap_dimensions disagree with the bands`);
  }
  if (!(bud.cases ?? []).some((c) => c.expected_fit === "exceeds")) err("no planted over-budget case");

  // fit: stale
  const st = J(join(dir, "fit", "stale.json"));
  if (!evalV(st)) err(`fit/stale.json fails eval-archive schema: ${fmt(evalV.errors)}`);
  for (const c of st.cases ?? []) {
    const r = recs[c.source_record_id]; if (!r) { err(`fit ${c.id}: unknown record`); continue; }
    const want = r.context_profile.legal_stack.filter((s) => stacks[c.target_jurisdiction][s.layer] && stacks[c.target_jurisdiction][s.layer] !== s.corpus_version).map((s) => ({ layer: s.layer, source_corpus_version: s.corpus_version, target_corpus_version: stacks[c.target_jurisdiction][s.layer] }));
    if (JSON.stringify(want) !== JSON.stringify(c.expected_flags)) err(`fit ${c.id}: expected_flags differ from the corpus pins`);
  }
  if (!(st.cases ?? []).some((c) => c.expected_flags.length) || !(st.cases ?? []).some((c) => !c.expected_flags.length)) err("fit/stale.json needs a stale case and a no-flag control");

  // fit: holds
  const hl = J(join(dir, "fit", "holds.json"));
  if (!evalV(hl)) err(`fit/holds.json fails eval-archive schema: ${fmt(evalV.errors)}`);
  for (const c of hl.cases ?? []) {
    if (c.unresolved_stack) { if (!c.expected_hold) err(`fit ${c.id}: an unresolved stack must hold`); continue; }
    const missing = raw[c.target_jurisdiction].filter((l) => !l.corpus && l.mode !== "not_applicable").map((l) => l.layer);
    if (JSON.stringify(missing) !== JSON.stringify(c.missing_layers) || c.expected_hold !== (missing.length > 0)) err(`fit ${c.id}: hold expectation differs from the ${c.target_jurisdiction} pack`);
  }
  if (!(hl.cases ?? []).some((c) => c.expected_hold) || !(hl.cases ?? []).some((c) => !c.expected_hold)) err("fit/holds.json needs a hold and a no-hold control");

  // fit: differences
  const df = J(join(dir, "fit", "differences.json"));
  if (!evalV(df)) err(`fit/differences.json fails eval-archive schema: ${fmt(evalV.errors)}`);
  let falseCount = 0;
  for (const p of df.pairs ?? []) {
    const q = qBy[p.query_id], r = recs[p.record_id];
    if (!q || !r) { err(`pair ${p.id}: unknown query or record`); continue; }
    for (const s of p.statements) {
      if (!DIMS.includes(s.dimension)) { err(`pair ${p.id}: dimension '${s.dimension}' is not an archive.rank_weights key`); continue; }
      const truth = dimVerdict(q.context_profile, r.context_profile, s.dimension);
      const realQ = dimValue(q.context_profile, s.dimension), realR = dimValue(r.context_profile, s.dimension);
      const isTrue = s.verdict === truth && s.query_value === realQ && s.record_value === realR;
      if (isTrue !== s.is_true) err(`pair ${p.id} ${s.dimension}: is_true=${s.is_true} but the statement is ${isTrue ? "true" : "false"} against the data`);
      if (!s.is_true) falseCount++;
    }
    for (const d of DIMS) if (!p.statements.some((s) => s.dimension === d && s.is_true)) err(`pair ${p.id}: no true statement for ${d}`);
  }
  if (!falseCount) err("fit/differences.json needs planted false statements");

  // synthetic markers, deny-list, dashes, hosts, over every eval file
  const files = [];
  const walkDir = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walkDir(join(d, e.name)) : files.push(join(d, e.name)); };
  walkDir(dir);
  for (const f of files) {
    const rel = f.slice(dir.length + 1);
    if (!/\.(json|ya?ml)$/.test(f)) continue;
    const doc = f.endsWith(".json") ? J(f) : parse(readFileSync(f, "utf8"));
    if (DASH.test(readFileSync(f, "utf8"))) err(`${rel}: contains an em or en dash`);
    for (const s of strings(doc)) {
      if (PERSONAL.test(s)) err(`${rel}: personal-data-like text (@, ://, www., http or 7+ digits): ${s.slice(0, 40)}`);
      for (const re of DENY) if (re.test(s)) err(`${rel}: deny-list match ${re}: ${s.slice(0, 40)}`);
    }
    for (const u of uris(doc)) if (!/^https:\/\/evidence\.sim\.test\//.test(u)) err(`${rel}: uri '${u}' must be on evidence.sim.test`);
    if (rel.startsWith("records/") && doc.source !== "simulation") err(`${rel}: not marked simulation`);
    if (!rel.startsWith("records/") && f.endsWith(".json") && doc.synthetic !== true) err(`${rel}: not marked synthetic`);
  }
  return errors;
}

test("the archive eval set lints clean", () => {
  const errs = lintEvalArchive();
  assert.deepEqual(errs, []);
});

test("thresholds reference limits and never satisfy graduation with fake recordings", () => {
  const th = parse(readFileSync(join(ROOT, "evals/archive/thresholds.yaml"), "utf8"));
  assert.equal(th.fake_recordings_satisfy, false);
  assert.equal(th.recall_at_k.k_from_limit, "archive.top_n_shown");
  assert.equal(th.cross_language_recall_gap.floor_from_limit, "archive.cross_language_recall_floor");
});

test("the lint catches planted problems", () => {
  const tmp = mkdtempSync(join(tmpdir(), "evarch-"));
  const mutate = (fn) => { const d = join(tmp, String(Math.random()).slice(2)); cpSync(join(ROOT, "evals/archive"), d, { recursive: true }); fn(d); return lintEvalArchive(ROOT, d); };
  const edit = (d, rel, fn) => { const f = join(d, rel), o = J(f); fn(o); writeFileSync(f, JSON.stringify(o)); };
  assert.ok(mutate((d) => edit(d, "queries/core.json", (o) => { o.queries[0].draft_text += " mail me at someone@example.org"; })).some((e) => /personal-data/.test(e)));
  assert.ok(mutate((d) => edit(d, "queries/core.json", (o) => { o.queries[0].judgments[0].record_id = "evalrec-missing-one"; })).some((e) => /unknown record/.test(e)));
  assert.ok(mutate((d) => edit(d, "queries/core.json", (o) => { o.queries[0].language = "en_US"; o.queries[0].context_profile.language = "en_US"; })).some((e) => /BCP 47/.test(e)));
  assert.ok(mutate((d) => edit(d, "queries/translations.json", (o) => { o.queries.find((q) => q.language === "sw").translation.reviewed = true; })).some((e) => /machine and unreviewed/.test(e)));
  assert.ok(mutate((d) => edit(d, "queries/core.json", (o) => { o.queries[0].draft_text += " Mr. Jansen said so."; })).some((e) => /deny-list/.test(e)));
  assert.ok(mutate((d) => edit(d, "records/evalrec-s1-ams-happy.json", (o) => { o.evidence_refs[0].uri = "https://real-news.example/x"; })).some((e) => /evidence\.sim\.test/.test(e)));
  assert.ok(mutate((d) => edit(d, "fit/legality.json", (o) => { o.cases = o.cases.filter((c) => c.expected_result !== "unlawful_at_L5"); })).some((e) => /illegal-at-L5/.test(e)));
  assert.ok(mutate((d) => edit(d, "fit/legality.json", (o) => { o.cases.find((c) => c.id === "fit-ctl-city-fee").expected_result = "lawful"; })).some((e) => /rests on silence/.test(e)));
  assert.ok(mutate((d) => edit(d, "fit/legality.json", (o) => { const c = o.cases.find((x) => x.id === "fit-l1-city"); c.expected_result = "unlawful_at_L1"; })).some((e) => /reference layer/.test(e)));
  assert.ok(mutate((d) => edit(d, "records/evalrec-s2-city-happy.json", (o) => { o.options.find((x) => /waste bag/.test(x.summary)).legality = "lawful"; })).some((e) => /lawful by silence/.test(e)));
  assert.ok(mutate((d) => edit(d, "fit/differences.json", (o) => { o.pairs[0].statements[0].is_true = !o.pairs[0].statements[0].is_true; })).some((e) => /is_true/.test(e)));
  assert.ok(mutate((d) => edit(d, "fit/budget.json", (o) => { o.cases[0].expected_fit = "fits"; })).some((e) => /disagree/.test(e)));
  assert.ok(mutate((d) => edit(d, "records/evalrec-s1-ams-stuck.json", (o) => { o.challenges = []; })).some((e) => /ARCHIVE-1/.test(e)));
});
