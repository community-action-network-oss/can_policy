# Writing a decision point (DP)

A DP is one narrow AI check, for example DP-NAMING. Everything for it lives in `decision-points/<DP-ID>/`. The directory is hashed into the base pack, so after any change run `npm run build:pack` and commit the regenerated `manifest.json` files.

## Add a DP

```
npm run new-dp -- DP-NAME --rules NAME-1 --outcomes publish,needs_revision,hold [--mode async] [--harmful]
```

This copies `decision-points/_template/` and fills the name, rules, outcomes, mode and default confidence floors. `--harmful` sets `min_recall_harmful` to 0.98 (privacy, naming, crisis, tone, legal classes). Then:

1. `prompt.md`: fill ROLE, OUTPUT and the field name on the `<<<DATA field=...` line. Keep the five `##` sections in order, `{{RULES}}` and `{{SHOTS}}` once each, and nothing after the closing `DATA>>>`. No other `{{...}}` variable is allowed, and the opener and closer strings must not appear anywhere else in the file.
2. `schema.json`: a copy of `schemas/dp-output.schema.json` with `outcome` narrowed. Keep every base property and required key unchanged; add DP-specific optional keys (for example `duplicate_of`) at the end of `properties`. The base forbids unknown keys, so a DP schema extends it by copying, and lint compares the copy.
3. `pack-section.yaml`: `dp`, `enforces`, `mode`, `inputs`, `outcomes`, `thresholds`. Its outcomes must equal the schema's. `escalate_human` is only for DP-CRISIS and DP-LEGAL.
4. `examples/`: one or more `.json` (array) or `.jsonl` files.
5. `eval/core.jsonl`, `eval/adversarial.jsonl`: held-out cases. `eval/thresholds.yaml`: the ratification gates.

## Case shape

```json
{"id":"ex-name-014","input":"The Road Works Office ignores reports; Mr. [PERSON_1] signs them off.",
 "expected_outcome":"needs_revision","rule_ids":["NAME-1"],
 "field_ref":{"field":"structural_statement","span":[44,56]},
 "revision_hint":"Name the office, not the person.",
 "note":"person named","provenance":"fixture","jurisdiction":"fiktiva-city"}
```

Required: `id`, `input`, `expected_outcome`, `rule_ids`, `note`, `provenance`, `jurisdiction`. Optional: `field_ref`, `revision_hint`, `shot` (true puts the case in the prompt as a few-shot), `expected` (an object for DP-specific output keys). Eval cases also require `field_ref`.

## What the lint checks

`npm run lint` runs `tools/lint-dp.mjs` on every directory except `_template`:

- required files exist; `schema.json` outcomes are among the six and equal `pack-section.yaml` outcomes; the schema keeps the base keys
- `escalate_human` only in DP-CRISIS and DP-LEGAL
- every `enforces` id exists in `packs/*/rules.yaml` (skipped with a printed reason if there is no registry)
- the prompt has the data delimiters exactly once, the right sections, and only the two allowed slots
- examples and eval cases have the right shape, use the DP's outcomes and rules, and have unique ids across the DP
- eval ids and inputs are disjoint from the examples (ignoring case and spacing)
- `thresholds.yaml` has `min_recall_harmful`, `max_false_reject`, `calibration_ece_max`, `schema_validity_min`, `injection_pass_min`, `parity_gap_max` and a `confidence_floor` map
- at least one example exists

## No real people

Every case is fictional or synthetic: no real person, address, phone, incident or live URL (use `example.org`). The lint flags non-example URLs, not names, so review for names yourself. No em or en dashes in any prompt or example.

## YAML subset

The server reads pack YAML with a small parser: block maps and lists, inline lists, scalars and comments. No anchors, multiline scalars or flow maps (`{a: 1}`).

## prompt_hash

`node tools/prompt-hash.mjs DP-NAME` prints sha256 (hex) of `prompt.md` above the `<<<DATA` line, CRLF normalised to LF, with `{{RULES}}` and `{{SHOTS}}` left as literal markers. This is the definition the server uses (plan 09). Edit the template above the data block and the hash changes.

## Adding lint rules

DP rules are the functions in `CHECKS` in `tools/lint-dp.mjs`; each receives the loaded DP and calls `x.err(message)`. This is the natural place to port the test-side schema checks later (for example `archive-record-challenge` and `planProblems()`), once their owners agree. They are not ported yet.
