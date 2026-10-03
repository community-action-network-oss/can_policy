// Simulation data lint (11-u01). lintSimulation(root) returns readable errors for simulation/personas and simulation/seeds.
// Data only: personas, scripts, seeds. The harness that reads them lives in can_server.
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const loadSchema = (n) => JSON.parse(readFileSync(join(HERE, "..", "schemas", n), "utf8"));
// strict + strictTypes + strictRequired, like the server's validator: a schema that only compiles loosely is a bug here.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: true, strictRequired: true });
const personaV = ajv.compile(loadSchema("persona.schema.json"));
const scriptV = ajv.compile(loadSchema("script.schema.json"));
const seedV = ajv.compile(loadSchema("seed.schema.json"));

// Persona catalog: docs/design/ai/simulation.md section 2 plus the lifecycle v2 and archive personas (11-u01 step 7).
// adv-reuse-inject is new: the doc names it only as "an attacker persona".
export const CATALOG = {
  submitter: ["sub-wellmeaning-wrong", "sub-vague", "sub-careful", "sub-nonnative", "sub-revising"],
  volunteer: ["vol-careful", "vol-nitpick", "vol-leaker", "vol-brigade"],
  stage: ["stg-contributor", "stg-evidence-weak", "stg-evidence-strong", "stg-gate-skipper"],
  contributor: ["con-expert", "con-resident", "con-skeptic", "con-implementer", "con-institution", "prop-proposer", "app-appellant"],
  adversarial: ["adv-spam", "adv-hate", "adv-doxx", "adv-inject", "adv-brigade", "adv-offtopic", "adv-individual", "adv-crisis-bait", "adv-assumption-smuggle", "adv-schema-bypass", "adv-reuse-inject"],
  reuser: ["prop-reuser"],
};
const ID_FAMILY = new Map(Object.entries(CATALOG).flatMap(([f, ids]) => ids.map((i) => [i, f])));
export const FAKE_HOST = "evidence.sim.test";

