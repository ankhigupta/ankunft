// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { berlinPack } from "@/lib/pack/load";
import { IntakeFields } from "./Intake";

afterEach(cleanup);

const dates = (inputs: Record<string, string>) => {
  const { container } = render(
    <IntakeFields pack={berlinPack} profile={{ inputs, completed: [] }} onChange={() => {}} />,
  );
  return Object.fromEntries(
    [...container.querySelectorAll<HTMLInputElement>('input[type="date"]')].map((el) => [el.id, el]),
  );
};

describe("date inputs", () => {
  it("mark an empty value so mobile CSS can style the placeholder", () => {
    const d = dates({});
    expect(Object.keys(d)).toEqual(["in-arrivalDate", "in-moveInDate", "in-visaEndDate"]);
    for (const el of Object.values(d)) expect(el.hasAttribute("data-empty")).toBe(true);
  });

  it("do not mark a filled value", () => {
    const d = dates({ arrivalDate: "2026-10-20" });
    expect(d["in-arrivalDate"].value).toBe("2026-10-20");
    expect(d["in-arrivalDate"].hasAttribute("data-empty")).toBe(false);
    expect(d["in-moveInDate"].hasAttribute("data-empty")).toBe(true);
  });
});
