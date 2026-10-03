// Simulation data lint (11-u01). lintSimulation(root) returns readable errors for simulation/personas and simulation/seeds.
// Data only: personas, scripts, seeds. The harness that reads them lives in can_server.
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loosened } from "./lib/metrics.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const loadSchema = (n) => JSON.parse(readFileSync(join(HERE, "..", "schemas", n), "utf8"));
// strict + strictTypes + strictRequired, like the server's validator: a schema that only compiles loosely is a bug here.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: true, strictRequired: true });
const personaV = ajv.compile(loadSchema("persona.schema.json"));
const scriptV = ajv.compile(loadSchema("script.schema.json"));
const seedV = ajv.compile(loadSchema("seed.schema.json"));
const thresholdsV = ajv.compile(loadSchema("thresholds.schema.json"));

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
  if (existsSync(join(sim, "thresholds.yaml"))) errors.push(...lintThresholds(root)); // presence in the real tree is pinned by test/thresholds.test.mjs
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
      // The named script plus every variant script*.json in the persona directory (11-u02 variants) get every check.
      const variants = readdirSync(join(root, dir)).filter((f) => /^script.*\.json$/.test(f) && join(root, dir, f) !== refs.script).sort();
      for (const f of [p.script, ...variants]) {
        const srel = `${dir}/${f}`, text = readFileSync(join(root, dir, f), "utf8"), main = f === p.script;
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
          if (main) for (const e of p.expected) if (!ids.includes(e.step_id)) err(`${rel}: expected step_id '${e.step_id}' is not a step of ${p.script}`);
        }
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
    const handled = new Set([rel, `${dir}/${s.problem}`, `${dir}/${s.stage_plan}`]);
    lintSeedFiles(root, dir, handled, err);
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

// Every other file in a seed directory (variants, evidence, rubric, ...) gets the same text scan; JSON files that declare
// what they are are validated against that content schema. seed.yaml, problem and stage plan are handled above.
function lintSeedFiles(root, dir, skip, err) {
  const files = (d) => readdirSync(join(root, d), { withFileTypes: true }).flatMap((e) => (e.name.startsWith(".") ? [] : e.isDirectory() ? files(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  for (const rel of files(dir).sort()) {
    if (skip.has(rel)) continue;
    const text = readFileSync(join(root, rel), "utf8");
    scanText(rel, text, { pii: true }, err);
    if (!rel.endsWith(".json")) continue;
    let body;
    try { body = JSON.parse(text); } catch (e) { err(`${rel}: not valid JSON (${e.message})`); continue; }
    const sub = relative(dir, rel);
    if (/^variants\/[^/]+\/contributions\//.test(sub) && typeof body?.type === "string") validateContent(root, `contribution.${body.type}`, body, rel, err);
    else if (/^variants\/[^/]+\/submission\.json$/.test(sub)) validateContent(root, "problem", body, rel, err);
    else if (/^evidence\//.test(sub) && body?.body && body.stage) validateContent(root, "stage_evidence", body.body, rel, err);
  }
}

// A body must be valid for its content schema (same non-strict compile as lint.mjs).
const contentV = new Map();
function validateContent(root, id, body, rel, err) {
  const sp = join(root, "content-schemas", id, "schema.json");
  if (!existsSync(sp)) { err(`${rel}: no content schema '${id}'`); return; }
  if (!contentV.has(sp)) {
    const a = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
    ["version", "pack", "x-ui", "x-guidance", "x-checks", "x-version"].forEach((keyword) => a.addKeyword({ keyword }));
    const { id: _id, ...schema } = JSON.parse(readFileSync(sp, "utf8"));
    contentV.set(sp, a.compile(schema));
  }
  const v = contentV.get(sp);
  if (!v(body)) err(`${rel}: not valid for the ${id} content schema: ${fmt(v.errors)}`);
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

// Graduation thresholds (11-u09): schema, text scan, and the reply-allowance source must exist in limits.yaml (D-85).
export function lintThresholds(root) {
  const rel = "simulation/thresholds.yaml", abs = join(root, rel), errors = [];
  if (!existsSync(abs)) return [`${rel}: missing`];
  const text = readFileSync(abs, "utf8");
  scanText(rel, text, { pii: true }, (m) => errors.push(m));
  let doc;
  try { doc = parse(text); } catch (e) { return [...errors, `${rel}: not valid YAML (${e.message})`]; }
  // The 10-u03 test fixture keeps the placeholder `graduation: {}`; only that exact stub is tolerated (fixtures are outside 11-u09's writes).
  if (JSON.stringify(doc) === '{"graduation":{}}') return errors;
  if (!thresholdsV(doc)) return [...errors, `${rel}: fails thresholds schema: ${fmt(thresholdsV.errors)}`];
  const src = doc.g9.params.reply_allowance.limit_source.split("#")[1].split(".");
  let node; try { node = parse(readFileSync(join(root, "limits.yaml"), "utf8")); } catch { node = null; }
  for (const k of src) node = node?.[k];
  if (!node) errors.push(`${rel}: g9 reply_allowance.limit_source '${doc.g9.params.reply_allowance.limit_source}' does not exist in limits.yaml`);
  return errors;
}

// Every way a graduation threshold got looser from old to next. Numbers use the min_/max_ floor/ceiling rule of eval;
// true -> false, a shorter list and a removed key also count. Tightening (including null -> value) is allowed.
export function loosenedThresholds(old, next) {
  const out = [];
  const walk = (a, b, path) => {
    for (const [k, av] of Object.entries(a ?? {})) {
      const p = `${path}.${k}`, bv = b?.[k];
      if (av && typeof av === "object" && !Array.isArray(av)) { walk(av, bv, p); continue; }
      if (typeof av === "boolean" && av && bv !== true) out.push(`${p} ${av} -> ${bv}`);
      else if (Array.isArray(av) && !(Array.isArray(bv) && av.every((x) => bv.includes(x)))) out.push(`${p} lost a member`);
      else if (av === null || typeof av !== "number") continue;
      else out.push(...loosened({ [k]: av }, { [k]: bv }).map((d) => `${path}.${d}`));
    }
  };
  for (let n = 1; n <= 13; n++) walk(old?.[`g${n}`]?.params, next?.[`g${n}`]?.params, `g${n}`);
  return out;
}

// node tools/lint-simulation.mjs --diff-against <git ref>: fail when a threshold is looser than at that ref.
function diffAgainst(root, ref) {
  let old;
  try { old = execFileSync("git", ["-C", root, "show", `${ref}:./simulation/thresholds.yaml`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return []; } // new at ref: nothing to loosen
  return loosenedThresholds(parse(old), parse(readFileSync(join(root, "simulation", "thresholds.yaml"), "utf8"))).map((d) => `threshold loosened vs ${ref}: ${d}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ref = process.argv[process.argv.indexOf("--diff-against") + 1];
  const errs = [...lintSimulation(join(HERE, "..")), ...(process.argv.includes("--diff-against") ? diffAgainst(join(HERE, ".."), ref) : [])];
  errs.forEach((e) => console.error("lint-simulation: " + e));
  console.log(errs.length ? `lint-simulation: ${errs.length} error(s)` : "lint-simulation: ok");
  process.exit(errs.length ? 1 : 0);
}
