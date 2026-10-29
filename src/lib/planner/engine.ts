import {
  type Basis,
  type DeadlineKind,
  type Expr,
  type InputDef,
  type Pack,
  type Profile,
  type Task,
} from "../pack/schema";
import { isPackStale, packAgeDays } from "../pack/validate";
import { addDays, diffDays, isISODate } from "./dates";

/**
 * Deterministic planner. A pure function of (pack, profile, today).
 * No LLM, no network, no randomness: the same input always yields the same plan.
 * It never invents a deadline: every date comes from a pack rule that cites a source.
 */

/** Product setting (not a legal threshold): within this many days a deadline counts as "due soon". */
export const DUE_SOON_DAYS = 7;

export type TaskState =
  | "done"
  | "overdue"
  | "due_soon"
  | "blocked"
  | "ready"
  | "info_only";

export interface RequirementResult {
  id: string;
  label: string;
  basis: Basis;
  sourceIds: string[];
  note?: string;
  satisfied: boolean;
  unmetTasks: string[];
  unmetInputs: string[];
}

export interface DeadlineResult {
  kind: DeadlineKind;
  status: "computed" | "needs_input" | "none_found" | "informational";
  text: string;
  sourceIds: string[];
  /** statutory or authority-stated: the only kinds allowed to produce "overdue". */
  hard: boolean;
  date?: string;
  daysLeft?: number;
  missingInput?: string;
  /** A non-hard reference date that has already passed. Shown as a warning, never as "overdue". */
  pastReference?: boolean;
}

export interface MeanwhileItem {
  taskId: string;
  /** True when doing this also moves this task's own prerequisites forward. */
  helpsThisTask: boolean;
}

export interface TaskPlan {
  id: string;
  title: string;
  summary: string;
  mode: Task["mode"];
  appliesWhen: string;
  state: TaskState;
  stateReason: string;
  done: boolean;
  /** Not done and nothing blocking it. */
  actionable: boolean;
  requirements: RequirementResult[];
  /** Tasks you can do right now that unblock this one. */
  rootBlockers: string[];
  /** Profile inputs this task is waiting on (for example, the move-in having happened). */
  waitingOn: string[];
  /** Tasks you can usefully do now while this one is blocked. */
  meanwhile: MeanwhileItem[];
  meanwhileNotes: Task["meanwhileNotes"];
  deadline: DeadlineResult;
  warnings: string[];
  conflictIds: string[];
  openQuestions: string[];
}

export interface NextAction {
  taskId: string;
  reason: string;
  /** A hard deadline on this task or on something it unblocks. */
  urgentBecause?: { taskId: string; date: string; daysLeft: number; kind: DeadlineKind };
  /** Direct dependents unlocked once this is done. */
  unlocks: string[];
  /** Other steps that can be started right now, in parallel, in priority order. */
  alsoNow: string[];
}

export interface Plan {
  packId: string;
  packVersion: string;
  today: string;
  supported: boolean;
  unsupportedReason?: string;
  profileIssues: string[];
  packAgeDays: number;
  packStale: boolean;
  tasks: TaskPlan[];
  nextAction: NextAction | null;
  /** Inputs that would let Ankunft compute more deadlines. */
  inputsNeeded: { inputId: string; label: string; because: string[] }[];
}

interface Unmet {
  tasks: string[];
  inputs: string[];
}

const FAR_FUTURE = "9999-12-31";

