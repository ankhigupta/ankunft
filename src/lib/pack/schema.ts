import { z } from "zod";

/**
 * Data-pack schema. A pack is versioned, destination-specific DATA:
 * tasks, dependencies, deadline rules, sources and conflicts.
 * The planner engine is generic and never contains destination rules.
 */

export const ISODate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)");

/** How a dependency is justified. Never mix these up in the UI. */
export const Basis = z.enum([
  "legal_requirement", // stated in a statute
  "authority_requirement", // stated as a requirement by the responsible authority
  "stated_sequence", // a source explicitly states the order (not necessarily legally binding)
  "inferred", // our inference; not stated by a source
]);
export type Basis = z.infer<typeof Basis>;

export const DeadlineKind = z.enum([
  "statutory", // a statute states the deadline
  "authority_stated", // the responsible authority states it
  "university_stated", // a university international office states it
  "informational", // a source says something time-related that is not a computable date
  "none_found", // no official deadline found in the sources checked
]);
export type DeadlineKind = z.infer<typeof DeadlineKind>;

/** A requirement expression over tasks and profile inputs. */
export type Expr =
  | { task: string }
  | { input: string }
  | { allOf: Expr[] }
  | { anyOf: Expr[] };

export const ExprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    z.strictObject({ task: z.string() }),
    z.strictObject({ input: z.string() }),
    z.strictObject({ allOf: z.array(ExprSchema).min(1) }),
    z.strictObject({ anyOf: z.array(ExprSchema).min(1) }),
  ]),
);

export const SourceSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  publisher: z.string(),
  authorityType: z.enum([
    "statute",
    "statute_mirror",
    "government_service",
    "federal_portal",
    "university",
  ]),
  url: z.string().url(),
  retrievedOn: ISODate,
  /** The page's own date, if it has a real one. Null means "no date on page". */
  pageDate: ISODate.nullable(),
  pageDateNote: z.string().optional(),
  reliability: z.enum(["primary", "secondary", "unreliable"]),
  note: z.string().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

export const InputDefSchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  help: z.string().optional(),
  type: z.enum(["date", "boolean", "enum"]),
  options: z.array(z.string()).optional(),
  /**
   * When is this input "satisfied" for requirement purposes?
   * - present: any value was supplied
   * - reached: a date that is on or before today (the event has happened)
   * - true: boolean true
   */
  satisfiedWhen: z.enum(["present", "reached", "true"]),
});
export type InputDef = z.infer<typeof InputDefSchema>;

export const RequirementSchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  expr: ExprSchema,
  basis: Basis,
  sourceIds: z.array(z.string()),
  note: z.string().optional(),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const DeadlineSchema = z.strictObject({
  kind: DeadlineKind,
  /** The profile input that starts the clock, e.g. "moveInDate". */
  triggerInput: z.string().nullable(),
  /** Calendar days from the trigger. Only for computable deadlines. */
  offsetDays: z.number().int().nullable(),
  /** "within": last day is trigger + offset. "before_or_on": the trigger date itself is the limit. */
  direction: z.enum(["within", "before_or_on"]).nullable(),
  text: z.string(),
  sourceIds: z.array(z.string()),
});
export type Deadline = z.infer<typeof DeadlineSchema>;

export const TaskSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  /** tracked = user can mark done and gets a state; info_only = shown, no state. */
  mode: z.enum(["tracked", "info_only"]),
  /** If this input is satisfied the task counts as done (e.g. moving in implies housing). */
  completedWhenInput: z.string().optional(),
  appliesWhen: z.string(),
  requirements: z.array(RequirementSchema),
  deadline: DeadlineSchema,
  /** Curated notes shown while the task is blocked. Each must carry sources. */
  meanwhileNotes: z.array(
    z.strictObject({ text: z.string(), sourceIds: z.array(z.string()) }),
  ),
  conflictIds: z.array(z.string()),
  openQuestions: z.array(z.string()),
});
export type Task = z.infer<typeof TaskSchema>;

export const ConflictSchema = z.strictObject({
  id: z.string(),
  topic: z.string(),
  statements: z
    .array(z.strictObject({ text: z.string(), sourceIds: z.array(z.string()).min(1) }))
    .min(2),
  display: z.string(),
});
export type Conflict = z.infer<typeof ConflictSchema>;

export const PackSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  jurisdiction: z.string(),
  audience: z.string(),
  verifiedOn: ISODate,
  staleAfterDays: z.number().int().positive(),
  inputs: z.array(InputDefSchema),
  supportedWhen: z.array(
    z.strictObject({
      input: z.string(),
      oneOf: z.array(z.string()).min(1),
      unsupportedMessage: z.string(),
    }),
  ),
  sources: z.array(SourceSchema),
  conflicts: z.array(ConflictSchema),
  tasks: z.array(TaskSchema),
});
export type Pack = z.infer<typeof PackSchema>;

export const PROFILE_VALUE = z.union([z.string(), z.boolean()]);
export type ProfileValue = z.infer<typeof PROFILE_VALUE>;

/** The user's situation. Free-form inputs keyed by the pack's input ids. */
export interface Profile {
  inputs: Record<string, ProfileValue | undefined>;
  /** Task ids the user marked done. */
  completed: string[];
}
