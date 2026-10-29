import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Contract tests for the responsive CSS. They cannot render Safari, so they pin the
 * rules that fixed the iPhone layout (checked by hand in WebKit at 390px and 320px).
 */
const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

/** Body of the first `@media (query) { ... }` block, found by brace matching. */
function mediaBlock(query: string): string {
  const start = css.indexOf(`@media (${query})`);
  expect(start, `missing @media (${query})`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(css.indexOf("{", start) + 1, i);
  }
  throw new Error("unbalanced braces");
}

/** Declarations of the rule whose selector list contains `selector`. */
function rule(block: string, selector: string): string {
  const m = [...block.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((r) =>
    r[1].split(",").some((sel) => sel.trim() === selector),
  );
  expect(m, `no rule for ${selector}`).toBeTruthy();
  return m![2];
}

const narrow = mediaBlock("max-width: 39.99rem");

describe("narrow-screen CSS", () => {
  it("gives date, select and text inputs the same height and a reset native look", () => {
    const decl = rule(narrow, '.field input[type="date"]');
    expect(rule(narrow, ".field select")).toBe(decl);
    expect(rule(narrow, '.ask__form input[type="text"]')).toBe(decl);
    expect(decl).toMatch(/height:\s*46px/);
    expect(decl).toMatch(/(?<!-)appearance:\s*none/);
    expect(decl).toMatch(/-webkit-appearance:\s*none/);
    expect(decl).toMatch(/max-width:\s*100%/);
    expect(decl).toMatch(/min-width:\s*0/);
  });

  it("keeps form text at 16px or more so iOS does not zoom on focus", () => {
    expect(rule(narrow, '.field input[type="date"]')).toMatch(/font-size:\s*1rem/);
  });

  it("keeps an empty date's value box from collapsing", () => {
    expect(rule(narrow, '.field input[type="date"]::-webkit-date-and-time-value')).toMatch(/min-height:\s*1\.5em/);
  });

  it("styles an empty date placeholder with readable contrast", () => {
    expect(rule(narrow, '.field input[type="date"][data-empty]')).toMatch(/color:\s*#5a6a82/);
  });

  it("stacks the ask form so its placeholder is not cut short", () => {
    expect(rule(narrow, ".ask__form")).toMatch(/minmax\(0,\s*1fr\)/);
  });

  it("does not shrink any text below 14px", () => {
    for (const [, size] of narrow.matchAll(/font-size:\s*([\d.]+)rem/g)) {
      expect(Number(size)).toBeGreaterThanOrEqual(0.875);
    }
  });

  it("leaves desktop untouched: nothing in the wider breakpoints restyles form controls", () => {
    for (const q of ["min-width: 40rem", "min-width: 60rem"]) {
      expect(mediaBlock(q)).not.toMatch(/appearance|type="date"|select/);
    }
  });
});

describe("overflow safety (all widths)", () => {
  it.each([".fields", ".row__btn", ".req"])("%s grid tracks can shrink", (sel) => {
    const m = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(
      (r) => r[1].trim() === sel && r[2].includes("grid-template-columns"),
    );
    expect(m?.[2]).toMatch(/minmax\(0,\s*1fr\)/);
  });

  it("long words and URLs in task details and citations wrap", () => {
    const m = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((r) => r[1].includes(".detail__body,"));
    expect(m?.[2]).toMatch(/overflow-wrap:\s*anywhere/);
    for (const sel of [".sources", ".quote__cite", ".note"]) expect(m?.[1]).toContain(sel);
  });
});
