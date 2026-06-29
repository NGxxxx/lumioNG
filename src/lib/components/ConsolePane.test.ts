import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import ConsolePane from "./ConsolePane.svelte";

describe("ConsolePane", () => {
  it("renders entries and shows elapsed time", () => {
    const { getByText } = render(ConsolePane, {
      props: { entries: [{ level: "log", text: "hello" }], elapsedMs: 42 },
    });
    expect(getByText("hello")).toBeTruthy();
    expect(getByText("42 ms")).toBeTruthy();
  });

  it("calls onClear when Clear is clicked", async () => {
    const onClear = vi.fn();
    const { getByText } = render(ConsolePane, {
      props: { entries: [{ level: "log", text: "x" }], onClear },
    });
    await fireEvent.click(getByText("Clear"));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("disables Clear when there are no entries", () => {
    const { getByText } = render(ConsolePane, { props: { entries: [] } });
    expect((getByText("Clear") as HTMLButtonElement).disabled).toBe(true);
  });

  it("collapses a large entry and expands it via Show more", async () => {
    const big = "a".repeat(2000);
    const { getByText } = render(ConsolePane, { props: { entries: [{ level: "log", text: big }] } });
    expect(getByText("Show more")).toBeTruthy();
    await fireEvent.click(getByText("Show more"));
    expect(getByText("Show less")).toBeTruthy();
  });
});
