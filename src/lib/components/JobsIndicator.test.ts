import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import JobsIndicator from "./JobsIndicator.svelte";
import { createJobs, type JobState } from "../stores/jobs.svelte";

function src(label: string, pct: number | null, cancel = vi.fn()) {
  const state: JobState = "running";
  return { kind: "export" as const, label, progress: () => pct, state: () => state, cancel };
}

describe("JobsIndicator", () => {
  it("is empty without jobs", () => {
    const { container } = render(JobsIndicator, { props: { jobs: createJobs() } });
    expect(container.textContent?.trim()).toBe("");
  });

  it("one job: label and percent; two jobs: a count", () => {
    const jobs = createJobs();
    jobs.register(src("Exporting orders.json", 45));
    const { getByRole, rerender } = render(JobsIndicator, { props: { jobs } });
    expect(getByRole("button").textContent).toContain("Exporting orders.json · 45%");
    jobs.register(src("Importing into shop.users", null));
    return rerender({ jobs }).then(() => expect(getByRole("button").textContent).toContain("2 tasks"));
  });

  it("the popover lists jobs with Cancel", async () => {
    const jobs = createJobs();
    const cancel = vi.fn();
    jobs.register(src("Exporting orders.json", 45, cancel));
    const { getByRole } = render(JobsIndicator, { props: { jobs } });
    await fireEvent.click(getByRole("button", { name: /Exporting/ }));
    await fireEvent.click(getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalled();
  });

  it("Details lists the per-target status", async () => {
    const jobs = createJobs();
    jobs.register({ ...src("Exporting 2 collections", 50), details: () => [{ label: "shop.a", state: "Done" }, { label: "shop.b", state: "Running" }] });
    const { getByRole, getByText } = render(JobsIndicator, { props: { jobs } });
    await fireEvent.click(getByRole("button", { name: /Exporting/ }));
    await fireEvent.click(getByRole("button", { name: "Details" }));
    expect(getByText("shop.a")).toBeTruthy();
    expect(getByText("shop.b")).toBeTruthy();
  });
});
