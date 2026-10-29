import { describe, expect, it } from "vitest";
import raw from "../../data/berlin-student.pack.json";
import { berlinPack } from "./load";
import { isPackStale, packAgeDays, validatePack } from "./validate";

/* eslint-disable @typescript-eslint/no-explicit-any */
const clone = () => JSON.parse(JSON.stringify(raw)) as any;
const codes = (r: ReturnType<typeof validatePack>) => r.issues.filter((i) => i.severity === "error").map((i) => i.code);
const task = (p: any, id: string) => p.tasks.find((t: any) => t.id === id);

describe("Berlin pack", () => {
  it("passes validation with no errors", () => {
    const r = validatePack(raw);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("loads through the loader", () => {
    expect(berlinPack.tasks.length).toBe(12);
    expect(berlinPack.tasks.filter((t) => t.mode === "tracked").length).toBe(9);
  });

  it("only offers computable deadlines that cite a matching authority", () => {
    for (const t of berlinPack.tasks) {
      const d = t.deadline;
      if (d.kind === "statutory") {
        const types = d.sourceIds.map((id) => berlinPack.sources.find((s) => s.id === id)?.authorityType);
        expect(types).toContain("statute");
      }
    }
  });

  it("keeps the Anmeldung clock on the move-in date, not on arrival", () => {
    const d = task(raw, "anmeldung").deadline;
    expect(d.triggerInput).toBe("moveInDate");
    expect(d.offsetDays).toBe(14);
  });

  it("flags staleness by the pack's own limit", () => {
    expect(isPackStale(berlinPack, "2026-10-24")).toBe(false);
    expect(packAgeDays(berlinPack, "2026-10-24")).toBe(1);
    expect(isPackStale(berlinPack, "2027-01-01")).toBe(true);
  });
});

describe("validator trust rules", () => {
  it("rejects structurally invalid packs", () => {
    const p = clone();
    delete p.tasks[0].title;
    expect(validatePack(p).ok).toBe(false);
  });

  it("rejects a rule that cites an unknown source", () => {
    const p = clone();
    task(p, "anmeldung").requirements[0].sourceIds = ["S99"];
    expect(codes(validatePack(p))).toContain("unknown_source");
  });

  it("rejects a statutory deadline backed only by a government page", () => {
    const p = clone();
    task(p, "anmeldung").deadline.sourceIds = ["S3"];
    expect(codes(validatePack(p))).toContain("statutory_without_statute");
  });

  it("does not accept a statute mirror as the sole basis of a statutory deadline", () => {
    const p = clone();
    task(p, "anmeldung").deadline.sourceIds = ["S16"];
    expect(codes(validatePack(p))).toContain("statutory_without_statute");
  });

  it("rejects a legal_requirement label with no statute behind it", () => {
    const p = clone();
    task(p, "landlord_confirmation").requirements[0].sourceIds = ["S3"];
    expect(codes(validatePack(p))).toContain("legal_without_statute");
  });

  it("requires inferred dependencies to explain themselves", () => {
    const p = clone();
    const r = task(p, "enrollment").requirements[0];
    r.basis = "inferred";
    r.sourceIds = [];
    delete r.note;
    expect(codes(validatePack(p))).toContain("inferred_without_note");
  });

  it("accepts an inferred dependency that carries a note", () => {
    const p = clone();
    const r = task(p, "enrollment").requirements[0];
    r.basis = "inferred";
    r.sourceIds = [];
    r.note = "Our inference: most universities ask for insurance proof at enrollment.";
    expect(validatePack(p).ok).toBe(true);
  });

  it("rejects non-inferred requirements without a source", () => {
    const p = clone();
    task(p, "lea_appointment").requirements[0].sourceIds = [];
    expect(codes(validatePack(p))).toContain("requirement_without_source");
  });

  it("blocks rules from leaning on an unreliable source", () => {
    const p = clone();
    p.sources.find((s: any) => s.id === "S4").reliability = "unreliable";
    expect(codes(validatePack(p))).toContain("unreliable_source");
  });

  it("rejects dependency cycles", () => {
    const p = clone();
    task(p, "housing").requirements = [
      {
        id: "h-1",
        label: "bad",
        expr: { task: "anmeldung" },
        basis: "authority_requirement",
        sourceIds: ["S3"],
      },
    ];
    expect(codes(validatePack(p))).toContain("cycle");
  });

  it("rejects a requirement that depends on an info-only task", () => {
    const p = clone();
    task(p, "lea_appointment").requirements[0].expr = { task: "bank_account" };
    expect(codes(validatePack(p))).toContain("depends_on_info_task");
  });

  it("keeps 'none found' deadlines free of invented rules", () => {
    const p = clone();
    task(p, "health_insurance").deadline.triggerInput = "moveInDate";
    expect(codes(validatePack(p))).toContain("none_found_with_rule");
  });

  it("rejects a deadline kind that needs a university but cites none", () => {
    const p = clone();
    task(p, "lea_application").deadline.sourceIds = ["S4"];
    expect(codes(validatePack(p))).toContain("university_without_university");
  });

  it("rejects unknown conflict references", () => {
    const p = clone();
    task(p, "lea_application").conflictIds = ["C-NOPE"];
    expect(codes(validatePack(p))).toContain("unknown_conflict");
  });

  it("rejects duplicate task ids", () => {
    const p = clone();
    p.tasks[1].id = p.tasks[0].id;
    expect(codes(validatePack(p))).toContain("duplicate_id");
  });
});
