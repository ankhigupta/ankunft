import { describe, expect, it } from "vitest";
import { berlinPack } from "../pack/load";
import type { Profile } from "../pack/schema";
import { addDays, diffDays, isISODate } from "./dates";
import { buildPlan, DUE_SOON_DAYS, type Plan } from "./engine";

const TODAY = "2026-10-23";

function profile(
  inputs: Profile["inputs"] = {},
  completed: string[] = [],
): Profile {
  return {
    inputs: {
      entryType: "national_visa",
      arrivalDate: "2026-10-20",
      visaEndDate: "2027-01-15",
      hasAdmissionLetter: true,
      ...inputs,
    },
    completed,
  };
}

const plan = (p: Profile, today = TODAY) => buildPlan(berlinPack, p, today);
const get = (pl: Plan, id: string) => {
  const t = pl.tasks.find((x) => x.id === id);
  if (!t) throw new Error(`no task ${id}`);
  return t;
};

describe("dates", () => {
  it("adds and diffs whole days without time-zone drift", () => {
    expect(addDays("2026-10-21", 14)).toBe("2026-11-04");
    expect(addDays("2026-12-25", 14)).toBe("2027-01-08");
    expect(addDays("2028-02-20", 10)).toBe("2028-03-01"); // leap year
    expect(diffDays("2026-11-04", "2026-10-23")).toBe(12);
    expect(diffDays("2026-10-15", "2026-10-23")).toBe(-8);
  });
  it("validates real calendar dates", () => {
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2026-13-01")).toBe(false);
    expect(isISODate("2026-10-23")).toBe(true);
    expect(isISODate(20261023)).toBe(false);
  });
});

describe("demo scenario: arrived, no housing yet", () => {
  const pl = plan(profile());

  it("recommends housing first and says what it unlocks", () => {
    expect(pl.supported).toBe(true);
    expect(pl.nextAction?.taskId).toBe("housing");
    expect(pl.nextAction?.unlocks).toEqual(["landlord_confirmation", "anmeldung"]);
    expect(pl.nextAction?.reason).toContain("unlocks");
  });

  it("blocks Anmeldung on housing and the landlord's confirmation", () => {
    const a = get(pl, "anmeldung");
    expect(a.state).toBe("blocked");
    expect(a.requirements[0].unmetTasks).toEqual(["housing", "landlord_confirmation"]);
    expect(a.rootBlockers).toEqual(["housing"]);
    expect(a.waitingOn).toEqual(["moveInDate"]);
  });

  it("does not invent an Anmeldung deadline without a move-in date", () => {
    const d = get(pl, "anmeldung").deadline;
    expect(d.status).toBe("needs_input");
    expect(d.date).toBeUndefined();
    expect(pl.inputsNeeded).toEqual([
      { inputId: "moveInDate", label: "Move-in date", because: ["anmeldung"] },
    ]);
  });

  it("lists what the student can do meanwhile, independent of the blocker", () => {
    const m = get(pl, "anmeldung").meanwhile;
    expect(m.map((x) => x.taskId)).toEqual(["health_insurance", "livelihood"]);
    // They don't unblock Anmeldung itself, so they are flagged as not helping this task.
    expect(m.every((x) => !x.helpsThisTask)).toBe(true);
  });

  it("offers parallel steps alongside the next action", () => {
    expect(pl.nextAction?.alsoNow).toEqual(["health_insurance", "livelihood"]);
  });

  it("does not call a task's own blockers 'meanwhile' for that task", () => {
    // Every actionable task is a root blocker of the permit application, so nothing is left over.
    const lea = get(pl, "lea_application");
    expect(lea.rootBlockers).toEqual(["health_insurance", "livelihood", "housing"]);
    expect(lea.meanwhile).toEqual([]);
  });

  it("offers parallel work while the landlord's confirmation is outstanding", () => {
    // Insurance and livelihood still move the permit forward while the confirmation is pending.
    const pl2 = plan(profile({ moveInDate: "2026-10-21" }));
    const lea = get(pl2, "lea_application");
    expect(lea.rootBlockers).toEqual(["health_insurance", "livelihood", "landlord_confirmation"]);
    const lc = get(pl2, "anmeldung").meanwhile;
    expect(lc.map((x) => x.taskId)).toEqual(["health_insurance", "livelihood", "rundfunkbeitrag"]);
  });

  it("blocks enrollment on insurance (stated sequence)", () => {
    const e = get(pl, "enrollment");
    expect(e.state).toBe("blocked");
    expect(e.requirements[0].basis).toBe("stated_sequence");
    expect(e.rootBlockers).toEqual(["health_insurance"]);
  });

  it("points the permit application at the cheaper residence proof, not Anmeldung", () => {
    const res = get(pl, "lea_application").requirements.find((r) => r.id === "la-residence")!;
    expect(res.satisfied).toBe(false);
    expect(res.unmetTasks).toEqual(["landlord_confirmation"]);
  });

  it("does not require enrollment for the permit while an admission letter exists", () => {
    const sp = get(pl, "lea_application").requirements.find((r) => r.id === "la-study-place")!;
    expect(sp.satisfied).toBe(true);
    expect(sp.basis).toBe("legal_requirement");
  });

  it("traces the appointment back to the real root blockers", () => {
    expect(get(pl, "lea_appointment").rootBlockers).toEqual(["health_insurance", "livelihood", "housing"]);
  });
});

