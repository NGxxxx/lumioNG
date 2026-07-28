import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import TargetCollectionField from "./TargetCollectionField.svelte";

describe("TargetCollectionField", () => {
  it("renders the current value and suggests existingCollections via a datalist", () => {
    render(TargetCollectionField, {
      props: { value: "users", existingCollections: ["users", "orders"], onInput: vi.fn() },
    });
    const input = screen.getByLabelText("Target collection") as HTMLInputElement;
    expect(input.value).toBe("users");
    const datalist = document.getElementById(input.getAttribute("list")!) as HTMLDataListElement;
    expect([...datalist.options].map((o) => o.value)).toEqual(["users", "orders"]);
  });

  it("calls onInput with the typed value", async () => {
    const onInput = vi.fn();
    render(TargetCollectionField, { props: { value: "", existingCollections: [], onInput } });
    await fireEvent.input(screen.getByLabelText("Target collection"), { target: { value: "orders_backup" } });
    expect(onInput).toHaveBeenCalledWith("orders_backup");
  });

  it("resolves errorKey through the message catalog", () => {
    render(TargetCollectionField, {
      props: { value: "system.foo", existingCollections: [], onInput: vi.fn(), errorKey: "err_coll_name_system" },
    });
    expect(screen.getByText("Collection name cannot start with 'system.'.")).toBeTruthy();
  });

  it("shows no error when errorKey is null", () => {
    render(TargetCollectionField, { props: { value: "users", existingCollections: [], onInput: vi.fn(), errorKey: null } });
    expect(screen.queryByText(/Collection name/)).toBeNull();
  });

  it("shows the given notice text verbatim", () => {
    render(TargetCollectionField, {
      props: { value: "orders_backup", existingCollections: [], onInput: vi.fn(), notice: "Will create new collection orders_backup." },
    });
    expect(screen.getByText("Will create new collection orders_backup.")).toBeTruthy();
  });

  it("applies a placeholder when given", () => {
    render(TargetCollectionField, {
      props: { value: "", existingCollections: [], onInput: vi.fn(), placeholder: "One new collection per table" },
    });
    expect((screen.getByLabelText("Target collection") as HTMLInputElement).placeholder).toBe("One new collection per table");
  });
});
