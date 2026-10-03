## What changes and why

## Ratification checklist

Source: docs/design/ai/amendment-loop.md. Each item is recorded in `ratifications/` before ratification.

- [ ] 1. Rule ids, DPs and schemas touched are listed; protected-core check passed.
- [ ] 2. Eval gates met on the touched and neighbouring DPs.
- [ ] 3. Replay diff reported, unintended flips explained, flip limit respected.
- [ ] 4. Rollback plan: previous version and hash, auto-rollback triggers and thresholds, who may roll back manually, how affected items are re-moderated, notice text for affected people.
- [ ] 5. Adversarial-test gate: `adversarial` and `regression` sets pass and the persona suite ran deterministically; live persona attack run (0 leaks, 0 injection successes) where required.
- [ ] 6. Schema changes: form snapshots, in-flight draft migration plan, content replay count.
- [ ] 7. Legal corpus changes: provenance complete, lawyer review record, re-resolution estimate reported.
- [ ] 8. Dissent recorded; `approved_by` and `expires_at` present.

## Contributor checklist

Plain words are fine. Tick only what is true, and say "not sure" if you are not.

- [ ] Provenance: I gave a source for what I changed (an official link, or "my own expertise"), and for legal text I copied the official wording exactly.
- [ ] Review: I included a review record from a named human, or I asked for a reviewer.
- [ ] Examples are invented: no real person, no real incident, no live link to real incident data.
- [ ] No em or en dashes in user-facing copy.
- [ ] I did not edit a protected core rule, `manifest.json`, `release.json` or anything in `ratifications/`.

## AI use

- [ ] No AI tool was used.
- [ ] An AI tool helped. Tool and model, what it did, what I checked myself:

An AI may help with wording or translation. I stay responsible for every line, and an AI never counts as a reviewer or approver.