describe("Anmeldung deadline logic", () => {
  it("counts 14 days from move-in, not from arrival", () => {
    const a = plan(profile({ moveInDate: "2026-10-21", arrivalDate: "2026-10-01" }));
    const b = plan(profile({ moveInDate: "2026-10-21", arrivalDate: "2026-10-19" }));
    expect(get(a, "anmeldung").deadline.date).toBe("2026-11-04");
    expect(get(b, "anmeldung").deadline.date).toBe("2026-11-04");
    expect(get(a, "anmeldung").deadline.daysLeft).toBe(12);
  });

  it("makes the landlord's confirmation the next action when it gates a deadline", () => {
    const pl = plan(profile({ moveInDate: "2026-10-21" }));
    expect(get(pl, "housing").state).toBe("done");
    expect(get(pl, "landlord_confirmation").actionable).toBe(true);
    expect(pl.nextAction?.taskId).toBe("landlord_confirmation");
    expect(pl.nextAction?.urgentBecause).toMatchObject({ taskId: "anmeldung", date: "2026-11-04", kind: "statutory" });
    expect(pl.nextAction?.reason).toContain("is due 2026-11-04 (12 days left)");
  });

  it("marks Anmeldung due soon inside the product threshold", () => {
    const pl = plan(profile({ moveInDate: "2026-10-12" })); // deadline 2026-10-26, 3 days left
    const a = get(pl, "anmeldung");
    expect(a.deadline.daysLeft).toBe(3);
    expect(3).toBeLessThanOrEqual(DUE_SOON_DAYS);
    expect(a.state).toBe("due_soon");
    expect(a.rootBlockers).toEqual(["landlord_confirmation"]);
  });

  it("marks Anmeldung overdue after the statutory deadline and points at the blocker", () => {
    const pl = plan(profile({ moveInDate: "2026-10-01" })); // deadline 2026-10-15
    const a = get(pl, "anmeldung");
    expect(a.state).toBe("overdue");
    expect(a.deadline.daysLeft).toBe(-8);
    expect(a.rootBlockers).toEqual(["landlord_confirmation"]);
    expect(pl.nextAction?.taskId).toBe("landlord_confirmation");
    expect(pl.nextAction?.reason).toContain("was due 2026-10-15 (8 days ago)");
  });

  it("treats the last day itself as not yet overdue", () => {
    const pl = plan(profile({ moveInDate: "2026-10-09" })); // deadline 2026-10-23 == today
    expect(get(pl, "anmeldung").deadline.daysLeft).toBe(0);
    expect(get(pl, "anmeldung").state).toBe("due_soon");
  });

  it("supports a scheduled future move-in", () => {
    const pl = plan(profile({ moveInDate: "2026-11-01" }), TODAY);
    // moving in has not happened yet, so housing is not auto-done and the landlord confirmation waits on it
    expect(get(pl, "housing").state).toBe("ready");
    const pl2 = plan(profile({ moveInDate: "2026-11-01" }, ["housing"]));
    const lc = get(pl2, "landlord_confirmation");
    expect(lc.state).toBe("blocked");
    expect(lc.requirements[0].unmetTasks).toEqual([]);
    expect(lc.requirements[0].unmetInputs).toEqual(["moveInDate"]);
    expect(lc.waitingOn).toEqual(["moveInDate"]);
    expect(get(pl2, "anmeldung").deadline.date).toBe("2026-11-15");
  });
});

