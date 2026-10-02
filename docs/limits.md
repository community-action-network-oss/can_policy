# limits.yaml

Caps, field bounds and cooldowns are pack values. Code reads them and never holds a number. The file is hashed into the base pack. It is checked by `schemas/limits.schema.json` and by `tools/lint.mjs`.

## Keys

| Key | Default | Meaning | Open question |
|---|---|---|---|
| `caps.problems_per_account_per_period` | 3 per 7 days | Problems one account may submit | OQ-limits |
| `caps.contributions_per_account_per_day` | 20 total, 8 per problem | All contribution types except exempt ones | OQ-limits |
| `caps.proposals_per_account_per_problem` | 2 | Proposals on one problem | OQ-limits |
| `caps.open_drafts_per_account` | 5 | Unsubmitted drafts | OQ-limits |
| `caps.appeals_per_account_per_period` | 3 per 7 days | Appeals | OQ-limits |
| `fields.<type>.<field>.min_chars`, `max_chars` | none yet | Meaningful length bounds, equal to the schema `x-guidance` bounds | OQ-limits |
| `fields.<type>.list.min`, `max` | none yet | List sizes | OQ-limits |
| `cooldowns.between_contributions_same_problem` | 120 seconds, provisional | Reflection delay | OQ-cooldown-lengths |
| `cooldowns.after_rejected_contribution` | 600 seconds, provisional | Delay after a reject | OQ-cooldown-lengths |
| `cooldowns.exempt_types` | progress_update, verification_evidence | Never delayed, not counted in the daily cap | OQ-cooldown-lengths |
| `grace.schema_major_draft_days` | 30 days | Old-major drafts stay usable | none |
| `risk_period.burst_threshold` | hidden, provisional | Burst that tightens caps | none |

Every leaf carries a `note`. A leaf may carry `provisional: true`. Unknown keys, negative numbers and `min_chars` above `max_chars` fail the lint.

## Single source of truth

`limits.yaml` owns bounds. For a type with a content schema, each `fields.<type>.<field>` must name a property of that schema and its `min_chars` and `max_chars` must equal the `x-guidance` bounds of that property. Types without a schema yet are not checked.

## Hidden values

A leaf with `public: false` is never returned in an explanation, an error body or a log the public can read. Today that is `risk_period.burst_threshold`. Explanations name the limit that applied and when to retry, never a hidden value.

Example of a rate-limit explanation:

```text
You have reached the limit for new contributions on this problem for now.
Please wait a little while and try again. Your draft is saved.
```

## Changing a value

A change is a policy PR. It includes a replay showing what would have been blocked under the old and the new values (`npm run replay`).
