import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import type { WorkTab } from "../stores/navigation.svelte";
import TabBar from "./TabBar.svelte";

const dest = { label: "shop.orders", page: "collection" as const };

const SESSION_A = { id: "conn:1", label: "Local Dev", color: "#e06c75" };
const SESSION_B = { id: "conn:2", label: "Staging", color: "#61afef" };

describe("TabBar", () => {
  it("renders one non-closable destination tab before the work tabs", () => {
    const { getByText, queryByLabelText, queryByText } = render(TabBar, {
      props: {
        destination: dest,
        workTabs: [],
        active: { zone: "destination" },
        onShowDestination: vi.fn(),
        onActivateWork: vi.fn(),
        onCloseWork: vi.fn(),
        onNewQuery: vi.fn(),
      },
    });
    expect(getByText("shop.orders")).toBeTruthy();
    expect(queryByLabelText("Close tab")).toBeNull();
    expect(queryByText("Collection")).toBeNull();
  });

  it("click destination tab → onShowDestination", async () => {
    const onShowDestination = vi.fn();
    const { getByText } = render(TabBar, {
      props: {
        destination: dest,
        workTabs: [],
        active: { zone: "work", id: 1 },
        onShowDestination,
        onActivateWork: vi.fn(),
        onCloseWork: vi.fn(),
        onNewQuery: vi.fn(),
      },
    });
    await fireEvent.click(getByText("shop.orders"));
    expect(onShowDestination).toHaveBeenCalled();
  });

  it("no destination tab when not connected", () => {
    const { container } = render(TabBar, {
      props: { destination: null, workTabs: [], active: null, onShowDestination: vi.fn(), onActivateWork: vi.fn(), onCloseWork: vi.fn(), onNewQuery: vi.fn() },
    });
    expect(container.querySelector(".tab.destination")).toBeNull();
  });

  it("work tab has close button; click → onCloseWork(id); click label → onActivateWork(id)", async () => {
    const onCloseWork = vi.fn();
    const onActivateWork = vi.fn();
    const work: WorkTab[] = [{ id: 7, kind: "document", sessionId: "conn:1", db: "d", coll: "orders", mode: "insert", initial: null, idText: null }];
    const { getByText, getByLabelText } = render(TabBar, {
      props: {
        destination: null,
        workTabs: work,
        sessions: [SESSION_A],
        active: { zone: "work", id: 7 },
        onShowDestination: vi.fn(),
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
      props: { destination: null, workTabs: [], active: null, onShowDestination: vi.fn(), onActivateWork: vi.fn(), onCloseWork: vi.fn(), onNewQuery },
    });
    await fireEvent.click(getByTitle("New aggregate query"));
    expect(onNewQuery).toHaveBeenCalled();
  });

  it("work tab renders a color dot matching its session color", () => {
    const work: WorkTab[] = [{ id: 3, kind: "document", sessionId: "conn:1", db: "d", coll: "users", mode: "insert", initial: null, idText: null }];
    const { container } = render(TabBar, {
      props: {
        destination: null,
        workTabs: work,
        sessions: [SESSION_A],
        active: { zone: "work", id: 3 },
        onShowDestination: vi.fn(),
        onActivateWork: vi.fn(),
        onCloseWork: vi.fn(),
        onNewQuery: vi.fn(),
      },
    });
    const dot = container.querySelector(".session-dot") as HTMLElement | null;
    expect(dot).not.toBeNull();
    expect(dot!.dataset.color).toBe(SESSION_A.color);
  });

  it("work tab dot falls back to neutral color when session is not found", () => {
    const work: WorkTab[] = [{ id: 5, kind: "document", sessionId: "conn:99", db: "d", coll: "test", mode: "insert", initial: null, idText: null }];
    const { container } = render(TabBar, {
      props: {
        destination: null,
        workTabs: work,
        sessions: [SESSION_A],
        active: null,
        onShowDestination: vi.fn(),
        onActivateWork: vi.fn(),
        onCloseWork: vi.fn(),
        onNewQuery: vi.fn(),
      },
    });
    const dot = container.querySelector(".session-dot") as HTMLElement | null;
    expect(dot).not.toBeNull();
    // fallback color, not undefined/empty
    expect(dot!.dataset.color).toBeTruthy();
  });

  it("clicking a tab from a non-active session calls onActivateWork with the tab id", async () => {
    const onActivateWork = vi.fn();
    const tabA: WorkTab = { id: 10, kind: "document", sessionId: "conn:1", db: "d", coll: "alpha", mode: "insert", initial: null, idText: null };
    const tabB: WorkTab = { id: 11, kind: "document", sessionId: "conn:2", db: "d", coll: "beta", mode: "insert", initial: null, idText: null };
    const { getByText } = render(TabBar, {
      props: {
        destination: null,
        workTabs: [tabA, tabB],
        sessions: [SESSION_A, SESSION_B],
        // active is on session A's tab
        active: { zone: "work", id: 10 },
        onShowDestination: vi.fn(),
        onActivateWork,
        onCloseWork: vi.fn(),
        onNewQuery: vi.fn(),
      },
    });
    // click the tab belonging to SESSION_B (different session)
    await fireEvent.click(getByText("beta / new"));
    expect(onActivateWork).toHaveBeenCalledWith(11);
  });

  it("a prod session's work tab gets a red dot", () => {
    const { container } = render(TabBar, {
      props: {
        destination: dest,
        workTabs: [{ id: 1, kind: "query", sessionId: "conn:9", title: "q" } as unknown as WorkTab],
        sessions: [{ id: "conn:9", label: "Prod", color: "#3b82f6", environment: "prod" }],
        active: { zone: "destination" },
        onShowDestination: vi.fn(),
        onActivateWork: vi.fn(),
        onCloseWork: vi.fn(),
        onNewQuery: vi.fn(),
      },
    });
    expect(container.querySelector(".tab.work .session-dot")!.getAttribute("data-color")).toBe("var(--danger)");
  });
});
