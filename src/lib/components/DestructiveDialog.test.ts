import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import DestructiveDialog from "./DestructiveDialog.svelte";
import { createDestructiveGate } from "../stores/destructiveGate.svelte";
import type { Environment } from "../domain/environment";

async function open(env: Environment, req: Parameters<ReturnType<typeof createDestructiveGate>["request"]>[0], run = vi.fn()) {
  const gate = createDestructiveGate(() => env);
  await gate.request(req, run);
  const utils = render(DestructiveDialog, { props: { gate } });
  return { gate, run, ...utils };
}

describe("DestructiveDialog", () => {
  it("names the count on the button and confirms with a click", async () => {
    const { getByRole, getByText, run } = await open("dev", { op: "deleteMany", target: { db: "shop", coll: "orders" }, count: 1204, undoable: true });
    expect(getByText(/1,204 matching documents in shop.orders/)).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "Delete 1,204 documents" }));
    expect(run).toHaveBeenCalled();
  });

  it("type-to-confirm keeps the button disabled until the name matches", async () => {
    const { getByRole, getByLabelText, run } = await open("prod", { op: "deleteMany", target: { db: "shop", coll: "orders" }, count: 3 });
    const btn = getByRole("button", { name: "Delete 3 documents" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await fireEvent.input(getByLabelText(/Type orders to confirm/), { target: { value: "orders" } });
    expect(btn.disabled).toBe(false);
    await fireEvent.click(btn);
    expect(run).toHaveBeenCalled();
  });

  it("states irreversibility when not undoable", async () => {
    const { getByText } = await open("dev", { op: "dropCollection", target: { db: "shop", coll: "orders" }, count: 5 });
    expect(getByText("This cannot be undone.")).toBeTruthy();
  });

  it("a failed count says so", async () => {
    const { getByText } = await open("dev", { op: "deleteMany", target: { db: "shop", coll: "orders" }, fetchCount: () => Promise.reject(new Error("x")) });
    expect(getByText("Couldn't count documents.")).toBeTruthy();
  });

  it("Cancel cancels", async () => {
    const { getByRole, gate } = await open("dev", { op: "deleteOne", target: { db: "shop", coll: "orders", detail: "_id = 1" }, count: 1, undoable: true });
    await fireEvent.click(getByRole("button", { name: "Cancel" }));
    expect(gate.pending).toBeNull();
  });

  it("a new request starts with an empty confirmation field", async () => {
    const { gate, getByLabelText, getByRole } = await open("prod", { op: "deleteMany", target: { db: "shop", coll: "orders" }, count: 3 });
    await fireEvent.input(getByLabelText(/Type orders to confirm/), { target: { value: "orders" } });
    gate.cancel();
    await gate.request({ op: "deleteMany", target: { db: "shop", coll: "orders" }, count: 5000 }, vi.fn());
    await tick();
    expect((getByLabelText(/Type orders to confirm/) as HTMLInputElement).value).toBe("");
    expect((getByRole("button", { name: "Delete 5,000 documents" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("one document reads singular", async () => {
    const { getByRole } = await open("dev", { op: "deleteMany", target: { db: "shop", coll: "orders" }, count: 1, undoable: true });
    expect(getByRole("button", { name: "Delete 1 document" })).toBeTruthy();
  });
});
