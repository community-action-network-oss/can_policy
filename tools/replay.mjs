// Stub wired to real input. 10-u24 fills the diff engine.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const COLUMNS = ["decision_id", "dp", "jurisdiction", "field_ref", "original_outcome", "original_rule_ids", "original_confidence", "proposed_outcome", "proposed_rule_ids", "proposed_confidence", "flip", "direction", "label", "protected_tier"];
const rows = JSON.parse(readFileSync(fileURLToPath(new URL("../test/fixtures/replay-decisions.json", import.meta.url)), "utf8"));
const bad = rows.filter((r) => COLUMNS.some((c) => !(c in r)));
if (bad.length) { console.error(`replay: ${bad.length} rows miss columns`); process.exit(1); }
console.log(`replay: no cases (${rows.length} placeholder rows read)`);
