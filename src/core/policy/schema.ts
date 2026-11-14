/** The policy file, botpolicy.json. Defined once; schema/policy.json is generated from this. */
import { z } from "zod";
import { BOTS } from "../registry.js";

const PURPOSES = ["training", "search", "user-fetch", "other"] as const;
const operators = () => [...new Set(BOTS.map((b) => b.operator.toLowerCase()))];

const Path = z.string().startsWith("/", { message: 'paths must start with "/"' });

/** "*", "purpose:<purpose>", "operator:<operator>" or a list of crawler tokens. */
const BotSelector = z.union([z.string(), z.array(z.string()).min(1)]).superRefine((value, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (Array.isArray(value)) {
    for (const token of value) {
      if (!BOTS.some((b) => b.token.toLowerCase() === token.toLowerCase())) {
        fail(`unknown crawler '${token}'; run botpolicy bots to see them`);
      }
    }
  } else if (value.startsWith("purpose:")) {
    if (!(PURPOSES as readonly string[]).includes(value.slice(8))) fail(`purpose must be one of ${PURPOSES.join(", ")}`);
  } else if (value.startsWith("operator:")) {
    if (!operators().includes(value.slice(9).toLowerCase())) fail("unknown operator; run botpolicy bots to see them");
  } else if (value !== "*") {
    fail('bots must be "*", "purpose:<purpose>", "operator:<operator>" or a list of crawler tokens');
  }
});

export const Expectation = z.enum(["allowed", "blocked", "restricted", "reachable"]);

export const PolicySchema = z.strictObject({
  $schema: z.string().optional(),
  site: z.url({ protocol: /^https?$/, message: "site must be an http or https URL" }),
  paths: z.array(Path).min(1),
  rules: z.array(
    z.strictObject({
      bots: BotSelector,
      paths: z.array(Path).min(1).optional(),
      expect: Expectation,
    }),
  ),
  page: z
    .strictObject({
      minTextWithoutJs: z.number().int().min(0).optional(),
      requireJsonLd: z.array(z.string().min(1)).optional(),
    })
    .optional(),
});

export type Policy = z.infer<typeof PolicySchema>;
export type PolicyRule = Policy["rules"][number];

export class PolicyError extends Error {}

/** Validates a parsed JSON value as a policy, with readable messages. */
export function parsePolicy(input: unknown): Policy {
  const result = PolicySchema.safeParse(input);
  if (result.success) return result.data;
  throw new PolicyError(
    result.error.issues
      .map((i) => `${i.path.length ? i.path.join(".") : "policy"}: ${i.message}`)
      .join("\n"),
  );
}

/** Every path the policy needs measured: its own paths plus any a rule names. */
export function policyPaths(policy: Policy): string[] {
  return [...new Set([...policy.paths, ...policy.rules.flatMap((r) => r.paths ?? [])])];
}

export function policyJsonSchema(): object {
  return {
    $id: "https://unpkg.com/botpolicy/schema/policy.json",
    title: "botpolicy policy file",
    ...z.toJSONSchema(PolicySchema, { io: "input", unrepresentable: "any" }),
  };
}
