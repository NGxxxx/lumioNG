import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ImportResultSummary from "./ImportResultSummary.svelte";

describe("ImportResultSummary", () => {
  it("shows the inserted/failed summary line", () => {
    render(ImportResultSummary, { props: { inserted: 5, failed: 1, errors: ["doc#2: bad"] } });
    expect(screen.getByText("Inserted 5, skipped 1 errors.")).toBeTruthy();
  });

  it("hides the error list until the toggle is clicked", async () => {
    render(ImportResultSummary, { props: { inserted: 0, failed: 1, errors: ["doc#2: bad"] } });
    expect(screen.queryByText("doc#2: bad")).toBeNull();
    await fireEvent.click(screen.getByText("View errors (1)"));
    expect(screen.getByText("doc#2: bad")).toBeTruthy();
  });

  it("re-collapses the error list when the toggle is clicked a second time", async () => {
    render(ImportResultSummary, { props: { inserted: 0, failed: 1, errors: ["doc#2: bad"] } });
    const toggle = screen.getByText("View errors (1)");
    await fireEvent.click(toggle);
    expect(screen.getByText("doc#2: bad")).toBeTruthy();
    await fireEvent.click(toggle);
    expect(screen.queryByText("doc#2: bad")).toBeNull();
  });

  it("shows no toggle when there are no errors", () => {
    render(ImportResultSummary, { props: { inserted: 5, failed: 0, errors: [] } });
    expect(screen.queryByText(/View errors/)).toBeNull();
  });
});
