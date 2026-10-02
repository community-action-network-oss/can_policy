import { test } from "node:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

// can_server wants strict + strictTypes; every content schema must compile that way, warnings included.
const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "content-schemas");
const logger = { log() {}, warn: (m) => { throw new Error(m); }, error: (m) => { throw new Error(m); } };

for (const name of readdirSync(DIR).filter((d) => existsSync(join(DIR, d, "schema.json")))) {
  test(`${name} compiles under strict + strictTypes`, () => {
    const ajv = new Ajv2020({ strict: true, strictTypes: true, allErrors: true, logger });
    ["version", "pack", "x-ui", "x-guidance", "x-checks", "x-version"].forEach((keyword) => ajv.addKeyword({ keyword }));
    const schema = JSON.parse(readFileSync(join(DIR, name, "schema.json"), "utf8"));
    delete schema.id;
    ajv.compile(schema);
  });
}
