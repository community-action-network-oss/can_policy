// Eval runner. Scores recorded responses against each DP's eval sets and gates on eval/thresholds.yaml. Offline only.
// Usage: node tools/eval.mjs [--dp DP-X] [--strict] [--json out.json] [--diff-against <git ref>]
//        node tools/eval.mjs --derive-fake [--dp DP-X] [--noise 0.1] [--seed 1]   (writes synthetic recordings)
// Other flags: --root <dir> (default: this repo), --recordings <dir> (default: test/fixtures/eval/recordings, file <DP>.jsonl)
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { wilson, ece, parityGap, disjointness, loosened, round } from "./lib/metrics.mjs";
import { lintCitations } from "./lint-legal-ratification.mjs";
import { loadRecordings, deriveFake, toJsonl } from "./lib/recordings.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SETS = ["core", "adversarial", "privacy", "parity"];
const KNOWN = new Set(["min_recall_harmful", "max_false_reject", "calibration_ece_max", "schema_validity_min", "injection_pass_min", "parity_gap_max", "confidence_floor"]);
const SMALL = 20;

function parseArgs(argv) {
  const o = { strict: false, derive: false, noise: 0, seed: 1 };
  const val = (i) => { if (i + 1 >= argv.length) throw new Error(`${argv[i]} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--strict") o.strict = true;
    else if (a === "--derive-fake") o.derive = true;
    else if (["--dp", "--json", "--root", "--recordings", "--diff-against", "--noise", "--seed"].includes(a)) { o[a.slice(2).replace("-a", "A")] = val(i++); }
    else throw new Error(`unknown argument ${a}`);
  }
  o.noise = Number(o.noise); o.seed = Number(o.seed);
  return o;
}

const readJsonl = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);

function loadDp(root, name) {
  const dir = join(root, "decision-points", name), ev = join(dir, "eval");
  const sets = Object.fromEntries(SETS.map((s) => [s, readJsonl(join(ev, `${s}.jsonl`)).map((c) => ({ ...c, _set: s }))]));
  const examples = existsSync(join(dir, "examples")) ? readdirSync(join(dir, "examples")).filter((f) => /\.jsonl?$/.test(f)).sort().flatMap((f) => {
    const t = readFileSync(join(dir, "examples", f), "utf8");
    return f.endsWith(".jsonl") ? t.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : JSON.parse(t);
  }) : [];
  const yml = (f) => (existsSync(join(dir, f)) ? parse(readFileSync(join(dir, f), "utf8")) : null);
  return { name, sets, examples, schema: JSON.parse(readFileSync(join(dir, "schema.json"), "utf8")), thresholds: yml("eval/thresholds.yaml") ?? {}, section: yml("pack-section.yaml") };
}

const listDps = (root) => readdirSync(join(root, "decision-points"), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_template").map((d) => d.name).sort();
const langOf = (c) => /\blang(?:uage)?:\s*([a-z]{2}(?:-[A-Za-z]+)?)\b/.exec(c.note ?? "")?.[1];

function scoreDp(dp, recs) {
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(dp.schema);
  const all = SETS.flatMap((s) => dp.sets[s]), enforces = dp.section?.enforces;
  const f = { unrecorded: [], invalid: [], missed_harmful: [], false_rejects: [], injection_fails: [], bad_citations: [], overlap: disjointness(dp.examples, dp.sets.core) };
  const rows = [], calib = [], par = { jurisdiction: [], language: [] };
  let recorded = 0, valid = 0, citeOk = 0, floorMiss = 0;
  const models = new Set();
  for (const c of all) {
    const r = recs.get(c.id);
    if (!r) { f.unrecorded.push(c.id); continue; }
    recorded++; models.add(r.model_id ?? "unknown");
    if (!validate(r.output)) { f.invalid.push(c.id); continue; }
    valid++;
    const o = r.output, correct = o.outcome === c.expected_outcome;
    rows.push({ c, o, correct });
    calib.push({ confidence: o.confidence, correct });
    const label = (fld) => new RegExp(`^${fld}\\s*:`, "m").test(c.input);
    const cited = (o.rule_ids ?? []).every((id) => !enforces || enforces.includes(id)) && (!o.field_ref || label(o.field_ref.field) || o.field_ref.field === c.field_ref?.field);
    if (cited) citeOk++; else f.bad_citations.push(c.id);
    const floor = dp.thresholds.confidence_floor?.[o.outcome];
    if (correct && typeof floor === "number" && o.confidence < floor) floorMiss++;
    par.jurisdiction.push({ group: c.jurisdiction, correct });
    if (langOf(c)) par.language.push({ group: langOf(c), correct });
  }
  const core = rows.filter((x) => x.c._set === "core" || x.c._set === "privacy");
  const harmful = core.filter((x) => x.c.expected_outcome !== "publish"), negatives = core.filter((x) => x.c.expected_outcome === "publish");
  const caught = harmful.filter((x) => x.o.outcome !== "publish");
  for (const x of harmful) if (x.o.outcome === "publish") f.missed_harmful.push(x.c.id);
  const falseRej = negatives.filter((x) => x.o.outcome !== "publish");
  for (const x of falseRej) f.false_rejects.push(x.c.id);
  const adv = rows.filter((x) => x.c._set === "adversarial"), advOk = adv.filter((x) => x.correct);
  for (const x of adv) if (!x.correct) f.injection_fails.push(x.c.id);
  const pj = parityGap(par.jurisdiction), pl = parityGap(par.language);
  const gaps = [pj.gap, pl.gap].filter((g) => g != null);
  const rate = (k, n) => (n ? k / n : null);
  const lo = (k, n) => round(wilson(k, n)?.[0] ?? null);
  const m = {
    schema_validity: { value: rate(valid, recorded), n: recorded },
    recall_harmful: { value: rate(caught.length, harmful.length), n: harmful.length, wilson_lower: lo(caught.length, harmful.length) },
    false_reject: { value: rate(falseRej.length, negatives.length), n: negatives.length, wilson_lower: null },
    calibration_ece: { value: ece(calib), n: calib.length },
    injection_pass: { value: rate(advOk.length, adv.length), n: adv.length, wilson_lower: lo(advOk.length, adv.length) },
    parity_gap: { value: gaps.length ? Math.max(...gaps) : null, n: pj.groups + pl.groups },
    citation_correctness: { value: rate(citeOk, valid), n: valid },
    confidence_floor_misses: { value: floorMiss, n: valid },
  };
  const t = dp.thresholds, checks = [];
  const add = (name, key, op) => {
    if (typeof t[key] !== "number") return;
    const v = m[name].value;
    checks.push({ metric: name, value: round(v), op, threshold: t[key], pass: v == null ? true : op === ">=" ? v >= t[key] : v <= t[key], note: v == null ? "no cases, not scored" : undefined });
  };
  add("schema_validity", "schema_validity_min", ">="); add("recall_harmful", "min_recall_harmful", ">="); add("false_reject", "max_false_reject", "<=");
  add("calibration_ece", "calibration_ece_max", "<="); add("injection_pass", "injection_pass_min", ">="); add("parity_gap", "parity_gap_max", "<=");
  const warnings = [];
  const nCore = dp.sets.core.length;
  if (nCore < SMALL) warnings.push(`small sample: ${nCore} core cases (< ${SMALL}); gate uses point estimates, read the Wilson lower bounds`);
  if (pj.small || pl.small) warnings.push(`parity: ${pj.small + pl.small} group(s) under 3 cases skipped`);
  if (f.overlap.length) warnings.push(...f.overlap.map((x) => `not disjoint: ${x}`));
  const fail = checks.some((c) => !c.pass) || f.overlap.length > 0;
  for (const k of Object.keys(f)) if (k !== "overlap") f[k].sort();
  return {
    dp: dp.name, models: [...models].sort(), cases: { total: all.length, recorded, unrecorded: f.unrecorded.length, by_set: Object.fromEntries(SETS.map((s) => [s, dp.sets[s].length])) },
    metrics: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, value: round(v.value) }])),
    checks, ignored_extras: Object.keys(t).filter((k) => !KNOWN.has(k)).sort(), warnings, findings: f, pass: !fail,
  };
}

function diffAgainst(root, ref, names) {
  const out = [];
  for (const n of names) {
    let old;
    try { old = execFileSync("git", ["-C", root, "show", `${ref}:./decision-points/${n}/eval/thresholds.yaml`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { continue; } // new file at ref: nothing to loosen
    const cur = join(root, "decision-points", n, "eval", "thresholds.yaml");
    if (!existsSync(cur)) continue;
    for (const d of loosened(parse(old), parse(readFileSync(cur, "utf8")))) out.push({ dp: n, change: d });
  }
  return out;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const root = resolve(o.root ?? join(HERE, ".."));
  const recDir = resolve(o.recordings ?? join(root, "test", "fixtures", "eval", "recordings"));
  const names = o.dp ? [o.dp] : listDps(root);
  if (o.derive) {
    mkdirSync(recDir, { recursive: true });
    for (const n of names) {
      const dp = loadDp(root, n);
      writeFileSync(join(recDir, `${n}.jsonl`), toJsonl(deriveFake(SETS.flatMap((s) => dp.sets[s]), dp.schema, o)));
      console.log(`derived ${n}`);
    }
    return 0;
  }
  const dps = names.map((n) => scoreDp(loadDp(root, n), loadRecordings(join(recDir, `${n}.jsonl`))));
  const loose = o.diffAgainst ? diffAgainst(root, o.diffAgainst, names) : [];
  const badLegal = lintCitations(root); // legal eval cases (10-u58) use the same thresholds once they exist
  const unrec = dps.reduce((s, d) => s + d.cases.unrecorded, 0);
  const pass = dps.every((d) => d.pass) && !loose.length && !badLegal.length && !(o.strict && unrec);
  for (const d of dps) {
    console.log(`\n${d.dp}  (${d.cases.recorded}/${d.cases.total} recorded, models: ${d.models.join(", ") || "none"})`);
    for (const c of d.checks) console.log(`  ${c.pass ? "pass          " : "did not pass  "} ${c.metric} ${c.value ?? "n/a"} ${c.op} ${c.threshold}${c.note ? ` (${c.note})` : ""}`);
    const lb = d.metrics.recall_harmful.wilson_lower;
    if (lb != null) console.log(`  info          recall_harmful Wilson 95% lower bound ${lb} (n=${d.metrics.recall_harmful.n})`);
    if (d.findings.missed_harmful.length) console.log(`  missed harmful: ${d.findings.missed_harmful.join(", ")}`);
    if (d.findings.false_rejects.length) console.log(`  false rejects: ${d.findings.false_rejects.join(", ")}`);
    if (d.findings.injection_fails.length) console.log(`  injection fails: ${d.findings.injection_fails.join(", ")}`);
    if (d.findings.invalid.length) console.log(`  schema invalid: ${d.findings.invalid.join(", ")}`);
    if (d.findings.bad_citations.length) console.log(`  bad citations: ${d.findings.bad_citations.join(", ")}`);
    if (d.findings.unrecorded.length) console.log(`  unrecorded: ${d.findings.unrecorded.length} case(s)${o.strict ? " (blocks --strict)" : ""}`);
    if (d.ignored_extras.length) console.log(`  ignored threshold keys: ${d.ignored_extras.join(", ")}`);
    for (const w of d.warnings) console.log(`  warning: ${w}`);
  }
  for (const b of badLegal) console.log(`\ndid not pass  ${b}`);
  for (const l of loose) console.log(`\ndid not pass  ${l.dp}: threshold loosened vs ${o.diffAgainst}: ${l.change}`);
  console.log(`\neval: ${pass ? "pass" : "did not pass"} (${dps.length} decision points, ${unrec} unrecorded cases${o.strict ? ", strict" : ""})`);
  if (o.json) {
    mkdirSync(dirname(resolve(o.json)), { recursive: true });
    writeFileSync(o.json, JSON.stringify({ version: 1, strict: o.strict, pass, loosened: loose, decision_points: dps }, null, 2) + "\n");
  }
  return pass ? 0 : 1;
}

try { process.exitCode = main(); } catch (e) { console.error(`eval: ${e.message}`); process.exitCode = 2; }
