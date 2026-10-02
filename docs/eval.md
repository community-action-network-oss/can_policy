# Eval runner

`npm run eval` scores recorded model responses against each decision point (DP) and gates on `decision-points/<DP>/eval/thresholds.yaml`. It never calls a model or a network service and holds no keys.

## Commands

- `npm run eval -- --strict --json .tmp/eval.json` : score every DP. `--dp DP-X` limits to one.
- `npm run eval -- --derive-fake [--noise 0.1] [--seed 1]` : write synthetic recordings from the case table (the expected outcome, confidence 0.95, optionally a seeded share of wrong outcomes).
- `--diff-against <git ref>` : fail if any threshold file became looser than at that ref.
- `--root <dir>` and `--recordings <dir>` : point at another tree (used by tests).

Exit code: 0 pass, 1 did not pass, 2 usage or file error.

## Recordings

One file per DP at `test/fixtures/eval/recordings/<DP>.jsonl`, one object per line: `{case_id, model_id, output}`, where `output` follows the DP's `schema.json`. The committed files are synthetic, produced by `--derive-fake`. Regenerate them after changing any eval case. A case with no recording is an `unrecorded` finding: not a fail, but it blocks `--strict`.

Sets read from `eval/`: `core`, `adversarial`, and `privacy` and `parity` when present.

## Metrics

| Metric | Formula | Gate key |
|---|---|---|
| schema_validity | valid outputs / recorded cases (all sets) | `schema_validity_min` |
| recall_harmful | core and privacy cases expecting a non-publish outcome where the output is also non-publish / those cases | `min_recall_harmful` |
| false_reject | core and privacy cases expecting publish where the output is not publish / those cases | `max_false_reject` |
| calibration_ece | sum over 10 equal bins of (bin share) x abs(accuracy - mean confidence); correct = outcome equals expected | `calibration_ece_max` |
| injection_pass | adversarial cases with the expected outcome / adversarial cases | `injection_pass_min` |
| parity_gap | max minus min accuracy across groups of 3 or more cases, by jurisdiction and by `lang: xx` tag in `note`; the larger of the two gaps | `parity_gap_max` |
| citation_correctness | valid outputs whose rule ids are all in the DP's `enforces` and whose `field_ref.field` is a labelled input line or the case's own field | report only |
| confidence_floor_misses | correct outputs below their outcome's `confidence_floor` | report only |

Recall and injection pass also print a Wilson 95% lower bound. A metric with no cases is not scored. Threshold keys the runner does not know (for example `max_discourage_rate`) are listed as `ignored threshold keys` and do not fail the run.

## Reading the report

Each DP prints one line per gated metric: `pass` or `did not pass`, value, operator, threshold. Under it come the named case ids behind a failure (`missed harmful`, `false rejects`, `injection fails`, `schema invalid`, `bad citations`) and warnings. With fewer than 20 core cases the report warns `small sample`: the gate uses the point estimate, so read the lower bound before trusting a clean pass. The JSON report has stable key order and no timestamps, so two runs are byte-identical.

## Stricter-PR rule

Never loosen a threshold in the PR that needs the looser value. CI runs `--diff-against` with the base ref; a lowered floor (`min_*`, `*_min`, `confidence_floor.*`), a raised ceiling (`max_*`, `*_max`) or a removed numeric key fails. Loosen in its own PR with a ratification record.

## Disjointness

`disjointness()` in `tools/lib/metrics.mjs` fails a DP whose eval core shares an id or a normalized input (trimmed, whitespace collapsed, lower-cased) with `examples/`. The runner reports it as a failure. The DP lint already checks inputs; it can import this function to share the code.
