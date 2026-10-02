// Decision point directory lint. lintDp(root, notes) returns readable errors; skipped checks push a reason to notes.
// To add a rule, add a function to CHECKS (each gets the loaded DP and calls ctx.err).
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_OPEN, DATA_CLOSE } from "./prompt-hash.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const OUTCOMES = ["publish", "needs_revision", "reject", "route_external", "hold", "escalate_human"];
const ESCALATORS = new Set(["DP-CRISIS", "DP-LEGAL"]);
const SECTIONS = ["ROLE", "RULES", "OUTPUT", "EXAMPLES", "DATA"];
const SLOTS = ["RULES", "SHOTS"];
// Must equal can_server prompt-builder SLOT (can_server/src/ai-gateway/app/prompt-builder.ts). The builder throws bad_template without it.
export const SLOT = "(the labelled lines are inserted here by the server)";
// The builder's template contract (substring counts, order, nothing after the closer). Returns readable errors.
export function templateErrors(text) {
  const p = text.replaceAll("\r\n", "\n"), n = (s) => p.split(s).length - 1, e = [];
  if (n(DATA_OPEN) !== 1) e.push(`'${DATA_OPEN}' must appear exactly once`);
  if (n(DATA_CLOSE) !== 1) e.push(`'${DATA_CLOSE}' must appear exactly once`);
  if (n(SLOT) !== 1) e.push(`the slot line '${SLOT}' must appear exactly once (can_server prompt-builder SLOT)`);
  if (n("{{RULES}}") !== 1) e.push("{{RULES}} must appear exactly once");
  if (n("{{SHOTS}}") > 1) e.push("{{SHOTS}} must appear at most once");
  const o = p.indexOf(DATA_OPEN), s = p.indexOf(SLOT), c = p.indexOf(DATA_CLOSE);
  if (o > s || s > c) e.push(`order must be ${DATA_OPEN}, slot line, ${DATA_CLOSE}`);
  if (c >= 0 && p.slice(c + DATA_CLOSE.length).trim()) e.push(`nothing but whitespace may follow ${DATA_CLOSE}`);
  return e;
}
const THRESHOLD_KEYS = ["min_recall_harmful", "max_false_reject", "calibration_ece_max", "schema_validity_min", "injection_pass_min", "parity_gap_max"];
const BASE = JSON.parse(readFileSync(join(HERE, "..", "schemas", "dp-output.schema.json"), "utf8"));

const caseProps = {
  id: { type: "string", minLength: 1 }, input: { type: "string", minLength: 1 },
  expected_outcome: { enum: OUTCOMES }, rule_ids: { type: "array", items: { type: "string" } },
  note: { type: "string" }, provenance: { type: "string", minLength: 1 }, jurisdiction: { type: "string", minLength: 1 },
  field_ref: BASE.properties.field_ref, revision_hint: { type: "string" }, shot: { type: "boolean" }, expected: { type: "object" },
};
const caseReq = ["id", "input", "expected_outcome", "rule_ids", "note", "provenance", "jurisdiction"];
const mk = (required) => new Ajv2020({ allErrors: true }).compile({ type: "object", additionalProperties: false, required, properties: caseProps });
const exampleV = mk(caseReq), evalV = mk([...caseReq, "field_ref"]);
const fmt = (errs) => errs.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
const LIVE_URL = /https?:\/\/(?![^\s/]*(example\.(org|com|net)|\.test|\.invalid|localhost))[^\s/]+/i;

const isNum01 = (v) => typeof v === "number" && v >= 0 && v <= 1;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function loadRuleIds(root) {
  const ids = new Set();
  const packs = join(root, "packs");
  let any = false;
  for (const layer of existsSync(packs) ? readdirSync(packs) : []) {
    const dirs = layer === "jurisdictions" ? readdirSync(join(packs, layer)).map((j) => join(layer, j)) : [layer];
    for (const d of dirs) {
      const f = join(packs, d, "rules.yaml");
      if (!existsSync(f)) continue;
      any = true;
      for (const r of parse(readFileSync(f, "utf8"))?.rules ?? []) ids.add(r.id);
    }
  }
  return any ? ids : null;
}

// Reads a .json (array) or .jsonl file into [{case, where}], reporting parse problems.
function readCases(abs, label, err) {
  let text;
  try { text = readFileSync(abs, "utf8"); } catch { return []; }
  if (abs.endsWith(".jsonl")) {
    return text.split("\n").flatMap((line, i) => {
      if (!line.trim()) return [];
      try { return [{ c: JSON.parse(line), where: `${label} line ${i + 1}` }]; } catch (e) { err(`${label} line ${i + 1}: not valid JSON`); return []; }
    });
  }
  try {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) { err(`${label}: must be a JSON array of cases`); return []; }
    return arr.map((c, i) => ({ c, where: `${label} #${i + 1}` }));
  } catch (e) { err(`${label}: not valid JSON`); return []; }
}

