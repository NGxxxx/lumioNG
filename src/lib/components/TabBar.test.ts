import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import type { ContextKind, WorkTab } from "../stores/navigation.svelte";
import TabBar from "./TabBar.svelte";

const ctx: { kind: ContextKind; label: string }[] = [
  { kind: "database", label: "Database" },
  { kind: "collection", label: "Collection" },
  { kind: "data", label: "Data" },
];

describe("TabBar", () => {
  it("context tab không có nút đóng; render đủ nhãn", () => {
    const { getByText, queryByLabelText } = render(TabBar, {
      props: {
        contextTabs: ctx,
        workTabs: [],
        active: { zone: "context", kind: "data" },
        onShowContext: vi.fn(),
        onActivateWork: vi.fn(),
        onCloseWork: vi.fn(),
        onNewQuery: vi.fn(),
      },
    });
    expect(getByText("Database")).toBeTruthy();
    expect(getByText("Data")).toBeTruthy();
    expect(queryByLabelText("Close tab")).toBeNull();
  });

  it("click context tab → onShowContext(kind)", async () => {
    const onShowContext = vi.fn();
    const { getByText } = render(TabBar, {
      props: {
        contextTabs: ctx,
        workTabs: [],
        active: { zone: "context", kind: "data" },
        onShowContext,
        onActivateWork: vi.fn(),
        onCloseWork: vi.fn(),
        onNewQuery: vi.fn(),
      },
    });
    await fireEvent.click(getByText("Collection"));
    expect(onShowContext).toHaveBeenCalledWith("collection");
  });

  it("work tab có nút đóng; click → onCloseWork(id); click nhãn → onActivateWork(id)", async () => {
    const onCloseWork = vi.fn();
    const onActivateWork = vi.fn();
    const work: WorkTab[] = [{ id: 7, kind: "document", db: "d", coll: "orders", mode: "insert", initial: null, idText: null }];
    const { getByText, getByLabelText } = render(TabBar, {
      props: {
        contextTabs: [],
        workTabs: work,
        active: { zone: "work", id: 7 },
        onShowContext: vi.fn(),
        onActivateWork,
        onCloseWork,
        onNewQuery: vi.fn(),
      },
    });
    await fireEvent.click(getByText("orders / new"));
    expect(onActivateWork).toHaveBeenCalledWith(7);
    await fireEvent.click(getByLabelText("Close tab"));
    expect(onCloseWork).toHaveBeenCalledWith(7);
  });

  it("[+] button triggers onNewQuery", async () => {
    const onNewQuery = vi.fn();
    const { getByTitle } = render(TabBar, {
      props: { contextTabs: [], workTabs: [], active: null, onShowContext: vi.fn(), onActivateWork: vi.fn(), onCloseWork: vi.fn(), onNewQuery },
    });
    await fireEvent.click(getByTitle("New aggregate query"));
    expect(onNewQuery).toHaveBeenCalled();
  });
});