describe("any-of proof of residence", () => {
  it("lets the permit application proceed on the lease and landlord's confirmation, without Anmeldung", () => {
    const pl = plan(profile({ moveInDate: "2026-10-21" }, ["landlord_confirmation"]));
    const res = get(pl, "lea_application").requirements.find((r) => r.id === "la-residence")!;
    expect(res.satisfied).toBe(true);
    expect(get(pl, "anmeldung").state).not.toBe("done");
  });

  it("is blocked only by insurance and livelihood once residence and admission are covered", () => {
    const pl = plan(profile({ moveInDate: "2026-10-21" }, ["landlord_confirmation", "anmeldung"]));
    const lea = get(pl, "lea_application");
    expect(lea.requirements.filter((r) => !r.satisfied).map((r) => r.id)).toEqual(["la-insurance", "la-livelihood"]);
    expect(lea.state).toBe("blocked");
  });

  it("becomes ready when every requirement is met", () => {
    const pl = plan(
      profile({ moveInDate: "2026-10-21" }, ["landlord_confirmation", "anmeldung", "health_insurance", "livelihood"]),
    );
    expect(get(pl, "lea_application").state).toBe("ready");
    expect(get(pl, "lea_appointment").state).toBe("blocked");
    expect(get(pl, "lea_appointment").rootBlockers).toEqual(["lea_application"]);
  });

  it("waits on the admission letter itself when the student has none, since enrolling needs one", () => {
    const pl = plan(profile({ hasAdmissionLetter: false }));
    const sp = get(pl, "lea_application").requirements.find((r) => r.id === "la-study-place")!;
    expect(sp.satisfied).toBe(false);
    expect(sp.unmetInputs).toEqual(["hasAdmissionLetter"]);
    expect(get(pl, "lea_application").waitingOn).toContain("hasAdmissionLetter");
  });

  it("accepts a completed enrollment as the study place even without the letter flag", () => {
    const pl = plan(profile({ hasAdmissionLetter: false }, ["health_insurance", "enrollment"]));
    const sp = get(pl, "lea_application").requirements.find((r) => r.id === "la-study-place")!;
    expect(sp.satisfied).toBe(true);
  });
});

describe("visa-end reference date (university-stated, not statutory)", () => {
  it("never calls a passed visa end date 'overdue' and warns instead", () => {
    const pl = plan(profile({ visaEndDate: "2026-10-01" }));
    const lea = get(pl, "lea_application");
    expect(lea.deadline.daysLeft).toBe(-22);
    expect(lea.deadline.hard).toBe(false);
    expect(lea.state).not.toBe("overdue");
    expect(lea.warnings.join(" ")).toContain("cannot verify");
  });

  it("can show due soon for a soft deadline", () => {
    const pl = plan(profile({ visaEndDate: "2026-10-28" }));
    expect(get(pl, "lea_application").state).toBe("due_soon");
  });

  it("does not compute an application window because official sources conflict", () => {
    const lea = get(plan(profile()), "lea_application");
    expect(lea.conflictIds).toEqual(["C-EARLIEST"]);
    expect(lea.deadline.date).toBe("2027-01-15"); // the visa end date itself, never an invented 'opens' date
  });
});

