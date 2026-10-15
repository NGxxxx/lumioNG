import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import ViewSwitcher from "./ViewSwitcher.svelte";

const items = [
  { key: "data", label: "Data" },
  { key: "schema", label: "Schema" },
  { key: "indexes", label: "Indexes" },
];

describe("ViewSwitcher", () => {
  it("renders a tablist with the active item selected", () => {
    const { getByRole, getAllByRole } = render(ViewSwitcher, { props: { items, value: "schema", onchange: vi.fn(), label: "Views" } });
    expect(getByRole("tablist").getAttribute("aria-label")).toBe("Views");
    expect(getAllByRole("tab").map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
  });

  it("clicking an item calls onchange with its key", async () => {
    const onchange = vi.fn();
    const { getByRole } = render(ViewSwitcher, { props: { items, value: "data", onchange, label: "Views" } });
    await fireEvent.click(getByRole("tab", { name: "Indexes" }));
    expect(onchange).toHaveBeenCalledWith("indexes");
  });
});
