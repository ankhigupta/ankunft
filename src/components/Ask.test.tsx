// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/ask/route";
import { Ask } from "./Ask";

const TODAY = "2026-10-29";
const SUGGESTION = "How many days do I have to register my address?";

/** Routes the component's fetch to the real handler, so answers come from the real corpus. */
const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
  expect(url).toBe("/api/ask");
  return POST(new Request("http://localhost/api/ask", init));
});

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const input = () => screen.getByLabelText("Your question") as HTMLInputElement;
const askButton = () => screen.getByRole("button", { name: /^Ask$/ }) as HTMLButtonElement;
const sentQuestions = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)).question);

describe("Ask form", () => {
  it("clicking a suggestion fills the input and does not submit", async () => {
    const user = userEvent.setup();
    render(<Ask today={TODAY} />);

    await user.click(screen.getByRole("button", { name: SUGGESTION }));

    expect(input().value).toBe(SUGGESTION);
    expect(document.activeElement).toBe(input());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("a suggestion is submitted only after clicking Ask, then shows cited passages", async () => {
    const user = userEvent.setup();
    render(<Ask today={TODAY} />);

    await user.click(screen.getByRole("button", { name: SUGGESTION }));
    await user.click(askButton());

    expect(sentQuestions()).toEqual([SUGGESTION]);
    const link = await screen.findAllByRole("link", { name: /.+/ });
    expect(link[0].getAttribute("href")).toMatch(/^https?:\/\//);
    expect(screen.getAllByText(/retrieved/).length).toBeGreaterThan(0);
  });

  it("clicking Ask submits a typed question and keeps it in the input", async () => {
    const user = userEvent.setup();
    render(<Ask today={TODAY} />);

    await user.type(input(), "how long do I have to register");
    await user.click(askButton());

    expect(sentQuestions()).toEqual(["how long do I have to register"]);
    await waitFor(() => expect(screen.getAllByText(/retrieved/).length).toBeGreaterThan(0));
    expect(input().value).toBe("how long do I have to register");
  });

  it("pressing Enter submits a typed question", async () => {
    const user = userEvent.setup();
    render(<Ask today={TODAY} />);

    await user.type(input(), "how long do I have to register{Enter}");

    expect(sentQuestions()).toEqual(["how long do I have to register"]);
    await waitFor(() => expect(screen.getAllByText(/retrieved/).length).toBeGreaterThan(0));
  });

  it("an unrelated question abstains and shows no passages", async () => {
    const user = userEvent.setup();
    render(<Ask today={TODAY} />);

    await user.type(input(), "where to start{Enter}");

    expect(await screen.findByText(/could not find this in the official pages/i)).not.toBeNull();
    expect(screen.queryByText(/retrieved/)).toBeNull();
  });

  it("does not submit an empty question", async () => {
    const user = userEvent.setup();
    render(<Ask today={TODAY} />);

    expect(askButton().disabled).toBe(true);
    await user.type(input(), "   {Enter}");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a loading state while waiting and an error if the request fails", async () => {
    const user = userEvent.setup();
    let reject!: (e: Error) => void;
    fetchMock.mockImplementationOnce(() => new Promise((_, rj) => (reject = rj)));
    render(<Ask today={TODAY} />);

    await user.type(input(), "how long do I have to register{Enter}");

    expect(screen.getByText(/Searching the saved pages for: how long do I have to register/)).not.toBeNull();
    expect((screen.getByRole("button", { name: "Searching" }) as HTMLButtonElement).disabled).toBe(true);

    reject(new Error("Failed to fetch"));
    expect(await screen.findByText("Failed to fetch")).not.toBeNull();
    expect(input().value).toBe("how long do I have to register");
    expect(askButton().disabled).toBe(false);
  });
});