describe("support and input handling", () => {
  it("declines unsupported entry types without producing a plan", () => {
    const pl = plan(profile({ entryType: "visa_free" }));
    expect(pl.supported).toBe(false);
    expect(pl.unsupportedReason).toContain("national study visa");
    expect(pl.tasks).toEqual([]);
    expect(pl.nextAction).toBeNull();
  });

  it("treats a missing entry type as unsupported", () => {
    const p = profile();
    delete p.inputs.entryType;
    expect(plan(p).supported).toBe(false);
  });

  it("flags a move-in date before arrival", () => {
    const pl = plan(profile({ arrivalDate: "2026-10-20", moveInDate: "2026-10-10" }));
    expect(pl.profileIssues.join(" ")).toContain("before your arrival");
  });

  it("flags and ignores invalid dates", () => {
    const pl = plan(profile({ moveInDate: "2026-13-45" }));
    expect(pl.profileIssues.join(" ")).toContain("not a valid date");
    expect(get(pl, "anmeldung").deadline.status).toBe("needs_input");
    expect(get(pl, "housing").done).toBe(false);
  });

  it("warns when a task is marked done with unmet prerequisites", () => {
    const pl = plan(profile({}, ["anmeldung"]));
    expect(get(pl, "anmeldung").state).toBe("done");
    expect(get(pl, "anmeldung").warnings.join(" ")).toContain("prerequisites");
  });

  it("flags a stale pack", () => {
    expect(plan(profile(), "2026-10-24").packStale).toBe(false);
    expect(plan(profile(), "2027-02-01").packStale).toBe(true);
  });
});

describe("trust guarantees", () => {
  const scenarios: [string, Profile, string][] = [
    ["no housing", profile(), TODAY],
    ["moved in", profile({ moveInDate: "2026-10-21" }), TODAY],
    ["overdue", profile({ moveInDate: "2026-09-01" }), TODAY],
    ["visa passed", profile({ visaEndDate: "2026-09-01" }), TODAY],
    ["all done", profile({ moveInDate: "2026-10-01" }, ["landlord_confirmation", "anmeldung", "health_insurance", "enrollment", "livelihood", "lea_application", "lea_appointment", "rundfunkbeitrag"]), TODAY],
  ];

  it.each(scenarios)("never marks overdue without a hard, computed deadline (%s)", (_n, p, today) => {
    const pl = plan(p, today);
    for (const t of pl.tasks) {
      if (t.state === "overdue") {
        expect(t.deadline.status).toBe("computed");
        expect(t.deadline.hard).toBe(true);
        expect(["statutory", "authority_stated"]).toContain(t.deadline.kind);
      }
    }
  });

  it.each(scenarios)("only computes dates for rules that cite sources (%s)", (_n, p, today) => {
    const pl = plan(p, today);
    for (const t of pl.tasks) {
      if (t.deadline.status === "computed") expect(t.deadline.sourceIds.length).toBeGreaterThan(0);
      if (t.deadline.kind === "none_found" || t.deadline.kind === "informational")
        expect(t.deadline.date).toBeUndefined();
    }
  });

  it("keeps info-only tasks out of the state machine", () => {
    const pl = plan(profile({ moveInDate: "2026-09-01" }));
    for (const id of ["fiktionsbescheinigung", "tax_id", "bank_account"]) {
      expect(get(pl, id).state).toBe("info_only");
      expect(get(pl, id).meanwhile).toEqual([]);
    }
  });

  it("is deterministic and does not mutate its input", () => {
    const p = profile({ moveInDate: "2026-10-21" }, ["landlord_confirmation"]);
    const snapshot = JSON.stringify(p);
    const a = JSON.stringify(plan(p));
    const b = JSON.stringify(plan(p));
    expect(a).toBe(b);
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("labels every requirement with a basis and, unless inferred, a source", () => {
    const pl = plan(profile());
    for (const t of pl.tasks)
      for (const r of t.requirements) {
        expect(["legal_requirement", "authority_requirement", "stated_sequence", "inferred"]).toContain(r.basis);
        if (r.basis !== "inferred") expect(r.sourceIds.length).toBeGreaterThan(0);
      }
  });
});