const CHECKS = [
  function files(x) {
    for (const f of ["pack-section.yaml", "eval/core.jsonl", "eval/adversarial.jsonl", "eval/README.md"]) if (!existsSync(join(x.dir, f))) x.err(`missing ${f}`);
  },
  function prompt(x) {
    if (!x.prompt) return;
    const p = x.prompt.replaceAll("\r\n", "\n");
    for (const m of templateErrors(p)) x.err(`prompt.md: ${m}`);
    const heads = [...p.matchAll(/^## (\S+)/gm)].map((m) => m[1]);
    if (!same(heads, SECTIONS)) x.err(`prompt.md: sections must be ${SECTIONS.join(", ")} in that order as '## NAME' headings (found ${heads.join(", ") || "none"})`);
    const count = (s) => p.split(s).length - 1;
    if (count(DATA_OPEN) !== 1) x.err(`prompt.md: the data block opener '${DATA_OPEN}' must appear exactly once (found ${count(DATA_OPEN)})`);
    if (count(DATA_CLOSE) !== 1) x.err(`prompt.md: the data block closer '${DATA_CLOSE}' must appear exactly once (found ${count(DATA_CLOSE)})`);
    if (count(DATA_OPEN) === 1 && count(DATA_CLOSE) === 1) {
      if (!/^<<<DATA field=\S+$/m.test(p)) x.err(`prompt.md: the opener line must read '${DATA_OPEN} field=<name>'`);
      if (p.indexOf(DATA_OPEN) > p.indexOf(DATA_CLOSE)) x.err("prompt.md: data block opener must come before the closer");
      if (p.slice(p.indexOf(DATA_CLOSE) + DATA_CLOSE.length).trim()) x.err("prompt.md: nothing may follow the data block");
    }
    const vars = [...p.matchAll(/\{\{([^}]*)\}\}/g)].map((m) => m[1]);
    for (const v of vars) if (!SLOTS.includes(v)) x.err(`prompt.md: template variable {{${v}}} is not allowed (only {{RULES}} and {{SHOTS}})`);
    for (const s of SLOTS) if (vars.filter((v) => v === s).length !== 1) x.err(`prompt.md: {{${s}}} must appear exactly once`);
    if (/__[A-Z]+__/.test(p)) x.err("prompt.md: unfilled template placeholder (__NAME__)");
  },
  function schemaOutcomes(x) {
    const s = x.schema;
    if (!s) return;
    try { new Ajv2020({ strict: true, strictTypes: true, strictRequired: true }).compile(s); } catch (e) { x.err(`schema.json: not a valid JSON Schema (${e.message})`); return; }
    if (s.type !== "object" || s.additionalProperties !== false) x.err("schema.json: must be an object schema with additionalProperties false (unknown keys fail)");
    for (const k of BASE.required) if (!s.required?.includes(k)) x.err(`schema.json: required must include '${k}' (extends schemas/dp-output.schema.json)`);
    for (const [k, v] of Object.entries(BASE.properties)) if (k !== "outcome" && !same(s.properties?.[k], v)) x.err(`schema.json: property '${k}' must match schemas/dp-output.schema.json`);
    const out = s.properties?.outcome?.enum;
    if (!Array.isArray(out) || !out.length) return x.err("schema.json: properties.outcome.enum is missing");
    for (const o of out) if (!OUTCOMES.includes(o)) x.err(`schema.json: outcome '${o}' is not one of the six outcomes`);
    if (out.includes("escalate_human") && !ESCALATORS.has(x.name)) x.err("schema.json: escalate_human is only allowed in DP-CRISIS and DP-LEGAL");
    if (x.section?.outcomes && !same([...out].sort(), [...x.section.outcomes].sort())) x.err(`schema.json outcomes (${out.join(", ")}) must equal pack-section.yaml outcomes (${x.section.outcomes.join(", ")})`);
  },
  function packSection(x) {
    const s = x.section;
    if (!s) return;
    if (s.dp !== x.name) x.err(`pack-section.yaml: dp '${s.dp}' must equal the directory name`);
    if (!["blocking", "async"].includes(s.mode)) x.err("pack-section.yaml: mode must be blocking or async");
    if (!Array.isArray(s.enforces) || !s.enforces.length) x.err("pack-section.yaml: enforces must be a non-empty list");
    if (!Array.isArray(s.outcomes) || !s.outcomes.length) return x.err("pack-section.yaml: outcomes must be a non-empty list");
    for (const o of s.outcomes) if (!OUTCOMES.includes(o)) x.err(`pack-section.yaml: outcome '${o}' is not one of the six outcomes`);
    if (s.outcomes.includes("escalate_human") && !ESCALATORS.has(x.name)) x.err("pack-section.yaml: escalate_human is only allowed in DP-CRISIS and DP-LEGAL");
    const t = s.thresholds ?? {};
    for (const [o, v] of Object.entries(t.confidence_floor ?? {})) {
      if (!s.outcomes.includes(o)) x.err(`pack-section.yaml: confidence_floor.${o} is not one of the DP's outcomes`);
      if (!isNum01(v)) x.err(`pack-section.yaml: confidence_floor.${o} must be a number from 0 to 1`);
    }
    if (!isNum01(t.escalate_model_below)) x.err("pack-section.yaml: thresholds.escalate_model_below must be a number from 0 to 1");
    if (x.ruleIds) for (const r of s.enforces ?? []) if (!x.ruleIds.has(r)) x.err(`pack-section.yaml: enforces '${r}' is not a rule id in packs/*/rules.yaml`);
  },
  function thresholds(x) {
    if (!x.thresholds) return;
    for (const k of THRESHOLD_KEYS) if (!isNum01(x.thresholds[k])) x.err(`eval/thresholds.yaml: '${k}' is missing or not a number from 0 to 1`);
    const f = x.thresholds.confidence_floor;
    if (!f || typeof f !== "object") x.err("eval/thresholds.yaml: confidence_floor map is missing");
    else for (const [o, v] of Object.entries(f)) if (!isNum01(v) || !(x.section?.outcomes ?? OUTCOMES).includes(o)) x.err(`eval/thresholds.yaml: confidence_floor.${o} must be a number from 0 to 1 for one of the DP's outcomes`);
  },
  function cases(x) {
    const outcomes = x.section?.outcomes ?? OUTCOMES, enforces = x.section?.enforces;
    if (!x.examples.length) x.err("examples/ has no cases (add at least one .json array or .jsonl file)");
    const seen = new Map();
    for (const { c, where, set } of [...x.examples, ...x.eval]) {
      const v = set === "examples" ? exampleV : evalV;
      if (!v(c)) { x.err(`${where}: bad case shape: ${fmt(v.errors)}`); continue; }
      if (seen.has(c.id)) x.err(`${where}: duplicate id '${c.id}' (also in ${seen.get(c.id)})`); else seen.set(c.id, where);
      if (!outcomes.includes(c.expected_outcome)) x.err(`${where}: expected_outcome '${c.expected_outcome}' is not one of the DP's outcomes`);
      if (enforces) for (const r of c.rule_ids) if (!enforces.includes(r)) x.err(`${where}: rule id '${r}' is not in the DP's enforces`);
      if (LIVE_URL.test(c.input)) x.err(`${where}: input contains a live URL (use example.org); cases must be fictional`);
    }
    const norm = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
    const shots = new Set(x.examples.filter((e) => e.c && typeof e.c.input === "string").map((e) => norm(e.c.input)));
    for (const { c, where } of x.eval) if (c && typeof c.input === "string" && shots.has(norm(c.input))) x.err(`${where}: input also appears in examples/ (eval must be held out)`);
  },
];

function lintOne(root, name, ruleIds) {
  const errors = [], dir = join(root, "decision-points", name);
  const x = { name, dir, ruleIds, examples: [], eval: [], err: (m) => errors.push(`decision-points/${name}: ${m}`) };
  const read = (rel, fn) => { try { return fn(readFileSync(join(dir, rel), "utf8")); } catch (e) { if (existsSync(join(dir, rel))) x.err(`${rel}: cannot parse (${e.message})`); return null; } };
  x.prompt = read("prompt.md", (t) => t);
  x.schema = read("schema.json", JSON.parse);
  x.section = read("pack-section.yaml", parse);
  x.thresholds = read("eval/thresholds.yaml", parse);
  const ex = join(dir, "examples");
  if (existsSync(ex) && statSync(ex).isDirectory()) {
    for (const f of readdirSync(ex).filter((f) => !f.startsWith("."))) {
      if (!/\.jsonl?$/.test(f)) { x.err(`examples/${f}: only .json (array) and .jsonl files are allowed`); continue; }
      x.examples.push(...readCases(join(ex, f), `examples/${f}`, x.err).map((r) => ({ ...r, set: "examples" })));
    }
  }
  for (const f of ["core.jsonl", "adversarial.jsonl"]) x.eval.push(...readCases(join(dir, "eval", f), `eval/${f}`, x.err).map((r) => ({ ...r, set: "eval" })));
  for (const check of CHECKS) check(x);
  return errors;
}

export function lintDp(root, notes = []) {
  const base = join(root, "decision-points");
  if (!existsSync(base)) return [];
  const ruleIds = loadRuleIds(root);
  if (!ruleIds) notes.push("lint-dp: no packs/*/rules.yaml found, enforces ids not checked against the registry");
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_template")
    .flatMap((d) => lintOne(root, d.name, ruleIds));
}
