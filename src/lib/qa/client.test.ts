import { describe, expect, it } from "vitest";
import { askQuestion } from "./client";

const ok = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("askQuestion (manual submission path)", () => {
  it("posts the typed question and today's date as JSON", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ kind: "abstain", question: "x", reason: "r" }));
    }) as unknown as typeof fetch;

    const res = await askQuestion("how long to register?", "2026-10-29", { fetchImpl });

    expect(res.kind).toBe("abstain");
    expect(seen?.url).toBe("/api/ask");
    expect(seen?.init.method).toBe("POST");
    expect(JSON.parse(String(seen?.init.body))).toEqual({
      question: "how long to register?",
      today: "2026-10-29",
    });
  });

  it("surfaces the server's error message", async () => {
    await expect(
      askQuestion("q", "2026-10-29", { fetchImpl: ok({ error: "nope" }, 400) }),
    ).rejects.toThrow("nope");
  });

  it("gives a readable error for a non-JSON failure body", async () => {
    const fetchImpl = (async () => new Response("<html>500</html>", { status: 500 })) as unknown as typeof fetch;
    await expect(askQuestion("q", "2026-10-29", { fetchImpl })).rejects.toThrow(/could not be sent/);
  });

  it("surfaces network failures", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(askQuestion("q", "2026-10-29", { fetchImpl })).rejects.toThrow("Failed to fetch");
  });

  it("aborts a hung request so the form cannot stay locked", async () => {
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    await expect(askQuestion("q", "2026-10-29", { fetchImpl, timeoutMs: 20 })).rejects.toThrow(/took too long/);
  });
});
