// Pure replay-diff engine. No I/O. Shape documented in docs/replay.md and schemas/replay-report.schema.json.
import { round } from "./metrics.mjs";

// Aggregation order from decision-points.md: higher is stricter.
export const OUTCOME_RANK = { publish: 0, hold: 1, needs_revision: 2, reject: 3, route_external: 4, escalate_human: 5 };
// Rule enforcement order from packs/*/rules.yaml: used when outcomes are equal but the cited rules differ.
export const ENFORCE_RANK = { advisory: 0, needs_revision: 1, reject: 2, hold: 3 };
export const PROTECTED_TIERS = new Set(["rights", "crisis_safety", "privacy"]);
// Decision points whose every flip counts as protected tier.
export const PROTECTED_DPS = new Set(["DP-APPEAL", "DP-CRISIS", "DP-PRIVACY"]);
export const DEFAULT_LIMITS = { minor_flip_pct: 5, cost_per_run: 0 };

const sameSet = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const bump = (o, k, f) => { o[k] ??= { flips: 0, stricter: 0, more_permissive: 0, lateral: 0 }; o[k].flips++; o[k][f]++; };

// rules: Map id -> {tier, enforcement}; protectedCore: Set of ids.
export function classify(base, head, rules) {
  const fieldDiff = (base.field_ref?.field ?? null) !== (head.field_ref?.field ?? null);
  const flip = base.outcome !== head.outcome || !sameSet(base.rule_ids, head.rule_ids) || fieldDiff;
  if (!flip) return { flip, direction: "none" };
  if (base.outcome !== head.outcome) {
    const a = OUTCOME_RANK[base.outcome], b = OUTCOME_RANK[head.outcome];
    if (a === undefined || b === undefined) throw new Error(`unknown outcome ${a === undefined ? base.outcome : head.outcome}`);
    return { flip, direction: b > a ? "stricter" : "more_permissive" };
  }
  const top = (ids) => Math.max(-1, ...ids.map((id) => {
    const r = rules.get(id);
    if (!r) throw new Error(`unknown rule id ${id}`);
    return ENFORCE_RANK[r.enforcement] ?? 0;
  }));
  const a = top(base.rule_ids), b = top(head.rule_ids);
  return { flip, direction: b > a ? "stricter" : b < a ? "more_permissive" : "lateral" };
}

