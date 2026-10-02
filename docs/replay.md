# Replay diff report

`npm run replay` re-checks a proposed pack against past decisions, offline. No model or network call; inputs are synthetic and masked. Method: `docs/design/ai/amendment-loop.md` section 3. The server and app read the JSON in 10-u32 and 10-u39.

## Inputs

| Flag | Default | Meaning |
|---|---|---|
| `--decisions` | `test/fixtures/replay/decisions.jsonl` | Base side. One row per decision: `decision_id, dp, jurisdiction, language, redacted_input, outcome, rule_ids, field_ref, confidence, stratum` (`stratum`: appealed, near_threshold, random). |
| `--head-recordings` | `test/fixtures/replay/head.jsonl` | Head side, the eval recording format: `{case_id, model_id, output: {outcome, rule_ids, confidence}}` with `case_id` equal to `decision_id`. A missing one is an input error. |
| `--motivating` | none | File of decision ids, one per line. Flips on these are `expected`, all others `unintended`. |
| `--head`, `--base` | this repo | Pack roots read for rule `tier`, `enforcement` and `protected_core`. Directories only; a git ref is not supported (check it out first). A rule protected on either side counts. |
| `--bump` | `minor` | `major` skips the flip share limit. |
| `--json`, `--md` | print Markdown | Output files. |

Limits come from `replay_limits` in `limits.yaml` when present, else the defaults `minor_flip_pct: 5` and `cost_per_run: 0`.

## Flips and direction

A decision flips when outcome, rule ids or field differ. Direction:

- Outcomes differ: by the aggregation order `publish < hold < needs_revision < reject < route_external < escalate_human` (higher is `stricter`).
- Same outcome, different rules: by the highest rule enforcement on each side, `advisory < needs_revision < reject < hold`.
- Only the field differs: `lateral`.

A confidence change alone is not a flip; it is shown as `confidence_delta` on flips.

## Verdict and exit code

- `blocked` (exit 1): a flip in a protected tier that is unintended or more permissive; any DP-APPEAL row proposing `reject`; a DP whose flip share is over `minor_flip_pct` (not on a major bump).
- `needs_review` (exit 0): unintended flips, none blocking.
- `ok` (exit 0): nothing unintended.
- `no_data` (exit 0, warning): empty replay set.
- Exit 2: bad arguments or input.

A flip is protected tier when it cites any `protected_core` rule, any rule of tier rights, crisis_safety or privacy, or belongs to DP-APPEAL, DP-CRISIS or DP-PRIVACY.

## JSON report

Schema: `schemas/replay-report.schema.json`. Keys are sorted, so the same inputs give identical bytes.

- `verdict`, `bump`, `limits`, `totals` (decisions, flips, expected, unintended, protected_flips)
- `by_direction`, `by_dp`, `by_rule`, `by_jurisdiction` (counts per direction), `dp_stats` (decisions, flips, flip_pct)
- `flips`: one entry per flip with `from`/`to` outcome and rule ids, `field_ref` (field and span only, never the input text), `direction`, `label`, `protected`, `confidence_delta`
- `blockers`, `warnings`, `remoderation` (`volume` = flips, `estimated_cost` = flips x `cost_per_run`)
