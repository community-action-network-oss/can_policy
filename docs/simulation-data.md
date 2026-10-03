# Simulation data formats

`simulation/` holds data only. The harness that reads it lives in `can_server`. Everything here is synthetic (D-78): no real person, organisation, address or contact detail, and no credentials. Lint: `tools/lint-simulation.mjs`, run by `npm run lint`.

## Persona: `simulation/personas/<id>/persona.yaml`
Schema `schemas/persona.schema.json`. The directory name is the persona id and must be in the catalog of `docs/design/ai/simulation.md` section 2 plus `adv-reuse-inject` (a new id for the attacker that plants instruction text in a draft). Fields: `id`, `family` (submitter, contributor, adversarial, volunteer, stage, reuser), `role`, `goals`, `knowledge`, `flaws`, `behaviors`, `language`, `turn_budget`, `seed`, `synthetic: true`, `handle` (`sim-...`), `script`, `expected` (`step_id`, `outcomes`, optional `dp`, `rule_ids`). Optional: `prompt` (live mode), `location` (inside, outside, none, travelling; never a coordinate). Adversarial personas add `attack_goal`, `pass_condition` and optionally `attack_data` (a JSONL of variants). A person may reply to a problem at most 4 times per rolling 24 hours (D-85); a schedule respects that, or an attacker deliberately sends a 5th and expects `status: 429`, `outcome: reply_limit_reached`.

## Script: `script.json`
Schema `schemas/script.schema.json`. A list of `steps`, each `id`, `when` (`state`, `after_step`, `outcome_was`), `action`, `content_type`, `schema_version`, `fields`, `assumption_strategy`, `expect` (`outcome`, `status`, `rule_ids`, `field_ref`) and, for `raw_http` only (adv-schema-bypass), `raw_http` (`method`, `path`, `body`). Strings may hold `{{seed.<field>}}` and `{{var.<name>}}` placeholders. The language is declarative: no code, no expressions.

## Seed: `simulation/seeds/<id>/seed.yaml`
Schema `schemas/seed.schema.json`. `framing` must equal the D-56 framing of its `number` in `simulation/FRAMINGS.json` byte for byte. `label` is the constant "Seed problem, synthetic evidence". `problem` is a JSON body valid for the `problem` content schema (it carries sources and final acceptance criteria); `stage_plan` and `rubric` are files in the seed directory. Evidence URLs use the host `evidence.sim.test` only; each item has `synthetic: true`. `variants` come from happy, revise, appeal, stuck_or_blocked, plan_change, attack_wave, parallel_stages, reuse. `personas` must exist.

## What the lint refuses
A persona outside the catalog or without `synthetic: true`; a bad handle; an email, phone-like number, street address or any URL host other than `evidence.sim.test` in persona, script, prompt, seed or problem files; credential-looking text anywhere (including attack data); em and en dashes; a wrong framing; an unknown persona in a seed. Planted fake personal data for adv-doxx belongs in the persona's `attack_data` JSONL, which is exempt from the personal-data scan only.
