# Ratification records

A ratification record says: this exact pack version and hash was approved by this person or panel, until this date, with this rollback plan. `can_server` reads the records and refuses to load a pack that has no valid one (FOUNDER-TRANS-1). Records live in `ratifications/<pack>-<semver>.md` and are append-only: a mistake is fixed by a new record, never by an edit.

Every pack in a chain (base, constitution, jurisdiction overlay) needs its own record. `ratifications/` is excluded from the pack hash at the pack root, so adding a record never changes the hash it ratifies.

## Who may be ratified

A fictional pack (`fictional: true` in `reviewer.yaml`) or a pack with `status: draft` must never carry a record. `npm run lint` fails if one does. The records for the slice 1 packs are written by the founder only when the packs are no longer draft. Until then `ratifications/` is empty on purpose.

## Fields

Front matter is YAML, between two `---` lines, using the same plain subset the server reads: block maps and lists, inline lists, scalars and comments. No anchors, no multiline scalars, no flow maps. Checked by `schemas/ratification.schema.json`.

| Field | Meaning |
|---|---|
| `pack` | Pack name, for example `base` |
| `version` | Full policy version, `name@semver+<first 12 hex of pack_hash>`. Must equal what `npm run build:pack` produces |
| `pack_hash` | 64 hex, from `manifest.json` of that pack |
| `method` | `founder_stewardship` today, `panel` later. See OQ-ratification-method |
| `approved_by` | Who approved. Required |
| `approved_at`, `expires_at` | `YYYY-MM-DD` or UTC `YYYY-MM-DDTHH:MM:SSZ`. `expires_at` is required; a past one is a warning |
| `rule_ids_touched`, `dps_touched`, `schemas_touched` | Lists, empty when none |
| `protected_core_check` | Must be `true`. The protected core is never edited from here |
| `eval_report_sha256`, `replay_report_sha256` | 64 hex digests of the reports attached to the PR |
| `rollback` | `previous_version`, `previous_hash` (both `null` for a first release), `triggers` (at least one), `notice_text` |
| `adversarial_gate` | `passed` or `deferred_with_reason`; the second needs `adversarial_reason` |
| `unreviewed_acknowledged` | Required `true` when the pack has `reviewed: false` in `reviewer.yaml` |
| `dissent` | List of recorded dissent, empty when none |

The body is the public log entry in plain words: who approved, why, and that founder stewardship is interim.

## What lint checks

- Schema, file name `<pack>-<semver>.md`, version suffix matches `pack_hash`.
- For the version in the tree, `pack_hash` and `version` match the pack built from the sources. Older records are not rechecked.
- Pack is not fictional and not draft.
- `node tools/lint-ratifications.mjs --against origin/main` fails when an existing record was edited, renamed or deleted. Run it in CI with the base ref.

## Legal corpora (LEGAL-CORPUS-1)

A record whose `pack` is a legal corpus id, or a corpus with `status: ratified`, is checked by `node tools/lint-legal-ratification.mjs [--against <ref>]` (also run by `npm run lint`, and in CI by the protected-core job). A corpus with no record and no review is reported as "unreviewed" and never fails; no review record is ever invented.

Review record, `packs/legal/<corpus>/review/*.md`, front matter:

| Field | Meaning |
|---|---|
| `reviewer`, `qualification`, `scope`, `date` | Required. The reviewer must be a named human (names such as claude, gpt, llm, bot, ai are refused) |
| `expires` | Required, must be in the future |
| `content_hash` | Must equal `content_hash` in `corpus.yaml`; a changed corpus needs a new review record |
| `authored_by: ai` | Allowed only with a named human reviewer |

Further checks: `topic-index.json` exists and `corpus.yaml` has `reviewed: true`. With `--against`, a changed `content_hash` with no added `review/` file fails, and commits with an `AI-Authored: true` trailer need a complete review record.

Citations: every object with `article_id` in `decision-points/**/examples`, `decision-points/**/eval` (json, jsonl, yaml) must be `{layer, article_id, corpus_version}` and resolve to an article in the corpus, with `corpus_version` equal to `<id>@<version>[+<hash12>]`. Ids of the form `L4/nl/statutes/art-1` in `prompt.md` must resolve too. `npm run eval` fails on an unresolved citation. Today every corpus is an `index_only` stub with no articles, so any citation fails.

`node tools/replay.mjs --legal` reads `legal_cites` (same shape) on base decisions and head recordings, and reports flips by layer and article plus an estimate of past resolutions that cite a changed article (for DP-RERESOLUTION). Without `--base`, every cited article counts as changed.

## Example (fictional pack, for reference only, not a real record)

```yaml
---
pack: "example-city"
version: "example-city@0.2.0+0123456789ab"
pack_hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
method: "founder_stewardship"
approved_by: "founder (interim steward)"
approved_at: "2030-01-15"
expires_at: "2030-07-15"
rule_ids_touched: [EX-RULE-1]
dps_touched: [DP-EXAMPLE]
schemas_touched: []
protected_core_check: true
eval_report_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
replay_report_sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
rollback:
  previous_version: "example-city@0.1.0+fedcba987654"
  previous_hash: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
  triggers: [false_hold_rate_over_threshold]
  notice_text: "We rolled back a rule change. Your item will be looked at again."
adversarial_gate: "passed"
unreviewed_acknowledged: true
dissent: []
---
Interim founder stewardship approves example-city 0.2.0 until a panel exists.
```