function inputIsSatisfied(def: InputDef, value: unknown, today: string): boolean {
  if (value === undefined || value === null || value === "") return false;
  switch (def.satisfiedWhen) {
    case "present":
      return def.type === "date" ? isISODate(value) : true;
    case "reached":
      return isISODate(value) && value <= today;
    case "true":
      return value === true;
  }
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function taskLeaves(expr: Expr, out: string[] = []): string[] {
  if ("task" in expr) out.push(expr.task);
  else if ("allOf" in expr) expr.allOf.forEach((e) => taskLeaves(e, out));
  else if ("anyOf" in expr) expr.anyOf.forEach((e) => taskLeaves(e, out));
  return out;
}

export function buildPlan(pack: Pack, profile: Profile, todayISO: string): Plan {
  const inputDefs = new Map(pack.inputs.map((i) => [i.id, i]));
  const age = packAgeDays(pack, todayISO);
  const base = {
    packId: pack.id,
    packVersion: pack.version,
    today: todayISO,
    packAgeDays: age,
    packStale: isPackStale(pack, todayISO),
  };

  // ---- Profile checks -------------------------------------------------
  const profileIssues: string[] = [];
  for (const def of pack.inputs) {
    const v = profile.inputs[def.id];
    if (def.type === "date" && v !== undefined && v !== "" && !isISODate(v))
      profileIssues.push(`"${def.label}" is not a valid date.`);
  }
  const arrival = profile.inputs["arrivalDate"];
  const moveIn = profile.inputs["moveInDate"];
  if (isISODate(arrival) && isISODate(moveIn) && moveIn < arrival)
    profileIssues.push("Your move-in date is before your arrival date. Please check both.");

  // ---- Supported profile ---------------------------------------------
  for (const rule of pack.supportedWhen) {
    const v = profile.inputs[rule.input];
    if (typeof v !== "string" || !rule.oneOf.includes(v)) {
      return {
        ...base,
        supported: false,
        unsupportedReason: rule.unsupportedMessage,
        profileIssues,
        tasks: [],
        nextAction: null,
        inputsNeeded: [],
      };
    }
  }

  const inputOk = (id: string) => {
    const def = inputDefs.get(id);
    return def ? inputIsSatisfied(def, profile.inputs[id], todayISO) : false;
  };

  const taskById = new Map(pack.tasks.map((t) => [t.id, t]));
  const order = new Map(pack.tasks.map((t, i) => [t.id, i]));

  // ---- Done set ---------------------------------------------------------
  const done = new Set<string>();
  for (const t of pack.tasks) {
    if (t.mode !== "tracked") continue;
    if (profile.completed.includes(t.id)) done.add(t.id);
    if (t.completedWhenInput && inputOk(t.completedWhenInput)) done.add(t.id);
  }

  // ---- Graph helpers ------------------------------------------------
  const dependents = new Map<string, Set<string>>();
  const ancestorsDirect = new Map<string, Set<string>>();
  for (const t of pack.tasks) {
    const direct = new Set<string>();
    for (const r of t.requirements) taskLeaves(r.expr).forEach((x) => direct.add(x));
    ancestorsDirect.set(t.id, direct);
    for (const dep of direct) {
      if (!dependents.has(dep)) dependents.set(dep, new Set());
      dependents.get(dep)!.add(t.id);
    }
  }
  const closure = (start: string, edges: Map<string, Set<string>>): Set<string> => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const next of edges.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return seen;
  };

  // ---- Requirement evaluation ---------------------------------------
  /** Remaining work behind an unmet option: the tasks themselves plus every undone task they depend on. */
  const remainingWork = (u: Unmet): number => {
    const all = new Set<string>(u.tasks);
    for (const id of u.tasks) for (const a of closure(id, ancestorsDirect)) if (!done.has(a)) all.add(a);
    return all.size + u.inputs.length;
  };

  const unmetOf = (expr: Expr): Unmet | null => {
    if ("task" in expr) return done.has(expr.task) ? null : { tasks: [expr.task], inputs: [] };
    if ("input" in expr) return inputOk(expr.input) ? null : { tasks: [], inputs: [expr.input] };
    if ("allOf" in expr) {
      const parts = expr.allOf.map(unmetOf).filter((x): x is Unmet => x !== null);
      if (parts.length === 0) return null;
      return { tasks: unique(parts.flatMap((p) => p.tasks)), inputs: unique(parts.flatMap((p) => p.inputs)) };
    }
    const parts = expr.anyOf.map(unmetOf);
    if (parts.some((p) => p === null)) return null;
    // Nothing satisfied: report the option with the least remaining work (first on ties).
    return (parts as Unmet[]).reduce((best, p) => (remainingWork(p) < remainingWork(best) ? p : best));
  };

  const reqResults = new Map<string, RequirementResult[]>();
  for (const t of pack.tasks) {
    reqResults.set(
      t.id,
      t.requirements.map((r) => {
        const u = unmetOf(r.expr);
        return {
          id: r.id,
          label: r.label,
          basis: r.basis,
          sourceIds: r.sourceIds,
          note: r.note,
          satisfied: u === null,
          unmetTasks: u?.tasks ?? [],
          unmetInputs: u?.inputs ?? [],
        };
      }),
    );
  }
  const isBlocked = (id: string) => (reqResults.get(id) ?? []).some((r) => !r.satisfied);

  // ---- Deadlines ----------------------------------------------------------
  const computeDeadline = (t: Task): DeadlineResult => {
    const d = t.deadline;
    const hard = d.kind === "statutory" || d.kind === "authority_stated";
    const common = { kind: d.kind, text: d.text, sourceIds: d.sourceIds, hard };
    if (d.kind === "none_found") return { ...common, status: "none_found" };
    if (d.kind === "informational") return { ...common, status: "informational" };
    const trigger = d.triggerInput ? profile.inputs[d.triggerInput] : undefined;
    if (!isISODate(trigger))
      return { ...common, status: "needs_input", missingInput: d.triggerInput ?? undefined };
    const date = d.direction === "within" ? addDays(trigger, d.offsetDays ?? 0) : trigger;
    const daysLeft = diffDays(date, todayISO);
    return { ...common, status: "computed", date, daysLeft, pastReference: !hard && daysLeft < 0 };
  };
  const deadlines = new Map(pack.tasks.map((t) => [t.id, computeDeadline(t)]));

  // ---- Root blockers and inputs waited on --------------------------------
  const rootsOf = (id: string, seen = new Set<string>()): { tasks: string[]; inputs: string[] } => {
    const tasks: string[] = [];
    const inputs: string[] = [];
    for (const r of reqResults.get(id) ?? []) {
      for (const inp of r.unmetInputs) inputs.push(inp);
      for (const dep of r.unmetTasks) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        if (!isBlocked(dep)) tasks.push(dep);
        else {
          const sub = rootsOf(dep, seen);
          tasks.push(...sub.tasks);
          inputs.push(...sub.inputs);
        }
      }
    }
    return { tasks: unique(tasks), inputs: unique(inputs) };
  };

  const trackedNotDone = pack.tasks.filter((t) => t.mode === "tracked" && !done.has(t.id));
  const actionableIds = new Set(trackedNotDone.filter((t) => !isBlocked(t.id)).map((t) => t.id));

  // ---- Per-task plan ----------------------------------------------------
  const tasks: TaskPlan[] = pack.tasks.map((t) => {
    const reqs = reqResults.get(t.id) ?? [];
    const dl = deadlines.get(t.id)!;
    const isDone = done.has(t.id);
    const blocked = isBlocked(t.id);
    const warnings: string[] = [];

    let state: TaskState;
    let stateReason: string;
    if (t.mode === "info_only") {
      state = "info_only";
      stateReason = "Information only: Ankunft does not track this step.";
    } else if (isDone) {
      state = "done";
      stateReason = "Marked done.";
      if (blocked)
        warnings.push("Marked done, but Ankunft sees prerequisites that are not complete. Double-check this step.");
    } else if (dl.status === "computed" && dl.hard && (dl.daysLeft ?? 0) < 0) {
      state = "overdue";
      stateReason = `The ${dl.kind === "statutory" ? "statutory" : "official"} deadline passed on ${dl.date}.`;
    } else if (dl.status === "computed" && (dl.daysLeft ?? -1) >= 0 && (dl.daysLeft ?? 0) <= DUE_SOON_DAYS) {
      state = "due_soon";
      stateReason = `Due ${dl.date} (${dl.daysLeft} day${dl.daysLeft === 1 ? "" : "s"} left).`;
    } else if (blocked) {
      state = "blocked";
      stateReason = "Waiting on prerequisites.";
    } else {
      state = "ready";
      stateReason = "Nothing is blocking this step.";
    }

    if (dl.pastReference)
      warnings.push(
        "A reference date from your input has passed (for example, your visa end date). Ankunft cannot verify your status; contact LEA or your international office.",
      );

    const roots = !isDone && t.mode === "tracked" ? rootsOf(t.id, new Set([t.id])) : { tasks: [], inputs: [] };
    const ancestors = closure(t.id, ancestorsDirect);
    const meanwhile: MeanwhileItem[] =
      !isDone && t.mode === "tracked" && blocked
        ? [...actionableIds]
            .filter((id) => id !== t.id && !roots.tasks.includes(id))
            .sort((a, b) => {
              const ha = ancestors.has(a) ? 0 : 1;
              const hb = ancestors.has(b) ? 0 : 1;
              return ha - hb || order.get(a)! - order.get(b)!;
            })
            .map((id) => ({ taskId: id, helpsThisTask: ancestors.has(id) }))
        : [];

    return {
      id: t.id,
      title: t.title,
      summary: t.summary,
      mode: t.mode,
      appliesWhen: t.appliesWhen,
      state,
      stateReason,
      done: isDone,
      actionable: actionableIds.has(t.id),
      requirements: reqs,
      rootBlockers: roots.tasks,
      waitingOn: roots.inputs,
      meanwhile,
      meanwhileNotes: t.meanwhileNotes,
      deadline: dl,
      warnings,
      conflictIds: t.conflictIds,
      openQuestions: t.openQuestions,
    };
  });

  // ---- Next best action -------------------------------------------------
  const hardDeadlineAmong = (ids: string[]) => {
    let best: { taskId: string; date: string; daysLeft: number; kind: DeadlineKind } | undefined;
    for (const id of ids) {
      const dl = deadlines.get(id);
      if (!dl || dl.status !== "computed" || !dl.hard || done.has(id) || !dl.date) continue;
      if (!best || dl.date < best.date) best = { taskId: id, date: dl.date, daysLeft: dl.daysLeft!, kind: dl.kind };
    }
    return best;
  };

  const candidates = [...actionableIds].map((id) => {
    const downstream = closure(id, dependents);
    const urgent = hardDeadlineAmong([id, ...downstream]);
    const own = deadlines.get(id);
    return {
      id,
      urgent,
      ownDate: own?.status === "computed" && own.date ? own.date : FAR_FUTURE,
      downstreamCount: [...downstream].filter((d) => taskById.get(d)?.mode === "tracked").length,
    };
  });
  candidates.sort(
    (a, b) =>
      (a.urgent?.date ?? FAR_FUTURE).localeCompare(b.urgent?.date ?? FAR_FUTURE) ||
      a.ownDate.localeCompare(b.ownDate) ||
      b.downstreamCount - a.downstreamCount ||
      order.get(a.id)! - order.get(b.id)!,
  );

  let nextAction: NextAction | null = null;
  const top = candidates[0];
  if (top) {
    const unlocks = [...(dependents.get(top.id) ?? [])]
      .filter((id) => taskById.get(id)?.mode === "tracked" && !done.has(id))
      .sort((a, b) => order.get(a)! - order.get(b)!);
    const parts: string[] = [];
    if (top.urgent) {
      const when =
        top.urgent.daysLeft < 0
          ? `was due ${top.urgent.date} (${-top.urgent.daysLeft} day${top.urgent.daysLeft === -1 ? "" : "s"} ago)`
          : `is due ${top.urgent.date} (${top.urgent.daysLeft} day${top.urgent.daysLeft === 1 ? "" : "s"} left)`;
      const label = taskById.get(top.urgent.taskId)!.title;
      parts.push(
        top.urgent.taskId === top.id
          ? `This ${when}.`
          : `"${label}" ${when} and cannot happen until this is done.`,
      );
    }
    if (unlocks.length)
      parts.push(`Doing this unlocks: ${unlocks.map((id) => taskById.get(id)!.title).join("; ")}.`);
    if (parts.length === 0) parts.push("Nothing else is blocking this step.");
    nextAction = {
      taskId: top.id,
      reason: parts.join(" "),
      urgentBecause: top.urgent,
      unlocks,
      alsoNow: candidates.slice(1).map((c) => c.id),
    };
  }

  // ---- Inputs that would unlock more deadlines ---------------------------
  const needed = new Map<string, string[]>();
  for (const tp of tasks) {
    if (tp.done || tp.mode !== "tracked") continue;
    if (tp.deadline.status === "needs_input" && tp.deadline.missingInput) {
      const list = needed.get(tp.deadline.missingInput) ?? [];
      list.push(tp.id);
      needed.set(tp.deadline.missingInput, list);
    }
  }
  const inputsNeeded = [...needed.entries()].map(([inputId, because]) => ({
    inputId,
    label: inputDefs.get(inputId)?.label ?? inputId,
    because,
  }));

  return {
    ...base,
    supported: true,
    profileIssues,
    tasks,
    nextAction,
    inputsNeeded,
  };
}
