# Archive eval set (evals/archive)

Labelled data that measures archive retrieval and DP-REUSE-FIT (design: `docs/design/ai/archive-reuse.md` section 10). It is **synthetic**: seeds 1 and 2 (synthetic evidence on the host `evidence.sim.test`, real-city framing, no real claims) and the fictional jurisdictions `fiktiva-city` and `fiktiva-north` (planted legal differences, `packs/jurisdictions/fiktiva-north/README.md`). The Amsterdam overlay is the unreviewed skeleton. Nothing here is a real person, incident or law.

The runner and the register gate are unit 13-u19. Until real model runs exist the recordings are FAKE, so nothing in this set can satisfy graduation or choose an embedding model (`fake_recordings_satisfy: false` in `thresholds.yaml`).

## Layout

| Path | Holds |
|---|---|
| `records/*.json` | 27 `archive_record` documents (`source: simulation`), one file per record, file name is the id |
| `record-meta.json` | seed, jurisdiction, variant and language of each record; `stale_pin` marks a deliberately old corpus pin |
| `queries/*.json` | 31 query problems: `core`, `paraphrases`, `translations`, `distractors` |
| `fit/legality.json` | planted illegal-at-L2 to L6 options, reference-layer L1 holds (`unknown`) with the expected layer and article, plus lawful controls |
| `fit/budget.json` | planted over-budget paths (`exceeds` with the gap) and fits controls |
| `fit/stale.json` | expected stale-corpus flags per record and target jurisdiction |
| `fit/holds.json` | missing-corpus and unresolved-stack holds, plus no-hold guards |
| `fit/differences.json` | stated context differences per query and record pair, true and planted false, for explanation accuracy |
| `thresholds.yaml` | metric thresholds with a reason for each default |

Schema: `schemas/eval-archive.schema.json` (strict, strictTypes, strictRequired). Records use the `archive_record` content schema. The lint is `lintEvalArchive` in `test/eval-archive.test.mjs` and runs in `npm run test`, so `npm run verify` covers it. None of these files is hashed into a pack.

## How relevance is graded

2 means same seed condition and same jurisdiction, 1 means same seed condition in another jurisdiction (useful but needs fit checks), 0 or not listed means not relevant. Failed paths (`stuck`, `blocked`) are graded like solved ones because failed paths still rank and show as warnings. A query with no relevant record has `expect_empty: true` (the honest empty state, no suggestion above `archive.min_candidate_score`). Paraphrases and translations copy the judgments of their source so the cross-language gap is comparable.

## Distractors

- `same_words_different_type`: shares words with a seed condition but is another problem type (meeting conduct, donation records, fireworks hours, a school kitchen). Expected: nothing relevant.
- `same_type_incompatible_legal_stack`: same type, but the fiktiva-north stack differs (collection fees banned at L4 art-7, lantern drones at L2 art-4). Expected: the city path may be retrieved, and DP-REUSE-FIT shows the difference and the unusable stage. It never hides them.

## Translations

`nl` and `en` queries are natural paraphrases written by the drafting model, marked `model_drafted` and `reviewed: false`. Swahili (`sw`) and Hindi (`hi`) are `machine` and `reviewed: false`; the maintainer reviews them later. A translation never adds a fact the source does not have.

## Fit rules used by the labels

- Legality: the citation is `{layer, article_id, corpus_version}`; `corpus_version` is `<corpus>@<version>+<first 12 hex of pack_hash>` taken from the target jurisdiction's `pack.yaml`. When two layers disagree the higher layer wins (the festival-day drone case is `unlawful_at_L2` although L6 allows it). L1 (both stacks) and L2 (north) are `reference` layers in these packs: it informs but does not bind (`docs/design/ai/legal-stack.md`), so those cases (`fit-l1-*`, `fit-l2-north`) are expected as `unknown` (hold) with the article cited, never `unlawful_at_L1`/`L2`. A fiktiva-city collection fee is `unknown` (hold): every applicable layer is none_found, and no applicable article is not permission (DP-LEGALITY, DP-REUSE-FIT); only a cited permitting article makes a stage `lawful`. The north contrast stays `unlawful_at_L4`. The lint fails a `lawful` case or record option that rests on silence, and any `unlawful_at_Lk` on a reference layer. Other `lawful` record options (lighting, bins) carry no planted legality case and are not checked.
- Budget: a path `exceeds` when its source budget band or people band is above the declared one. `stretch` is not planted yet.
- Stale: a flag for every layer where the record's pin differs from the target's pin.
- Holds: a layer with no corpus (and not `not_applicable`) holds, as does an unresolved stack.
- Differences: dimensions are the keys of `archive.rank_weights`; each statement is `same`, `close` or `different` with both values. The lint recomputes the truth from the data.

## Thresholds and limits

`thresholds.yaml` names the limits it uses (`archive.rank_weights`, `min_candidate_score`, `rrf_k`, `top_k_fusion`, `top_n_shown`, `cross_language_recall_floor`) and reads them from `limits.yaml`; it repeats none of their numbers. Recall is taken at `top_n_shown`. New values (recall 0.8, nDCG at 10 of 0.7, cross-language gap 0.15, explanation accuracy 0.95, planted illegality recall 1.0, over-budget detection 1.0) are defaults the founder may change.

## Adding a record or query

1. Add a record as `records/<id>.json` valid against `archive_record`, `source: simulation`, evidence on `https://evidence.sim.test/...`, and an entry in `record-meta.json`. Blocked or abandoned stages need a challenge; a stuck record needs `outcome.unresolved: true`.
2. Add a query in the matching `queries/*.json` file with `synthetic: true`, a BCP 47 `language`, a `context_profile` valid for the archive schema, and `judgments`. Update `relevant_record_ids` and `expect_empty` to match.
3. For a translation set `translation_of` and a `translation` block; mark machine output `machine` and `reviewed: false`.
4. Run `npm run verify`.

## No real people, no real incidents

Use invented people-free wording: roles and offices, never names. No email, handle, address, phone, link to a real site or 7 digit number. The lint rejects `@`, `://`, `www.`, `http`, long digit runs, titles followed by a name, street addresses and a few personal-data words, plus any URI not on `evidence.sim.test`. Do not add dashes (em or en) to text. Real incidents belong only in a real archive, never here.
