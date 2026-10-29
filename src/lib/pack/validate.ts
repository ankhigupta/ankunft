import { PackSchema, type Expr, type Pack, type Source } from "./schema";

export interface Issue {
  severity: "error" | "warning";
  code: string;
  message: string;
  path: string;
}

export interface ValidationResult {
  ok: boolean; // true when there are no errors (warnings allowed)
  pack?: Pack;
  issues: Issue[];
}

function walkExpr(expr: Expr, visit: (leaf: { task?: string; input?: string }) => void) {
  if ("task" in expr) visit({ task: expr.task });
  else if ("input" in expr) visit({ input: expr.input });
  else if ("allOf" in expr) expr.allOf.forEach((e) => walkExpr(e, visit));
  else expr.anyOf.forEach((e) => walkExpr(e, visit));
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

/**
 * Structural (zod) + semantic validation of a data pack.
 * The semantic rules encode the product's trust model:
 *  - every rule cites sources that exist;
 *  - no rule leans on a source marked unreliable;
 *  - a hard deadline kind must be backed by a source of the matching authority type;
 *  - inferred dependencies must say so and explain themselves;
 *  - the task graph is acyclic.
 */
export function validatePack(raw: unknown): ValidationResult {
  const parsed = PackSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        severity: "error" as const,
        code: "schema",
        message: i.message,
        path: i.path.join("."),
      })),
    };
  }
  const pack = parsed.data;
  const issues: Issue[] = [];
  const err = (code: string, message: string, path: string) =>
    issues.push({ severity: "error", code, message, path });
  const warn = (code: string, message: string, path: string) =>
    issues.push({ severity: "warning", code, message, path });

  const sourceById = new Map<string, Source>(pack.sources.map((s) => [s.id, s]));
  const taskById = new Map(pack.tasks.map((t) => [t.id, t]));
  const inputById = new Map(pack.inputs.map((i) => [i.id, i]));
  const conflictIds = new Set(pack.conflicts.map((c) => c.id));

  // Unique ids
  for (const [label, ids] of [
    ["task", pack.tasks.map((t) => t.id)],
    ["source", pack.sources.map((s) => s.id)],
    ["input", pack.inputs.map((i) => i.id)],
    ["conflict", pack.conflicts.map((c) => c.id)],
    ["requirement", pack.tasks.flatMap((t) => t.requirements.map((r) => r.id))],
  ] as const) {
    for (const d of findDuplicates([...ids])) err("duplicate_id", `Duplicate ${label} id "${d}"`, label);
  }

  const checkSources = (ids: string[], path: string) => {
    for (const id of ids) {
      const s = sourceById.get(id);
      if (!s) err("unknown_source", `Unknown source "${id}"`, path);
      else if (s.reliability === "unreliable")
        err("unreliable_source", `Source "${id}" is marked unreliable and cannot back a rule`, path);
    }
  };

  for (const s of pack.sources) {
    if (s.retrievedOn > pack.verifiedOn)
      warn("retrieved_after_verified", `Source ${s.id} retrieved after pack verifiedOn`, `sources.${s.id}`);
    if (s.pageDate === null && !s.pageDateNote)
      warn("no_page_date_note", `Source ${s.id} has no page date and no note explaining why`, `sources.${s.id}`);
  }

  for (const c of pack.conflicts) {
    for (const st of c.statements) checkSources(st.sourceIds, `conflicts.${c.id}`);
  }

  for (const input of pack.inputs) {
    if (input.type === "enum" && !input.options?.length)
      err("enum_without_options", `Enum input "${input.id}" needs options`, `inputs.${input.id}`);
  }
  for (const rule of pack.supportedWhen) {
    if (!inputById.has(rule.input)) err("unknown_input", `supportedWhen references unknown input "${rule.input}"`, "supportedWhen");
  }

  for (const t of pack.tasks) {
    const base = `tasks.${t.id}`;

    if (t.completedWhenInput && !inputById.has(t.completedWhenInput))
      err("unknown_input", `completedWhenInput "${t.completedWhenInput}" does not exist`, base);

    for (const cid of t.conflictIds)
      if (!conflictIds.has(cid)) err("unknown_conflict", `Unknown conflict "${cid}"`, base);

    // Info-only tasks may reference tracked tasks (shown as context) but are never referenced themselves.
    for (const r of t.requirements) {
      const rp = `${base}.requirements.${r.id}`;
      checkSources(r.sourceIds, rp);
      if (r.basis !== "inferred" && r.sourceIds.length === 0)
        err("requirement_without_source", `Requirement "${r.id}" is labeled ${r.basis} but cites no source`, rp);
      if (r.basis === "inferred" && !r.note)
        err("inferred_without_note", `Inferred requirement "${r.id}" must explain the inference in a note`, rp);
      if (r.basis === "legal_requirement" && !r.sourceIds.some((id) => sourceById.get(id)?.authorityType === "statute"))
        err("legal_without_statute", `Requirement "${r.id}" is labeled legal_requirement but cites no statute source`, rp);

      walkExpr(r.expr, (leaf) => {
        if (leaf.task) {
          const ref = taskById.get(leaf.task);
          if (!ref) err("unknown_task", `Requirement "${r.id}" references unknown task "${leaf.task}"`, rp);
          else if (ref.mode === "info_only")
            err("depends_on_info_task", `Requirement "${r.id}" depends on info-only task "${leaf.task}"`, rp);
        }
        if (leaf.input && !inputById.has(leaf.input))
          err("unknown_input", `Requirement "${r.id}" references unknown input "${leaf.input}"`, rp);
      });
    }

    for (const n of t.meanwhileNotes) {
      checkSources(n.sourceIds, `${base}.meanwhileNotes`);
      if (n.sourceIds.length === 0) err("note_without_source", `Meanwhile note without a source: "${n.text}"`, `${base}.meanwhileNotes`);
    }

    // Deadline rules
    const d = t.deadline;
    const dp = `${base}.deadline`;
    checkSources(d.sourceIds, dp);
    const types = d.sourceIds.map((id) => sourceById.get(id)?.authorityType);
    const computable = d.direction !== null;

    if (d.kind === "none_found") {
      if (computable || d.offsetDays !== null || d.triggerInput)
        err("none_found_with_rule", "A 'none_found' deadline must not define a trigger, offset or direction", dp);
    } else if (d.kind === "informational") {
      if (computable || d.offsetDays !== null)
        err("informational_computable", "An informational deadline must not be computable", dp);
      if (d.sourceIds.length === 0) err("deadline_without_source", "Informational deadline needs a source", dp);
    } else {
      if (d.sourceIds.length === 0) err("deadline_without_source", `Deadline kind "${d.kind}" needs a source`, dp);
      if (!computable || !d.triggerInput)
        err("deadline_not_computable", `Deadline kind "${d.kind}" must define triggerInput and direction`, dp);
      if (d.direction === "within" && d.offsetDays === null)
        err("within_without_offset", "A 'within' deadline needs offsetDays", dp);
      if (d.triggerInput) {
        const inp = inputById.get(d.triggerInput);
        if (!inp) err("unknown_input", `Deadline trigger "${d.triggerInput}" does not exist`, dp);
        else if (inp.type !== "date") err("trigger_not_date", `Deadline trigger "${d.triggerInput}" must be a date input`, dp);
      }
      if (d.kind === "statutory" && !types.includes("statute"))
        err("statutory_without_statute", "A statutory deadline must cite a primary statute source (a mirror does not count)", dp);
      if (d.kind === "authority_stated" && !types.some((x) => x === "statute" || x === "government_service" || x === "federal_portal"))
        err("authority_without_authority", "An authority-stated deadline must cite a government source", dp);
      if (d.kind === "university_stated" && !types.includes("university"))
        err("university_without_university", "A university-stated deadline must cite a university source", dp);
    }
  }

  // Cycle detection over task -> task requirement edges
  const edges = new Map<string, Set<string>>();
  for (const t of pack.tasks) {
    const deps = new Set<string>();
    for (const r of t.requirements) walkExpr(r.expr, (leaf) => leaf.task && deps.add(leaf.task));
    edges.set(t.id, deps);
  }
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string, stack: string[]) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      err("cycle", `Dependency cycle: ${[...stack, id].join(" -> ")}`, "tasks");
      return;
    }
    state.set(id, 1);
    for (const dep of edges.get(id) ?? []) if (taskById.has(dep)) visit(dep, [...stack, id]);
    state.set(id, 2);
  };
  for (const t of pack.tasks) visit(t.id, []);

  return { ok: !issues.some((i) => i.severity === "error"), pack, issues };
}

/** A pack is stale when its verification is older than its own stated limit. */
export function packAgeDays(pack: Pack, todayISO: string): number {
  const ms = Date.parse(`${todayISO}T00:00:00Z`) - Date.parse(`${pack.verifiedOn}T00:00:00Z`);
  return Math.floor(ms / 86_400_000);
}
export function isPackStale(pack: Pack, todayISO: string): boolean {
  return packAgeDays(pack, todayISO) > pack.staleAfterDays;
}
