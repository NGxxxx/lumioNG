import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import ToastHost from "./ToastHost.svelte";
import { toast } from "../stores/toast.svelte";

describe("ToastHost", () => {
  it("renders the action button; clicking runs it and dismisses", async () => {
    const run = vi.fn();
    const { findByRole, queryByText } = render(ToastHost);
    toast.push("Updated 1 document", "success", 10_000, { label: "Undo", run });
    await fireEvent.click(await findByRole("button", { name: "Undo" }));
    expect(run).toHaveBeenCalled();
    expect(queryByText("Updated 1 document")).toBeNull();
  });
});
