import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/svelte";
import SuggestInput from "./SuggestInput.svelte";

describe("SuggestInput", () => {
  it("renders the current value", () => {
    render(SuggestInput, { props: { value: "hello", suggestions: [], onInput: vi.fn() } });
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("hello");
  });

  it("calls onInput on every keystroke", async () => {
    const onInput = vi.fn();
    render(SuggestInput, { props: { value: "", suggestions: [], onInput } });
    await fireEvent.input(screen.getByRole("combobox"), { target: { value: "ab" } });
    expect(onInput).toHaveBeenCalledWith("ab");
  });

  it("shows no popup when there are no suggestions", async () => {
    render(SuggestInput, { props: { value: "", suggestions: [], onInput: vi.fn() } });
    await fireEvent.focus(screen.getByRole("combobox"));
    expect(document.querySelector(".suggest-list")).toBeNull();
  });

  it("shows matching suggestions on focus, filtered by prefix, case-insensitive", async () => {
    render(SuggestInput, {
      props: { value: "$g", suggestions: [{ label: "$gt" }, { label: "$gte" }, { label: "$lt" }], onInput: vi.fn() },
    });
    await fireEvent.focus(screen.getByRole("combobox"));
    const labels = Array.from(document.querySelectorAll(".suggest-option .suggest-label")).map((el) => el.textContent);
    expect(labels).toEqual(["$gt", "$gte"]);
  });

  it("renders a detail line when present, none when absent", async () => {
    render(SuggestInput, {
      props: { value: "", suggestions: [{ label: "$gt", detail: "greater than" }, { label: "orders" }], onInput: vi.fn() },
    });
    await fireEvent.focus(screen.getByRole("combobox"));
    const options = Array.from(document.querySelectorAll(".suggest-option"));
    expect(options[0].querySelector(".suggest-detail")?.textContent).toBe("greater than");
    expect(options[1].querySelector(".suggest-detail")).toBeNull();
  });

  it("clicking a suggestion selects it and closes the popup", async () => {
    const onInput = vi.fn();
    render(SuggestInput, { props: { value: "", suggestions: [{ label: "$gt" }], onInput } });
    const input = screen.getByRole("combobox") as HTMLInputElement;
    await fireEvent.focus(input);
    await fireEvent.click(screen.getByText("$gt"));
    expect(onInput).toHaveBeenCalledWith("$gt");
    expect(document.querySelector(".suggest-list")).toBeNull();
  });

  it("ArrowDown then Enter selects the highlighted suggestion", async () => {
    const onInput = vi.fn();
    render(SuggestInput, { props: { value: "", suggestions: [{ label: "$gt" }, { label: "$gte" }], onInput } });
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onInput).toHaveBeenCalledWith("$gt");
  });

  it("Escape closes the popup without changing the value", async () => {
    const onInput = vi.fn();
    render(SuggestInput, { props: { value: "abc", suggestions: [{ label: "$gt" }], onInput } });
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    await fireEvent.keyDown(input, { key: "Escape" });
    expect(document.querySelector(".suggest-list")).toBeNull();
    expect(onInput).not.toHaveBeenCalled();
  });

  it("blurring the input (e.g. clicking elsewhere) closes the popup", async () => {
    render(SuggestInput, { props: { value: "", suggestions: [{ label: "$gt" }], onInput: vi.fn() } });
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    expect(document.querySelector(".suggest-list")).not.toBeNull();
    await fireEvent.blur(input);
    expect(document.querySelector(".suggest-list")).toBeNull();
  });

  it("re-syncs its displayed value when the value prop changes externally (controlled-input contract)", async () => {
    const { rerender } = render(SuggestInput, { props: { value: "old", suggestions: [], onInput: vi.fn() } });
    await rerender({ value: "new", suggestions: [], onInput: vi.fn() });
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("new");
  });

  it("portals the popup to document.body so it escapes a transformed/clipping ancestor", async () => {
    const wrapper = document.createElement("div");
    wrapper.style.overflow = "hidden";
    wrapper.style.transform = "translateY(0px)";
    document.body.appendChild(wrapper);
    render(SuggestInput, {
      props: { value: "", suggestions: [{ label: "$gt" }], onInput: vi.fn() },
      target: wrapper,
    });
    await fireEvent.focus(screen.getByRole("combobox"));
    const list = document.querySelector(".suggest-list")!;
    expect(list.parentElement).toBe(document.body);
    expect(wrapper.contains(list)).toBe(false);
    wrapper.remove();
  });

  it("forwards id and class to the input for label association and caller styling", () => {
    render(SuggestInput, { props: { value: "", suggestions: [], onInput: vi.fn(), id: "my-id", class: "my-class" } });
    const input = screen.getByRole("combobox");
    expect(input.id).toBe("my-id");
    // classList, not exact className equality — Svelte appends its own scoped-CSS hash class to
    // any element matched by this component's <style> block (SuggestInput's `input { ... }` rule).
    expect(input.classList.contains("my-class")).toBe(true);
  });
});