// decisions: base rows (decision-point's recorded outcome). heads: Map decision_id -> {outcome, rule_ids, confidence, field_ref?}.
export function buildReport({ decisions, heads, rules, protectedCore, motivating = new Set(), limits = DEFAULT_LIMITS, bump: bumpKind = "minor" }) {
  const warnings = [], blockers = [], flips = [];
  const by = { direction: { stricter: 0, more_permissive: 0, lateral: 0 }, dp: {}, rule: {}, jurisdiction: {} };
  const perDp = {};
  const t = { decisions: decisions.length, flips: 0, expected: 0, unintended: 0, protected_flips: 0 };
  const n = decisions.length;
  for (const d of [...decisions].sort((x, y) => (x.decision_id < y.decision_id ? -1 : 1))) {
    const h = heads.get(d.decision_id);
    if (!h) throw new Error(`no head recording for ${d.decision_id}`);
    const head = { ...h, field_ref: h.field_ref ?? d.field_ref };
    const pd = (perDp[d.dp] ??= { decisions: 0, flips: 0 });
    pd.decisions++;
    if (d.dp === "DP-APPEAL" && head.outcome === "reject") blockers.push(`${d.decision_id}: DP-APPEAL proposed reject, which it can never produce`);
    const c = classify(d, head, rules);
    if (!c.flip) continue;
    const ids = [...new Set([...d.rule_ids, ...head.rule_ids])].sort();
    const prot = PROTECTED_DPS.has(d.dp) || ids.some((id) => protectedCore.has(id) || PROTECTED_TIERS.has(rules.get(id)?.tier));
    const label = motivating.has(d.decision_id) ? "expected" : "unintended";
    t.flips++; t[label]++; pd.flips++;
    if (prot) t.protected_flips++;
    by.direction[c.direction]++;
    bump(by.dp, d.dp, c.direction);
    bump(by.jurisdiction, d.jurisdiction, c.direction);
    for (const id of ids.length ? ids : ["(none)"]) bump(by.rule, id, c.direction);
    // Only masked refs: the field and span, never the input text.
    flips.push({ decision_id: d.decision_id, dp: d.dp, jurisdiction: d.jurisdiction, stratum: d.stratum ?? null, field_ref: d.field_ref ?? null, from: { outcome: d.outcome, rule_ids: d.rule_ids }, to: { outcome: head.outcome, rule_ids: head.rule_ids }, direction: c.direction, label, protected: prot, confidence_delta: round(head.confidence - d.confidence) });
    if (prot && (label === "unintended" || c.direction === "more_permissive")) blockers.push(`${d.decision_id}: ${label} ${c.direction} flip in a protected tier (${ids.join(", ") || d.dp})`);
  }
  const dpStats = {};
  for (const [dp, s] of Object.entries(perDp)) {
    const pct = round((100 * s.flips) / s.decisions);
    dpStats[dp] = { decisions: s.decisions, flips: s.flips, flip_pct: pct };
    if (bumpKind !== "major" && pct > limits.minor_flip_pct) blockers.push(`${dp}: flip share ${pct}% is over the ${limits.minor_flip_pct}% limit`);
  }
  let verdict = "ok";
  if (!n) { verdict = "no_data"; warnings.push("no data: the replay set is empty, nothing was checked"); }
  else if (blockers.length) verdict = "blocked";
  else if (t.unintended) verdict = "needs_review";
  return {
    schema_version: 1, verdict, bump: bumpKind, limits: { ...limits },
    totals: t, by_direction: by.direction,
    by_dp: sortObj(by.dp), by_rule: sortObj(by.rule), by_jurisdiction: sortObj(by.jurisdiction), dp_stats: sortObj(dpStats),
    flips, blockers, warnings,
    remoderation: { volume: t.flips, estimated_cost: round(t.flips * limits.cost_per_run) },
  };
}

export function renderMd(r) {
  const L = [`## Replay diff: ${r.verdict}`, ""];
  if (r.verdict === "no_data") L.push("No data: the replay set is empty.", "");
  L.push(`${r.totals.flips} flips in ${r.totals.decisions} decisions (stricter ${r.by_direction.stricter}, more permissive ${r.by_direction.more_permissive}, lateral ${r.by_direction.lateral}). Expected ${r.totals.expected}, unintended ${r.totals.unintended}, protected tier ${r.totals.protected_flips}.`, "");
  L.push(`Re-moderation volume ${r.remoderation.volume}, estimated cost ${r.remoderation.estimated_cost}.`, "");
  if (r.blockers.length) L.push("### Blockers", "", ...r.blockers.map((b) => `- ${b}`), "");
  if (r.flips.length) {
    L.push("### Flips", "", "| Decision | DP | Jurisdiction | Field | From | To | Direction | Label |", "|---|---|---|---|---|---|---|---|");
    for (const f of r.flips.slice(0, 20)) L.push(`| ${f.decision_id} | ${f.dp} | ${f.jurisdiction} | ${f.field_ref?.field ?? ""}${f.field_ref?.span ? ` [${f.field_ref.span}]` : ""} | ${f.from.outcome} | ${f.to.outcome} | ${f.direction} | ${f.label}${f.protected ? " (protected)" : ""} |`);
    if (r.flips.length > 20) L.push("", `${r.flips.length - 20} more flips are in the JSON report.`);
    L.push("");
  }
  if (r.warnings.length) L.push("### Warnings", "", ...r.warnings.map((w) => `- ${w}`), "");
  return L.join("\n").replace(/\n+$/, "\n");
}
