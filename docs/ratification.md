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