const BANNED = /[—–]/;
// Mini PII scan (the patterns can_server will reuse): email, phone, street address, any host except the fake one.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STREET = [
  /\b\d{1,5}\s+(?:[A-Z][a-z]+\s)+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Drive|Boulevard|Laan|Plein)\b/,
  /\b[A-Z][a-z]+(?:straat|gracht|laan|weg|plein|kade)\s+\d{1,4}[a-z]?\b/,
];
const URL_HOST = /\b(?:https?|ftp):\/\/([^/\s:"'?#]+)/gi;
// SIM-NOSECRET-1: no credentials or secrets in simulation data.
const SECRET = [/-----BEGIN [A-Z ]*KEY-----/, /\bsk-[A-Za-z0-9]{16,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bBearer\s+[A-Za-z0-9._-]{16,}/, /\b(?:api[_-]?key|secret|password|passwd|access[_-]?token)\s*[:=]\s*["']?[^\s"'{]{4,}/i];

// Text-level checks shared by persona.yaml, script.json, seed.yaml (pii true) and attack_data (pii false: planted fake personal data is its purpose).
function scanText(rel, text, { pii }, err) {
  if (BANNED.test(text)) err(`${rel}: contains an em or en dash (U+2014 or U+2013)`);
  if (SECRET.some((re) => re.test(text))) err(`${rel}: looks like a credential or secret (SIM-NOSECRET-1)`);
  if (!pii) return;
  if (EMAIL.test(text)) err(`${rel}: contains an email address`);
  for (const m of text.match(PHONE) ?? []) if (m.replace(/\D/g, "").length >= 9 && !ISO_DATE.test(m.trim())) err(`${rel}: contains a phone-like number '${m.trim()}'`);
  if (STREET.some((re) => re.test(text))) err(`${rel}: contains a street-address-like string`);
  for (const m of text.matchAll(URL_HOST)) if (m[1].toLowerCase() !== FAKE_HOST) err(`${rel}: host '${m[1]}' is not ${FAKE_HOST}`);
}

const fmt = (errs) => errs.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
const subdirs = (p) => (existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name) : []);

export function lintSimulation(root) {
  const errors = [];
  const err = (m) => errors.push(m);
  const sim = join(root, "simulation");
  if (!existsSync(sim)) return errors;
  const load = (rel, kind) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) { err(`${rel}: missing`); return null; }
    const text = readFileSync(abs, "utf8");
    scanText(rel, text, { pii: true }, err);
    try { return kind === "json" ? JSON.parse(text) : parse(text); } catch (e) { err(`${rel}: not valid ${kind === "json" ? "JSON" : "YAML"} (${e.message})`); return null; }
  };
  const inside = (base, p) => { const n = normalize(join(base, p)); return n.startsWith(normalize(base) + "/") ? n : null; };

  const personaIds = new Set();
  for (const id of subdirs(join(sim, "personas"))) {
    const dir = `simulation/personas/${id}`, rel = `${dir}/persona.yaml`;
    personaIds.add(id);
    if (!ID_FAMILY.has(id)) err(`${dir}: '${id}' is not in the persona catalog (docs/design/ai/simulation.md section 2)`);
    const p = load(rel, "yaml");
    if (!p) continue;
    if (!personaV(p)) { err(`${rel}: fails persona schema: ${fmt(personaV.errors)}`); continue; }
    if (p.id !== id) err(`${rel}: id '${p.id}' must equal its directory name '${id}'`);
    if (ID_FAMILY.has(id) && ID_FAMILY.get(id) !== p.family) err(`${rel}: family '${p.family}' but the catalog puts ${id} in '${ID_FAMILY.get(id)}'`);
    const refs = {};
    for (const k of ["script", "prompt", "attack_data"]) {
      if (p[k] === undefined) continue;
      const abs = inside(join(root, dir), p[k]);
      if (!abs) err(`${rel}: ${k} '${p[k]}' must stay inside the persona directory`);
      else if (!existsSync(abs)) err(`${rel}: ${k} '${p[k]}' does not exist`);
      else refs[k] = abs;
    }
    if (refs.prompt) scanText(`${dir}/${p.prompt}`, readFileSync(refs.prompt, "utf8"), { pii: true }, err);
    if (refs.attack_data) scanText(`${dir}/${p.attack_data}`, readFileSync(refs.attack_data, "utf8"), { pii: false }, err);
    if (refs.script) {
      const srel = `${dir}/${p.script}`, text = readFileSync(refs.script, "utf8");
      scanText(srel, text, { pii: true }, err);
      let s = null;
      try { s = JSON.parse(text); } catch (e) { err(`${srel}: not valid JSON (${e.message})`); }
      if (s && !scriptV(s)) err(`${srel}: fails script schema: ${fmt(scriptV.errors)}`);
      else if (s) {
        const ids = s.steps.map((x) => x.id);
        ids.forEach((x, i) => { if (ids.indexOf(x) !== i) err(`${srel}: duplicate step id '${x}'`); });
        for (const st of s.steps) {
          if (st.when?.after_step && !ids.includes(st.when.after_step)) err(`${srel}: step ${st.id} runs after unknown step '${st.when.after_step}'`);
          if (st.action === "raw_http" && id !== "adv-schema-bypass") err(`${srel}: step ${st.id} uses raw_http, which only adv-schema-bypass may`);
        }
        for (const e of p.expected) if (!ids.includes(e.step_id)) err(`${rel}: expected step_id '${e.step_id}' is not a step of ${p.script}`);
      }
    }
  }

  const framings = existsSync(join(sim, "FRAMINGS.json")) ? JSON.parse(readFileSync(join(sim, "FRAMINGS.json"), "utf8")) : null;
  for (const id of subdirs(join(sim, "seeds"))) {
    const dir = `simulation/seeds/${id}`, rel = `${dir}/seed.yaml`;
    const s = load(rel, "yaml");
    if (!s) continue;
    if (!seedV(s)) { err(`${rel}: fails seed schema: ${fmt(seedV.errors)}`); continue; }
    if (s.id !== id) err(`${rel}: id '${s.id}' must equal its directory name '${id}'`);
    if (!framings) err(`${rel}: simulation/FRAMINGS.json is missing`);
    else if (framings[String(s.number)] !== s.framing) err(`${rel}: framing is not byte for byte the D-56 framing ${s.number} in simulation/FRAMINGS.json`);
    for (const pid of s.personas) if (!personaIds.has(pid)) err(`${rel}: persona '${pid}' does not exist under simulation/personas`);
    for (const k of ["problem", "rubric", "stage_plan"]) {
      const abs = inside(join(root, dir), s[k]);
      if (!abs) err(`${rel}: ${k} '${s[k]}' must stay inside the seed directory`);
      else if (!existsSync(abs)) err(`${rel}: ${k} '${s[k]}' does not exist`);
      else if (k !== "rubric") {
        scanText(`${dir}/${s[k]}`, readFileSync(abs, "utf8"), { pii: true }, err);
        try {
          const body = JSON.parse(readFileSync(abs, "utf8"));
          if (k === "problem") validateProblem(root, body, `${dir}/${s[k]}`, err);
        } catch (e) { err(`${dir}/${s[k]}: not valid JSON (${e.message})`); }
      }
    }
  }
  return errors;
}

// The problem body must be valid for the problem content schema (same non-strict compile as lint.mjs).
let problemV = null;
function validateProblem(root, body, rel, err) {
  const sp = join(root, "content-schemas", "problem", "schema.json");
  if (!existsSync(sp)) return;
  if (!problemV) {
    const a = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
    ["version", "pack", "x-ui", "x-guidance", "x-checks", "x-version"].forEach((keyword) => a.addKeyword({ keyword }));
    const { id, ...schema } = JSON.parse(readFileSync(sp, "utf8"));
    problemV = a.compile(schema);
  }
  if (!problemV(body)) err(`${rel}: not valid for the problem content schema: ${fmt(problemV.errors)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errs = lintSimulation(join(HERE, ".."));
  errs.forEach((e) => console.error("lint-simulation: " + e));
  console.log(errs.length ? `lint-simulation: ${errs.length} error(s)` : "lint-simulation: ok");
  process.exit(errs.length ? 1 : 0);
}
