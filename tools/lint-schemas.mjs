// Content-schema completability lint. lintSchemas(root, notes, opts) returns readable errors; non-failing findings go to notes.
// Checks: widgets, required fields complete, DP references, message ids, guidance examples, always-on DPs, bounds, dashes.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIDGETS = JSON.parse(readFileSync(join(HERE, "widgets.json"), "utf8"));
const ALWAYS_ON = ["DP-PRIVACY", "DP-NAMING", "DP-TONE", "DP-CRISIS", "DP-ASSUMPTIONS", "DP-COMPLETENESS"];
const PROSE_DPS = ["DP-PRIVACY", "DP-NAMING", "DP-TONE"]; // enforced on textarea; see note on the full list
// Real gaps found when this lint was written (W15 10-u13): messages no schema node uses. The schemas are owned by earlier units, so each is listed
// here and reported as a note; an entry that is fixed or whose message is removed fails as stale, so the list can only shrink.
const KNOWN_UNUSED = new Set([
  "review_recommendation|schema.review_recommendation.status.help",
  "stage_draft|schema.stage_draft.derived_from.source_url.label",
  "stage_draft|schema.stage_draft.derived_from.source_url.help",
  "stage_draft|schema.stage_draft.derived_from.license.label",
  "stage_draft|schema.stage_draft.derived_from.license.help",
]);
const BANNED = /[—–]/;
const rd = (p) => JSON.parse(readFileSync(p, "utf8"));
const kids = (n) => [...Object.entries(n.properties ?? {}), ...(n.items && typeof n.items === "object" && !Array.isArray(n.items) ? [["[]", n.items]] : [])];

// Walks properties and items only (not if/then/oneOf, whose "required" refers to the parent's properties).
// opaque is true under a readonly or hidden node: its children are shown whole or not at all, so they need no widget or label.
function* nodes(n, path = "", opaque = false) {
  yield [path, n, opaque];
  const o = opaque || ["readonly", "hidden"].includes(n["x-ui"]?.widget);
  for (const [k, c] of kids(n)) yield* nodes(c, `${path}/${k}`, o);
  if (!path) for (const [k, c] of Object.entries(n.$defs ?? {})) yield* nodes(c, `/$defs/${k}`, false);
}

// DP ids from the superproject design doc (read-only). null when the doc is absent.
export function docDps(path) {
  if (!existsSync(path)) return null;
  return new Set(readFileSync(path, "utf8").match(/DP-[A-Z][A-Z-]*[A-Z]/g) ?? []);
}

