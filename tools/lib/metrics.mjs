// Pure metric helpers for tools/eval.mjs. No I/O.
export const round = (x) => (x == null ? null : Math.round(x * 10000) / 10000);

// Wilson score interval, 95%. Returns [lo, hi]; n = 0 gives null.
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

// Expected calibration error, 10 equal-width bins. items: [{confidence, correct}].
export function ece(items, bins = 10) {
  if (!items.length) return null;
  const b = Array.from({ length: bins }, () => ({ n: 0, conf: 0, ok: 0 }));
  for (const { confidence, correct } of items) {
    const i = Math.min(bins - 1, Math.floor(confidence * bins));
    b[i].n++; b[i].conf += confidence; b[i].ok += correct ? 1 : 0;
  }
  return b.reduce((s, x) => s + (x.n ? (x.n / items.length) * Math.abs(x.ok / x.n - x.conf / x.n) : 0), 0);
}

// Max minus min accuracy across groups with at least minN cases. rows: [{group, correct}].
export function parityGap(rows, minN = 3) {
  const g = new Map();
  for (const { group, correct } of rows) { const a = g.get(group) ?? [0, 0]; a[0] += correct ? 1 : 0; a[1]++; g.set(group, a); }
  const acc = [...g.values()].filter(([, n]) => n >= minN).map(([k, n]) => k / n);
  return { gap: acc.length >= 2 ? Math.max(...acc) - Math.min(...acc) : null, groups: acc.length, small: g.size - acc.length };
}

export const normInput = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();

// Examples must not overlap eval cores by id or normalized input. Shared with the DP lint.
export function disjointness(examples, evalCases) {
  const ids = new Set(examples.map((c) => c.id)), ins = new Set(examples.map((c) => normInput(c.input ?? "")));
  return evalCases.flatMap((c) => [ids.has(c.id) && `id ${c.id} also in examples/`, ins.has(normInput(c.input ?? "")) && `input of ${c.id} also in examples/`].filter(Boolean));
}

// Threshold direction: min_x / x_min are floors (lower is looser); max_x / x_max are ceilings (higher is looser).
const dir = (k) => (/^min_|_min$/.test(k) ? "floor" : /^max_|_max$/.test(k) ? "ceil" : null);

// Returns human-readable descriptions of every threshold that became looser from old to next.
export function loosened(old, next) {
  const out = [];
  const cmp = (key, a, b) => {
    if (typeof a !== "number") return;
    if (typeof b !== "number") return out.push(`${key} removed (was ${a})`);
    const d = key.startsWith("confidence_floor.") ? "floor" : dir(key);
    if ((d === "floor" && b < a) || (d === "ceil" && b > a)) out.push(`${key} ${a} -> ${b}`);
  };
  for (const [k, a] of Object.entries(old ?? {})) {
    if (k === "confidence_floor") for (const [o, v] of Object.entries(a ?? {})) cmp(`confidence_floor.${o}`, v, next?.confidence_floor?.[o]);
    else cmp(k, a, next?.[k]);
  }
  return out;
}
