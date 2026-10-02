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
