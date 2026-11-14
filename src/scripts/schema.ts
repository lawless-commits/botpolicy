/** Writes schema/report.json and schema/policy.json from the zod definitions. Run with `pnpm schema`. */
import { writeFileSync } from "node:fs";
import { policyJsonSchema } from "../core/policy/schema.js";
import { reportJsonSchema } from "../core/report/schema.js";

const root = new URL("../../schema/", import.meta.url);
writeFileSync(new URL("report.json", root), JSON.stringify(reportJsonSchema(), null, 2) + "\n");
writeFileSync(new URL("policy.json", root), JSON.stringify(policyJsonSchema(), null, 2) + "\n");
