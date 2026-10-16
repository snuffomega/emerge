import { z } from "zod";

const optNum = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).nullable());

export const taskCreateSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(255),
  description: z.string().max(4000).default(""),
  project_id: z.coerce.number({ invalid_type_error: "Choose a project" }).int().positive("Choose a project"),
  category: z.enum(["feature", "bugfix", "refactor", "tests", "docs", "infra"]),
  difficulty: z.enum(["trivial", "small", "medium", "large"]),
  model_id: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().positive().nullable()),
  harness_id: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().positive().nullable()),
  harness_version: z.string().max(40).optional().transform((v) => v || null),
  reference_human_minutes: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().positive("Must be > 0").nullable()),
  criteria: z.array(z.string().trim().min(1)).default([]),
});

export const measurementSchema = z.object({
  human_minutes: optNum,
  review_minutes: optNum,
  reference_human_minutes: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().positive("Must be > 0").nullable()),
  rework_cycles: z.coerce.number().int().min(0),
  intervention_count: z.coerce.number().int().min(0),
});

export const subscriptionSchema = z
  .object({
    name: z.string().trim().min(1, "Name required"),
    harness_id: z.coerce.number().int().positive("Choose a harness"),
    monthly_cost: z.coerce.number().min(0, "Cost must be ≥ 0"),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date required"),
    end_date: z.string().optional().transform((v) => v || null),
    notes: z.string().default(""),
  })
  .refine((v) => !v.end_date || v.end_date >= v.start_date, { message: "End date must be after start date", path: ["end_date"] });

export const manualUsageSchema = z.object({
  harness_id: z.coerce.number().int().positive("Choose a harness"),
  model_id: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().positive().nullable()),
  project_id: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().positive().nullable()),
  usage_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date required"),
  input_tokens: z.coerce.number().int().min(0),
  output_tokens: z.coerce.number().int().min(0),
  cache_creation_tokens: z.coerce.number().int().min(0),
  cache_read_tokens: z.coerce.number().int().min(0),
  agent_minutes: optNum,
  billing: z.enum(["subscription", "api"]),
  reported_cost: optNum,
});

export const evidenceSchema = z.object({
  kind: z.enum(["test_run", "review", "ci", "link", "note"]),
  summary: z.string().trim().min(1, "Summary required"),
  url: z.string().trim().url("Must be a valid URL").optional().or(z.literal("")).transform((v) => v || null),
});

export const deliverableSchema = z.object({
  kind: z.enum(["pull_request", "commit", "document", "artifact"]),
  title: z.string().trim().min(1, "Title required"),
  url: z.string().trim().url("Must be a valid URL").optional().or(z.literal("")).transform((v) => v || null),
});

export function firstError(r: z.SafeParseReturnType<any, any>): string | null {
  if (r.success) return null;
  const i = r.error.issues[0];
  return `${i.path.join(".") || "value"}: ${i.message}`;
}