// opts: { dpDoc, strictGuidance, strictAlwaysOn }
export function lintSchemas(root, notes = [], opts = {}) {
  const errors = [];
  const base = join(root, "content-schemas");
  if (!existsSync(base)) return errors;
  const dpDoc = docDps(opts.dpDoc ?? join(root, "..", "docs", "design", "ai", "decision-points.md"));
  if (!dpDoc) notes.push("lint-schemas: decision-points.md not found, DP ids are checked against decision-points/ directories only");
  const dpDirs = new Set(existsSync(join(root, "decision-points")) ? readdirSync(join(root, "decision-points")) : []);
  const known = new Set(), pendingDps = new Set(), pendingWidgets = new Map(), noGuidance = new Set(), weakProse = new Set();

  for (const type of readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("_")).map((d) => d.name)) {
    const rel = `content-schemas/${type}`;
    const sp = join(root, rel, "schema.json");
    if (!existsSync(sp)) continue;
    let s; try { s = rd(sp); } catch { continue; } // reported by lint.mjs
    const E = (m) => errors.push(`${rel}/schema.json: ${m}`);
    const mp = join(root, rel, "messages.en.json");
    let msgs = null; try { msgs = existsSync(mp) ? rd(mp) : null; } catch { errors.push(`${rel}/messages.en.json: not valid JSON`); }
    if (!msgs) E("missing messages.en.json");
    const used = new Set(), groups = new Set();
    const useMsg = (id, at) => { used.add(id); if (msgs && !(id in msgs)) E(`${at}: message id '${id}' is not in messages.en.json`); };

    for (const [path, n, opaque] of nodes(s)) {
      const at = path || "/";
      const u = n["x-ui"], g = n["x-guidance"], c = n["x-checks"];
      if (u) {
        for (const [k, v] of Object.entries(u)) if (/_msg$/.test(k) && typeof v === "string") useMsg(v, `${at} x-ui.${k}`);
        if (u.group) groups.add(u.group);
        const w = u.widget, known = WIDGETS.renderer[w] ?? WIDGETS.pending[w];
        if (!known) {
          if (u.fallback !== "text") E(`${at}: widget '${w}' is not in tools/widgets.json (and no x-ui.fallback "text")`);
        } else if (!WIDGETS.renderer[w]) {
          if (!pendingWidgets.has(w)) pendingWidgets.set(w, new Set());
          pendingWidgets.get(w).add(type);
        }
      }
      // (a) required children have a widget and a label
      if (!opaque) for (const r of n.required ?? []) {
        const q = n.properties?.[r];
        if (!q) continue; // conditional blocks are not walked, so a required name without a property is a real gap
        const qu = q["x-ui"];
        if (!qu?.widget) E(`${at}/${r}: required property has no x-ui.widget`);
        else if (qu.widget !== "hidden" && !qu.label_msg) E(`${at}/${r}: required property has no x-ui.label_msg`);
      }
      for (const r of n.required ?? []) if (n.properties && !n.properties[r]) E(`${at}: required '${r}' is not a property here`);
      // (b) DP references
      for (const dp of [...(c?.dps ?? [])]) {
        if (dpDirs.has(dp)) continue;
        if (dpDoc?.has(dp)) pendingDps.add(dp);
        else if (dpDoc) E(`${at}: x-checks.dps names '${dp}', which has no directory and is not in decision-points.md`);
        else pendingDps.add(dp);
      }
      // (e) always-on DPs on free prose
      if (u?.widget === "textarea" && c?.dps) {
        const need = opts.strictAlwaysOn ? ALWAYS_ON : PROSE_DPS;
        const miss = need.filter((d) => !c.dps.includes(d));
        if (miss.length) { if (opts.strictAlwaysOn) E(`${at}: x-checks.dps lacks always-on ${miss.join(", ")}`); else weakProse.add(type); }
      }
      // (d) guidance examples need an eval case
      if (g && (g.good !== undefined || g.bad !== undefined)) noGuidance.add(type);
      // (f) schema bounds equal x-guidance bounds on strings
      if (g && n.type === "string" && g.min_chars !== undefined) {
        if (g.min_chars !== n.minLength || g.max_chars !== n.maxLength) E(`${at}: x-guidance ${g.min_chars}..${g.max_chars} differs from schema minLength/maxLength ${n.minLength}..${n.maxLength}`);
      }
    }
    // (c) unused messages (group labels count as used when some x-ui.group names them)
    if (msgs) for (const id of Object.keys(msgs)) {
      if (used.has(id)) continue;
      const m = id.match(/\.group\.(.+)$/);
      if (m && groups.has(m[1])) continue;
      if (opts.knownUnused !== false && KNOWN_UNUSED.has(`${type}|${id}`)) { known.add(`${type}|${id}`); continue; }
      errors.push(`${rel}/messages.en.json: message '${id}' is not used by the schema`);
    }
    // (g) dashes, including inside message text
    for (const f of ["schema.json", "messages.en.json"]) if (existsSync(join(root, rel, f)) && BANNED.test(readFileSync(join(root, rel, f), "utf8"))) errors.push(`${rel}/${f}: contains an em or en dash`);
  }

  // (d) eval lookup: a good/bad string must be in some decision-points/*/eval/*.jsonl case
  const evalText = [];
  for (const d of dpDirs) { const e = join(root, "decision-points", d, "eval"); if (existsSync(e)) for (const f of readdirSync(e)) if (f.endsWith(".jsonl")) evalText.push(readFileSync(join(e, f), "utf8")); }
  if (opts.strictGuidance) {
    const all = evalText.join("\n");
    for (const type of noGuidance) {
      const sp = rd(join(base, type, "schema.json"));
      for (const [path, n] of nodes(sp)) for (const k of ["good", "bad"]) { const v = n["x-guidance"]?.[k]; if (v !== undefined && !all.includes(JSON.stringify(v).slice(1, -1))) errors.push(`content-schemas/${type}/schema.json: ${path || "/"} x-guidance.${k} is in no decision-points eval case`); }
    }
  } else if (noGuidance.size) notes.push(`lint-schemas: x-guidance examples in ${noGuidance.size} schemas are not yet checked against eval sets (${evalText.length ? "eval sets exist, pass strictGuidance" : "no eval sets exist yet"})`);
  if (opts.knownUnused !== false) for (const k of KNOWN_UNUSED) if (!known.has(k) && existsSync(join(base, k.split("|")[0]))) errors.push(`lint-schemas: KNOWN_UNUSED entry '${k}' is stale, remove it`);
  if (known.size) notes.push(`lint-schemas: ${known.size} known unused messages (escalated, see KNOWN_UNUSED): ${[...known].join(", ")}`);
  if (pendingDps.size) notes.push(`lint-schemas: DPs without a directory yet (allowed, listed in decision-points.md): ${[...pendingDps].sort().join(", ")}`);
  if (pendingWidgets.size) notes.push(`lint-schemas: widgets the app renderer does not render yet: ${[...pendingWidgets].map(([w, t]) => `${w} (${[...t].join(", ")})`).join("; ")}`);
  if (weakProse.size) notes.push(`lint-schemas: textarea fields lacking DP-PRIVACY/NAMING/TONE in ${weakProse.size} schemas: ${[...weakProse].join(", ")}`);
  return errors;
}
