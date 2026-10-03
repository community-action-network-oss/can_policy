// Labeled example candidate lint (11-u10). lintCandidates(root) returns readable errors for simulation/candidates and
// the traceability rule: an eval/example row with provenance "simulation" must be a confirmed candidate id.
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: true, strictRequired: true });
const candV = ajv.compile(JSON.parse(readFileSync(join(HERE, "..", "schemas", "candidate.schema.json"), "utf8")));
const fmt = (errs) => errs.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
const BANNED = /[—–]/;
// Shared personal-data pattern (as for reasons and hints): @, full-width @, ://, www., http, runs of 7+ digits.
export const PERSONAL = /[@＠]|:\/\/|www\.|http|\d{7}/i;
const dirs = (p) => (existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);
const rows = (f) => {
  const t = readFileSync(f, "utf8");
  try { return f.endsWith(".jsonl") ? t.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : [].concat(JSON.parse(t)); } catch { return []; }
};

function strings(v, out = []) {
  if (typeof v === "string") out.push(v);
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

export function lintCandidates(root) {
  const errors = [], err = (m) => errors.push(m);
  const base = join(root, "simulation", "candidates");
  const confirmed = new Set(), seen = new Map();
  for (const run of dirs(base)) {
    for (const f of readdirSync(join(base, run)).filter((n) => n.endsWith(".json"))) {
      const rel = `simulation/candidates/${run}/${f}`;
      let c;
      try { c = JSON.parse(readFileSync(join(base, run, f), "utf8")); } catch (e) { err(`${rel}: not valid JSON (${e.message})`); continue; }
      if (!candV(c)) { err(`${rel}: fails candidate schema: ${fmt(candV.errors)}`); continue; }
      if (c.id + ".json" !== f) err(`${rel}: file name must be the candidate id`);
      if (c.run_id !== run) err(`${rel}: run_id '${c.run_id}' does not match its directory`);
      if (seen.has(c.id)) err(`${rel}: duplicate id '${c.id}' (also in ${seen.get(c.id)})`); else seen.set(c.id, rel);
      for (const s of strings(c)) {
        if (PERSONAL.test(s)) err(`${rel}: contains personal-data-like text (@, ://, www., http or 7+ digits)`);
        if (BANNED.test(s)) err(`${rel}: contains an em or en dash`);
      }
      // dp, outcome and rule ids against the DP section (closed set)
      const sp = join(root, "decision-points", c.dp, "pack-section.yaml");
      if (!existsSync(sp)) err(`${rel}: dp '${c.dp}' does not exist`);
      else {
        const s = parse(readFileSync(sp, "utf8"));
        if (s.outcomes && !s.outcomes.includes(c.expected_outcome)) err(`${rel}: expected_outcome '${c.expected_outcome}' is not one of ${c.dp}'s outcomes`);
        for (const r of c.rule_ids) if (!(s.enforces ?? []).includes(r)) err(`${rel}: rule id '${r}' is not in ${c.dp}'s enforces`);
      }
      if (!existsSync(join(root, "simulation", "seeds", c.seed_id))) err(`${rel}: seed '${c.seed_id}' does not exist`);
      if (!existsSync(join(root, "simulation", "personas", c.persona_id))) err(`${rel}: persona '${c.persona_id}' does not exist`);
      // planted attack data: by row id only
      if (c.persona_id.startsWith("adv-") && !c.attack_ref) err(`${rel}: adversarial persona needs attack_ref (row id)`);
      if (c.attack_ref) {
        const af = join(root, "simulation", "personas", c.attack_ref.persona_id, "attacks.jsonl");
        const row = existsSync(af) ? rows(af).find((r) => r.id === c.attack_ref.row_id) : null;
        if (!row) err(`${rel}: attack_ref ${c.attack_ref.persona_id}/${c.attack_ref.row_id} does not exist`);
        else for (const p of [row.payload, ...(row.planted_canaries ?? [])].filter((x) => typeof x === "string" && x))
          if (c.input.toLowerCase().includes(p.toLowerCase())) err(`${rel}: input copies planted attack data from row '${row.id}' (reference the row id instead)`);
      }
      if (c.status === "confirmed") confirmed.add(c.id);
    }
  }
  // Traceability: simulation-provenance rows in any DP examples or eval set must be confirmed candidates.
  const dpRoot = join(root, "decision-points");
  for (const dp of dirs(dpRoot)) {
    for (const sub of ["examples", "eval"]) {
      const d = join(dpRoot, dp, sub);
      if (!existsSync(d)) continue;
      for (const f of readdirSync(d).filter((n) => /\.jsonl?$/.test(n)))
        for (const r of rows(join(d, f)))
          if (r?.provenance === "simulation" && !confirmed.has(r.id)) err(`decision-points/${dp}/${sub}/${f}: row '${r.id}' has provenance simulation but is not a confirmed candidate id`);
    }
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errs = lintCandidates(join(HERE, ".."));
  errs.forEach((e) => console.error("lint-candidates: " + e));
  console.log(errs.length ? `lint-candidates: ${errs.length} error(s)` : "lint-candidates: ok");
  process.exit(errs.length ? 1 : 0);
}
