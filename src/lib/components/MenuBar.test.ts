// src/lib/components/MenuBar.test.ts
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/svelte";
import MenuBar from "./MenuBar.svelte";
import { appLocale } from "../stores/locale.svelte";
import { uiSize } from "../stores/uiSize.svelte";
import { theme } from "../stores/theme.svelte";

const base = {
  connected: true,
  onsession: vi.fn(),
  onrefresh: vi.fn(),
  onquit: vi.fn(),
  onresetdefault: vi.fn(),
  onnewquery: vi.fn(),
  canNewDoc: false,
  onnewdocument: vi.fn(),
  canImport: false,
  onimport: vi.fn(),
  canExport: false,
  onexport: vi.fn(),
  canRun: false,
  onrun: vi.fn(),
  canRunSelection: false,
  onrunselection: vi.fn(),
  canStop: false,
  onstop: vi.fn(),
  canExplainQuery: false,
  onexplainquery: vi.fn(),
  canAggregate: false,
  onaggregate: vi.fn(),
  canSaveQuery: false,
  onsavequery: vi.fn(),
  contextTabs: [],
  activeContextKind: null,
  onshowcontext: vi.fn(),
  canNextTab: false,
  onnexttab: vi.fn(),
  canPrevTab: false,
  onprevtab: vi.fn(),
};

describe("MenuBar", () => {
  it("File → Session manager calls onsession", async () => {
    const onsession = vi.fn();
    const { getByText } = render(MenuBar, { props: { ...base, onsession } });
    await fireEvent.click(getByText("File"));
    await fireEvent.click(getByText("Session manager"));
    expect(onsession).toHaveBeenCalled();
  });

  it("File → Refresh calls onrefresh when connected", async () => {
    const onrefresh = vi.fn();
    const { getByText } = render(MenuBar, { props: { ...base, connected: true, onrefresh } });
    await fireEvent.click(getByText("File"));
    await fireEvent.click(getByText("Refresh"));
    expect(onrefresh).toHaveBeenCalled();
  });

  it("File → Refresh is disabled when not connected", async () => {
    const onrefresh = vi.fn();
    const { getByText } = render(MenuBar, { props: { ...base, connected: false, onrefresh } });
    await fireEvent.click(getByText("File"));
    const item = getByText("Refresh") as HTMLButtonElement;
    expect(item.disabled).toBe(true);
  });

  it("View → Language submenu lists both locales with the active one checked", async () => {
    render(MenuBar, { props: { ...base } });
    await fireEvent.click(screen.getByRole("button", { name: "View" }));
    // Locales are nested under a Language submenu, hidden until it is opened.
    expect(screen.queryByRole("button", { name: /English/ })).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Language" }));
    const en = screen.getByRole("button", { name: /English/ });
    expect(en).toBeInTheDocument();
    expect(en.textContent).toContain("✓"); // active locale is checked
    expect(screen.getByRole("button", { name: /Tiếng Việt/ })).toBeInTheDocument();
  });

  it("switching locale applies immediately, with no reload prompt", async () => {
    render(MenuBar, { props: { ...base } });
    await fireEvent.click(screen.getByRole("button", { name: "View" }));
    await fireEvent.click(screen.getByRole("button", { name: "Language" }));
    await fireEvent.click(screen.getByRole("button", { name: "Tiếng Việt" }));
    try {
      expect(appLocale.current).toBe("vi"); // switched live
      expect(screen.queryByRole("button", { name: "Reload now" })).toBeNull(); // no confirm/reload
    } finally {
      appLocale.set("en"); // restore the shared locale for any later tests
    }
  });

  it("View → UI size submenu lists presets with the active one checked, and switches", async () => {
    render(MenuBar, { props: { ...base } });
    await fireEvent.click(screen.getByRole("button", { name: "View" }));
    await fireEvent.click(screen.getByRole("button", { name: "UI size" }));
    const def = screen.getByRole("button", { name: /Default/ });
    expect(def.textContent).toContain("✓"); // default active
    await fireEvent.click(screen.getByRole("button", { name: /Large$/ }));
    try {
      expect(uiSize.current).toBe("large");
    } finally {
      uiSize.set("default"); // restore shared store for later tests
    }
  });

  it("View → Theme submenu lists Light/Dark with the active one checked, and switches", async () => {
    render(MenuBar, { props: { ...base } });
    await fireEvent.click(screen.getByRole("button", { name: "View" }));
    await fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    const light = screen.getByRole("button", { name: /Light/ });
    expect(light.textContent).toContain("✓"); // latte active by default
    await fireEvent.click(screen.getByRole("button", { name: /Dark/ }));
    try {
      expect(theme.current).toBe("mocha");
    } finally {
      theme.set("latte"); // restore shared store for later tests
    }
  });

  it("View → Reset to default calls onresetdefault", async () => {
    const onresetdefault = vi.fn();
    render(MenuBar, { props: { ...base, onresetdefault } });
    await fireEvent.click(screen.getByRole("button", { name: "View" }));
    await fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(onresetdefault).toHaveBeenCalled();
  });

  it("File → New document is disabled when canNewDoc is false, enabled and wired when true", async () => {
    const onnewdocument = vi.fn();
    const { rerender, getByText } = render(MenuBar, { props: { ...base, canNewDoc: false, onnewdocument } });
    await fireEvent.click(getByText("File"));
    expect((getByText("New document") as HTMLButtonElement).disabled).toBe(true);

    await rerender({ ...base, canNewDoc: true, onnewdocument });
    await fireEvent.click(getByText("New document"));
    expect(onnewdocument).toHaveBeenCalled();
  });

  it("Query → Run calls onrun only when canRun", async () => {
    const onrun = vi.fn();
    const { getByText } = render(MenuBar, { props: { ...base, canRun: true, onrun } });
    await fireEvent.click(getByText("Query"));
    await fireEvent.click(getByText("Run query"));
    expect(onrun).toHaveBeenCalled();
  });

  it("Go to lists context tabs and marks the active one checked", async () => {
    const onshowcontext = vi.fn();
    const { getByText, getByRole } = render(MenuBar, {
      props: {
        ...base,
        contextTabs: [
          { kind: "host", label: "Host" },
          { kind: "database", label: "Database" },
        ],
        activeContextKind: "host",
        onshowcontext,
      },
    });
    await fireEvent.click(getByText("Go to"));
    const hostItem = getByRole("button", { name: /Host/ });
    expect(hostItem.textContent).toContain("✓");
    await fireEvent.click(getByText("Database"));
    expect(onshowcontext).toHaveBeenCalledWith("database");
  });

  it("Go to is disabled when there are no context tabs and no tabs to cycle", async () => {
    const { getByText } = render(MenuBar, { props: { ...base } });
    const item = getByText("Go to") as HTMLButtonElement;
    expect(item.disabled).toBe(true);
  });

  it("Help → About opens the About dialog", async () => {
    const { getByText, getByRole } = render(MenuBar, { props: { ...base } });
    await fireEvent.click(getByText("Help"));
    await fireEvent.click(getByText("About"));
    expect(getByRole("dialog", { name: "About" })).toBeInTheDocument();
  });
});
