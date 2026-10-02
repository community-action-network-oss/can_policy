import { test } from "node:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

// can_server compiles with strict + strictTypes + strictRequired; every DP output schema must too, warnings included.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const logger = { log() {}, warn: (m) => { throw new Error(m); }, error: (m) => { throw new Error(m); } };
export const strictAjv = () => {
  const ajv = new Ajv2020({ strict: true, strictTypes: true, strictRequired: true, allErrors: true, logger });
  ["version", "pack", "x-ui", "x-guidance", "x-checks", "x-version"].forEach((keyword) => ajv.addKeyword({ keyword }));
  return ajv;
};

for (const [dir, label] of [["decision-points", "DP"], ["content-schemas", "content"]]) {
  for (const name of readdirSync(join(ROOT, dir)).filter((d) => existsSync(join(ROOT, dir, d, "schema.json")))) {
    test(`${label} ${name} compiles under strict + strictTypes + strictRequired`, () => {
      const schema = JSON.parse(readFileSync(join(ROOT, dir, name, "schema.json"), "utf8"));
      delete schema.id;
      strictAjv().compile(schema);
    });
  }
}
