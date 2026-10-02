// Recorded model responses for the eval runner. No network, no keys: recordings are files.
// Format (JSONL): {case_id, model_id, output}. derive() builds synthetic ones from the case table.
import { readFileSync, existsSync } from "node:fs";

export const FAKE_MODEL_ID = "fake-derived-v1";

export function loadRecordings(file) {
  const map = new Map();
  if (!existsSync(file)) return map;
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    let r;
    try { r = JSON.parse(line); } catch { throw new Error(`${file} line ${i + 1}: not valid JSON`); }
    if (typeof r.case_id !== "string" || !("output" in r)) throw new Error(`${file} line ${i + 1}: needs case_id and output`);
    if (map.has(r.case_id)) throw new Error(`${file} line ${i + 1}: duplicate recording for ${r.case_id}`);
    map.set(r.case_id, r);
  });
  return map;
}

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Echo the expected outcome; with noise > 0 a seeded share of cases get a different outcome from the schema's enum.
export function deriveFake(cases, schema, { noise = 0, seed = 1 } = {}) {
  const rnd = mulberry32(seed), props = schema?.properties ?? {}, enums = props.outcome?.enum ?? [];
  return cases.map((c) => {
    let outcome = c.expected_outcome;
    if (noise > 0 && rnd() < noise) { const others = enums.filter((o) => o !== outcome); if (others.length) outcome = others[Math.floor(rnd() * others.length)]; }
    const output = { outcome, rule_ids: outcome === c.expected_outcome ? c.rule_ids : [], confidence: c.expected?.confidence ?? 0.95, reasons: ["synthetic recording derived from the case table"] };
    if (c.field_ref && "field_ref" in props) output.field_ref = c.field_ref;
    if (c.revision_hint && "revision_hint" in props && outcome === c.expected_outcome) output.revision_hint = c.revision_hint;
    for (const [k, v] of Object.entries(c.expected ?? {})) if (k in props && !(k in output)) output[k] = v;
    return { case_id: c.id, model_id: FAKE_MODEL_ID, output };
  });
}

export const toJsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
