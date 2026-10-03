---
name: Policy PR draft
about: A proposal that moves auditor-confirmed simulation candidates into the amendment loop. Harness-generated drafts use the same fields.
title: "Policy proposal: <rule ids> on <DPs>"
labels: policy-proposal
---

Nothing here edits production. The normal gates apply: eval, replay diff, protected-core check, adversarial-test gate, ratification, staged rollout.

## Rule ids and DPs touched
- Rule ids:
- Decision points:

## Reason

## Motivating candidate ids
Confirmed candidates only (`simulation/candidates/<run_id>/<id>.json`, status `confirmed`). Reference ids, never paste planted attack data.
-

## Expected flips
Cases whose outcome should change, with old and new outcome:
-

## Protected-core check
- [ ] No protected-core rule is edited here (constitution I.2); `npm run` protected-core check passed.

## Rollback plan
Previous version and hash, auto-rollback triggers, who may roll back, how affected items are re-moderated:
