import { describe, expect, it } from "vitest";
import { POST } from "./route";

const post = (body: unknown, raw = false) =>
  POST(
    new Request("http://localhost/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );

describe("POST /api/ask with a manually typed question", () => {
  it("answers with cited passages", async () => {
    const res = await post({ question: "  how many days do I have to register my address  ", today: "2026-10-29" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.kind).toBe("answer");
    expect(data.question).toBe("how many days do I have to register my address");
    expect(data.passages.length).toBeGreaterThan(0);
    expect(data.passages[0].citation.url).toMatch(/^https?:\/\//);
  });

  it("returns the same answer as the suggested question of the same text", async () => {
    const q = "Does my lease replace the landlord's confirmation?";
    const a = await (await post({ question: q, today: "2026-10-29" })).json();
    const b = await (await post({ question: ` ${q} `, today: "2026-10-29" })).json();
    expect(b).toEqual(a);
  });

  it("abstains instead of guessing", async () => {
    const data = await (await post({ question: "What is the capital of France?" })).json();
    expect(data.kind).toBe("abstain");
  });

  it("refuses eligibility judgements", async () => {
    const data = await (await post({ question: "am I eligible for a residence permit" })).json();
    expect(data.kind).toBe("refuse");
  });

  it("rejects empty, oversized and non-JSON bodies with a JSON error", async () => {
    for (const res of [
      await post({ question: "   " }),
      await post({ question: "x".repeat(501) }),
      await post("not json", true),
    ]) {
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
    }
  });
});
