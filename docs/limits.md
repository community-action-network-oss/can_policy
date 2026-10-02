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
| `archive.rank_weights.<dimension>` | problem_type 0.25, constraints 0.15, resources_budget 0.15, scale 0.10, geography_climate 0.10, institutions 0.10, legal_stack 0.10, language 0.05 | Reuse score weights, must sum to 1.0 | OQ-limits |
| `archive.completeness_bonus`, `archive.solved_bonus` | 0.05, 0.05 | Score bonus for a complete record, for a solved outcome | OQ-limits |
| `archive.derank_factor` | 0.5 | Multiplier for a demoted candidate | OQ-limits |
| `archive.min_candidate_score` | 0.35 | Lowest score ever shown | OQ-limits |
| `archive.rrf_k`, `archive.top_k_fusion`, `archive.top_n_shown`, `archive.max_per_source_problem` | 60, 30, 5, 2 | Fusion constant, candidates per retriever, suggestions shown, per source problem | OQ-limits |
| `archive.taxonomy` | `content-schemas/problem/taxonomy.yaml` | One file of problem type and category ids; the file is added by a later unit | OQ-limits |
| `archive.cross_language_recall_floor` | 0.7 | Eval recall needed before a language is served | OQ-limits |
| `metrics.min_n` | 20 | Smallest sample before a rate is shown | OQ-limits |
| `suggestions.debounce_trailing_seconds`, `suggestions.idle_typing_seconds` | 5, 1.5 | Trailing run delay per draft, idle typing before a change event | OQ-limits |
| `suggestions.max_runs_per_hour_per_draft` | 6 | Runs per draft per hour | OQ-limits |
| `suggestions.stage_draft_expiry_days` | 30 | Untouched stage draft expires | OQ-limits |
| `suggestions.run_budget_micro_usd` | 20000 | Cost ceiling of one run | OQ-limits |
| `review.quorum_completed_reviews` | 3 | Completed reviews for a quorum (D-74); at least one completed review is a code constant | OQ-limits |
| `review.recommendation_open_max_days`, `review.publish_anyway_after_days` | 7, 14 | Recommendation open time, days before publish anyway (D-74) | OQ-limits |
| `stage.auto_start_default` | false | A stage does not start by itself | OQ-limits |
| `location.k_min_cells`, `location.h3_resolution` | 25, 8 | Fewest cells in an area, H3 resolution | OQ-h3-resolution |
| `location.challenge_ttl_seconds` | 120 | Life of a location challenge | OQ-limits |
| `location.rate_per_account_per_area_per_hour`, `location.rate_per_account_per_day` | 10, 40 | Hidden. Checks per account before guest | OQ-limits |
| `location.impacted_cap_per_area_per_day` | 200 | Hidden. Impacted labels per area per day | OQ-limits |
| `location.surge_new_account_days` | 7 | Hidden. Age under which an account counts as new | OQ-limits |
| `location.plausibility_max_speed_kmh` | 900 | Hidden. Fastest plausible movement | OQ-limits |
| `location.history_ttl_hours` | 24 | Rate counters live this long, no location is stored | OQ-limits |

Every leaf carries a `note`. A leaf may carry `provisional: true`. Unknown keys, negative numbers and `min_chars` above `max_chars` fail the lint.

The new blocks (`archive`, `metrics`, `suggestions`, `review`, `stage`, `location`) are optional in the schema, so a pack without them still lints. Readers default when a key is absent. The `location` values touch only counters keyed on account id and area, never a position. The `archive` values tune ranking and never relax personal-data stripping.

## Single source of truth

`limits.yaml` owns bounds. For a type with a content schema, each `fields.<type>.<field>` must name a property of that schema and its `min_chars` and `max_chars` must equal the `x-guidance` bounds of that property. Types without a schema yet are not checked.

## Hidden values

A leaf with `public: false` is never returned in an explanation, an error body or a log the public can read. Today that is `risk_period.burst_threshold` and the `location` rate, cap, surge and speed values. Explanations name the limit that applied and when to retry, never a hidden value.

Example of a rate-limit explanation:

```text
You have reached the limit for new contributions on this problem for now.
Please wait a little while and try again. Your draft is saved.
```

## Changing a value

A change is a policy PR. It includes a replay showing what would have been blocked under the old and the new values (`npm run replay`).
