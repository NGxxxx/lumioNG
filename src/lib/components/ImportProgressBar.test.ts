import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import ImportProgressBar from "./ImportProgressBar.svelte";

describe("ImportProgressBar", () => {
  it("renders the given label text", () => {
    render(ImportProgressBar, { props: { done: 3, total: 10, label: "3/10" } });
    expect(screen.getByText("3/10")).toBeTruthy();
  });

  it("fills the bar proportionally to done/total", () => {
    const { container } = render(ImportProgressBar, { props: { done: 5, total: 20, label: "5/20" } });
    const fill = container.querySelector(".fill") as HTMLElement;
    expect(fill.style.width).toBe("25%");
  });

  it("shows 0% width when total is 0", () => {
    const { container } = render(ImportProgressBar, { props: { done: 0, total: 0, label: "" } });
    const fill = container.querySelector(".fill") as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });

  it("renders the label as plain status text instead of a bar when unknown", () => {
    const { container } = render(ImportProgressBar, { props: { done: 0, total: 0, label: "Reading file…", unknown: true } });
    expect(screen.getByText("Reading file…")).toBeTruthy();
    expect(container.querySelector(".bar")).toBeNull();
  });
});
