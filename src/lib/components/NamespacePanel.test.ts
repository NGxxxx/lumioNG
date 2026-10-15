import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";

vi.mock("../api/connection", () => ({
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  listNamespaces: vi.fn().mockResolvedValue([{ name: "shop", collections: ["users"] }]),
}));
vi.mock("../api/mongoServer", () => ({
  serverStatus: vi.fn().mockResolvedValue("{}"),
  buildInfo: vi.fn().mockResolvedValue("{}"),
  hostInfo: vi.fn().mockResolvedValue("{}"),
}));

vi.mock("../api/files", () => ({
  saveDialog: vi.fn(),
  openDialog: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("../api/documents", () => ({
  exportQuery: vi.fn(),
  exportBson: vi.fn(),
  importDocuments: vi.fn(),
  importBson: vi.fn(),
}));

import NamespacePanel from "./NamespacePanel.svelte";
import { sessionManager } from "../stores/sessionManager.svelte";

describe("NamespacePanel", () => {
  beforeEach(async () => {
    // One active session whose tree lists shop.users (focusOrOpen refreshes the tree).
    for (const s of [...sessionManager.sessions]) await sessionManager.closeSession(s.id);
    await sessionManager.focusOrOpen({ connId: 1, uri: "mongodb://h", label: "local" });
    sessionManager.active!.nav.setConnected(true);
  });

  it("collection menu shows Export/Import/Truncate; db menu has no Stats", async () => {
    const { getByText, queryByText } = render(NamespacePanel, { props: {} });

    await fireEvent.click(getByText("shop")); // expand — collections are collapsed by default
    // Open collection context menu
    await fireEvent.contextMenu(getByText("users"));
    expect(getByText("Export…")).toBeTruthy();
    expect(getByText("Import…")).toBeTruthy();
    expect(getByText("Truncate…")).toBeTruthy();

    // Close collection menu by pressing Escape
    await fireEvent.keyDown(window, { key: "Escape" });

    // Open db context menu
    await fireEvent.contextMenu(getByText("shop"));
    expect(queryByText("Stats")).toBeNull();
  });

  it("collection menu: Copy name copies just the collection name (no db prefix)", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
    });
    const { getByText } = render(NamespacePanel, { props: {} });
    await fireEvent.click(getByText("shop")); // expand — collections are collapsed by default
    await fireEvent.contextMenu(getByText("users"));
    await fireEvent.click(getByText("Copy name"));
    expect(writeText).toHaveBeenCalledWith("users");
  });

  it("db menu shows New collection… / Copy name / Refresh / Drop database… / Import…", async () => {
    const { getByText, queryByText } = render(NamespacePanel, { props: {} });
    await fireEvent.contextMenu(getByText("shop"));
    expect(getByText("New collection…")).toBeTruthy();
    expect(getByText("Copy name")).toBeTruthy();
    expect(getByText("Refresh")).toBeTruthy();
    expect(getByText("Drop database…")).toBeTruthy();
    expect(getByText("Import…")).toBeTruthy();
    expect(queryByText("Import SQL dump…")).toBeNull();
  });

  it("db menu Import… opens the general Import dialog directly, with no upfront naming step", async () => {
    const { getByText, queryByText } = render(NamespacePanel, { props: {} });
    await fireEvent.contextMenu(getByText("shop"));
    await fireEvent.click(getByText("Import…"));

    // No NameDialog step — the dialog itself now owns collecting the target collection name.
    expect(queryByText("Import into collection")).toBeNull();
    expect(getByText("Import into shop")).toBeTruthy();
    expect(getByText("Browse…")).toBeTruthy();
  });

  it("clicking error-status session header calls reconnect, not focusSession", async () => {
    const reconnectSpy = vi.spyOn(sessionManager, "reconnect").mockResolvedValue(undefined);
    const focusSpy = vi.spyOn(sessionManager, "focusSession");

    // Force the session into error status
    const sess = sessionManager.sessions[0];
    (sess as unknown as Record<string, unknown>).status = "error";

    const { getByText } = render(NamespacePanel, { props: {} });

    // Click on the session label (inside the session-header div)
    await fireEvent.click(getByText("local"));

    expect(reconnectSpy).toHaveBeenCalledWith(sess.id);
    expect(focusSpy).not.toHaveBeenCalled();

    reconnectSpy.mockRestore();
    focusSpy.mockRestore();
  });

  it("clicking connected session header calls focusSession, not reconnect", async () => {
    const reconnectSpy = vi.spyOn(sessionManager, "reconnect");
    const focusSpy = vi.spyOn(sessionManager, "focusSession");

    // Session is already "connected" (set in beforeEach via setConnected)
    const sess = sessionManager.sessions[0];
    expect(sess.status).toBe("connected");

    const { getByText } = render(NamespacePanel, { props: {} });

    await fireEvent.click(getByText("local"));

    expect(focusSpy).toHaveBeenCalledWith(sess.id);
    expect(reconnectSpy).not.toHaveBeenCalled();

    reconnectSpy.mockRestore();
    focusSpy.mockRestore();
  });

  it("right-click session header shows New database…/Refresh/Manage sessions…/Disconnect", async () => {
    const { getByText } = render(NamespacePanel, { props: {} });
    await fireEvent.contextMenu(getByText("local"));
    expect(getByText("New database…")).toBeTruthy();
    expect(getByText("Refresh")).toBeTruthy();
    expect(getByText("Manage sessions…")).toBeTruthy();
    expect(getByText("Disconnect")).toBeTruthy();
  });

  it("session menu Disconnect asks for confirmation before calling ondisconnect", async () => {
    const ondisconnect = vi.fn();
    const { getByText, queryByText } = render(NamespacePanel, { props: { ondisconnect } });
    await fireEvent.contextMenu(getByText("local"));
    await fireEvent.click(getByText("Disconnect"));
    expect(ondisconnect).not.toHaveBeenCalled();
    // Menu item closed with the menu; only the confirm dialog's own button remains.
    expect(queryByText("Disconnect session?")).toBeTruthy();
    await fireEvent.click(getByText("Disconnect"));
    expect(ondisconnect).toHaveBeenCalled();
  });

  it("session close (X) button asks for confirmation before closing the session", async () => {
    const sess = sessionManager.sessions[0];
    const closeSpy = vi.spyOn(sessionManager, "closeSession");
    const { getByLabelText, getByText, queryByText } = render(NamespacePanel, { props: {} });
    await fireEvent.click(getByLabelText("Close session"));
    expect(closeSpy).not.toHaveBeenCalled();
    expect(queryByText("Disconnect session?")).toBeTruthy();
    await fireEvent.click(getByText("Disconnect"));
    expect(closeSpy).toHaveBeenCalledWith(sess.id);
    closeSpy.mockRestore();
  });

  it("caret toggles collapse without changing activeId", async () => {
    // Open two sessions so we can distinguish focus changes
    await sessionManager.focusOrOpen({ connId: 2, uri: "mongodb://h2", label: "remote" });
    const secondId = sessionManager.sessions[1].id;
    // Focus the second session
    sessionManager.focusSession(secondId);
    expect(sessionManager.activeId).toBe(secondId);

    const { getAllByLabelText } = render(NamespacePanel, { props: {} });

    // Both sessions start expanded ("Collapse session" caret label)
    const collapseBtns = getAllByLabelText("Collapse session");
    expect(collapseBtns).toHaveLength(2);

    // Click the first session's caret to collapse it
    await fireEvent.click(collapseBtns[0]);

    // Active session must NOT have changed — caret click only toggles, does not focus
    expect(sessionManager.activeId).toBe(secondId);

    // The first session is now collapsed: its caret label becomes "Expand session"
    const expandBtns = getAllByLabelText("Expand session");
    expect(expandBtns).toHaveLength(1);
  });

  it("selecting a collection opens it as the destination", async () => {
    sessionManager.openQuery("x"); // a work tab is active
    const { getByText } = render(NamespacePanel, { props: {} });
    await fireEvent.click(getByText("shop"));
    await fireEvent.click(getByText("users"));
    expect(sessionManager.activeZone).toEqual({ zone: "destination" });
    expect(sessionManager.active!.nav.page).toBe("collection");
  });

  it("the Overview row opens the host page", async () => {
    sessionManager.active!.nav.selectCollection("shop", "users");
    sessionManager.openQuery("x");
    const { getByRole } = render(NamespacePanel, { props: {} });
    await fireEvent.click(getByRole("button", { name: "Overview" }));
    expect(sessionManager.activeZone).toEqual({ zone: "destination" });
    expect(sessionManager.active!.nav.page).toBe("host");
  });

  it("the session header's switcher button opens the session manager", async () => {
    const onmanagesessions = vi.fn();
    const { getByRole } = render(NamespacePanel, { props: { onmanagesessions } });
    await fireEvent.click(getByRole("button", { name: "Session manager" }));
    expect(onmanagesessions).toHaveBeenCalled();
  });

  it("the session header shows the environment badge", async () => {
    await sessionManager.focusOrOpen({ connId: 5, uri: "mongodb://p", label: "prod", environment: "prod" });
    const { getByText } = render(NamespacePanel, { props: {} });
    expect(getByText("PROD")).toBeTruthy();
  });
});
