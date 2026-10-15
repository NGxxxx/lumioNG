// src/lib/components/MenuBar.test.ts
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/svelte";
import MenuBar from "./MenuBar.svelte";
import { appLocale } from "../stores/locale.svelte";
import { uiSize } from "../stores/uiSize.svelte";
import { theme } from "../stores/theme.svelte";
import { settings } from "../stores/settings.svelte";
import type { Command, CommandId } from "../domain/commands";

function cmd(disabled = false, run: () => void = vi.fn()): Command {
  return { disabled, run };
}

function baseCommands(overrides: Partial<Record<CommandId, Command>> = {}): Partial<Record<CommandId, Command>> {
  return {
    "file.sessionManager": cmd(),
    "file.refresh": cmd(true),
    "file.newQuery": cmd(true),
    "file.newDocument": cmd(true),
    "file.import": cmd(true),
    "file.export": cmd(true),
    "file.quit": cmd(),
    "query.run": cmd(true),
    "query.runSelection": cmd(true),
    "query.stop": cmd(true),
    "query.explain": cmd(true),
    "query.aggregate": cmd(true),
    "query.save": cmd(true),
    "goto.nextTab": cmd(true),
    "goto.prevTab": cmd(true),
    "view.resetToDefault": cmd(),
    "help.about": cmd(),
    ...overrides,
  };
}

const base = {
  commands: baseCommands(),
  goto: [],
};

describe("MenuBar", () => {
  it("File → Session manager calls its command's run", async () => {
    const run = vi.fn();
    const { getByText } = render(MenuBar, {
      props: { ...base, commands: baseCommands({ "file.sessionManager": cmd(false, run) }) },
    });
    await fireEvent.click(getByText("File"));
    await fireEvent.click(getByText("Session manager"));
    expect(run).toHaveBeenCalled();
  });

  it("File → Refresh calls its command's run when enabled", async () => {
    const run = vi.fn();
    const { getByText } = render(MenuBar, {
      props: { ...base, commands: baseCommands({ "file.refresh": cmd(false, run) }) },
    });
    await fireEvent.click(getByText("File"));
    await fireEvent.click(getByText("Refresh"));
    expect(run).toHaveBeenCalled();
  });

  it("File → Refresh is disabled when not connected", async () => {
    const { getByText } = render(MenuBar, { props: base });
    await fireEvent.click(getByText("File"));
    const item = getByText("Refresh").closest("button") as HTMLButtonElement;
    expect(item.disabled).toBe(true);
  });

  it("File → Refresh shows the F5 shortcut hint", async () => {
    const { getByText } = render(MenuBar, { props: base });
    await fireEvent.click(getByText("File"));
    expect(getByText("F5")).toBeTruthy();
  });

  it("View → Language submenu lists both locales with the active one checked", async () => {
    render(MenuBar, { props: base });
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
    render(MenuBar, { props: base });
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
    render(MenuBar, { props: base });
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
    render(MenuBar, { props: base });
    await fireEvent.click(screen.getByRole("button", { name: "View" }));
    await fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    const dark = screen.getByRole("button", { name: /Dark/ });
    expect(dark.textContent).toContain("✓"); // mocha (dark) active by default
    await fireEvent.click(screen.getByRole("button", { name: /Light/ }));
    try {
      expect(theme.current).toBe("latte");
    } finally {
      theme.set("mocha"); // restore shared store for later tests
    }
  });

  it("View → Density submenu lists three options with the active one checked, and switches", async () => {
    render(MenuBar, { props: base });
    await fireEvent.click(screen.getByRole("button", { name: "View" }));
    await fireEvent.click(screen.getByRole("button", { name: "Density" }));
    expect(screen.getByRole("button", { name: /Comfortable/ }).textContent).toContain("✓");
    await fireEvent.click(screen.getByRole("button", { name: /Compact/ }));
    try {
      expect(settings.density).toBe("compact");
    } finally {
      settings.setDensity("comfortable");
    }
  });

  it("View → Reset to default calls its command's run", async () => {
    const run = vi.fn();
    render(MenuBar, { props: { ...base, commands: baseCommands({ "view.resetToDefault": cmd(false, run) }) } });
    await fireEvent.click(screen.getByRole("button", { name: "View" }));
    await fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(run).toHaveBeenCalled();
  });

  it("File → New document is disabled when its command is disabled, enabled and wired when not", async () => {
    const run = vi.fn();
    const { rerender, getByText } = render(MenuBar, {
      props: { ...base, commands: baseCommands({ "file.newDocument": cmd(true, run) }) },
    });
    await fireEvent.click(getByText("File"));
    expect((getByText("New document").closest("button") as HTMLButtonElement).disabled).toBe(true);

    await rerender({ ...base, commands: baseCommands({ "file.newDocument": cmd(false, run) }) });
    await fireEvent.click(getByText("New document"));
    expect(run).toHaveBeenCalled();
  });

  it("Query → Run calls its command's run only when enabled", async () => {
    const run = vi.fn();
    const { getByText } = render(MenuBar, {
      props: { ...base, commands: baseCommands({ "query.run": cmd(false, run) }) },
    });
    await fireEvent.click(getByText("Query"));
    await fireEvent.click(getByText("Run query"));
    expect(run).toHaveBeenCalled();
  });

  it("Query → Run shows the F9 shortcut hint", async () => {
    const { getByText } = render(MenuBar, { props: base });
    await fireEvent.click(getByText("Query"));
    expect(getByText("F9")).toBeTruthy();
  });

  it("Go to lists the destination items, marks the active one, and runs the chosen one", async () => {
    const runDb = vi.fn();
    const { getByText, getByRole } = render(MenuBar, {
      props: {
        ...base,
        goto: [
          { label: "Host", checked: true, shortcut: "Ctrl+1", run: vi.fn() },
          { label: "Database", checked: false, run: runDb },
          { label: "Indexes", checked: false, disabled: true, run: vi.fn() },
        ],
      },
    });
    await fireEvent.click(getByText("Go to"));
    expect(getByRole("button", { name: /Host/ }).textContent).toContain("✓");
    expect(getByRole("button", { name: /Host/ }).textContent).toContain("Ctrl+1");
    expect((getByRole("button", { name: /Indexes/ }) as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(getByText("Database"));
    expect(runDb).toHaveBeenCalled();
  });

  it("Go to is disabled when there are no destination items and no tabs to cycle", async () => {
    const { getByText } = render(MenuBar, { props: base });
    const item = getByText("Go to") as HTMLButtonElement;
    expect(item.disabled).toBe(true);
  });

  it("Help → Keyboard shortcuts runs its command and shows the ? hint", async () => {
    const run = vi.fn();
    render(MenuBar, { props: { ...base, commands: baseCommands({ "help.shortcuts": cmd(false, run) }) } });
    await fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const item = screen.getByRole("button", { name: /Keyboard shortcuts/ });
    expect(item.textContent).toContain("?");
    await fireEvent.click(item);
    expect(run).toHaveBeenCalled();
  });

  it("Help → About calls its command's run", async () => {
    const run = vi.fn();
    const { getByText } = render(MenuBar, { props: { ...base, commands: baseCommands({ "help.about": cmd(false, run) }) } });
    await fireEvent.click(getByText("Help"));
    await fireEvent.click(getByText("About"));
    expect(run).toHaveBeenCalled();
  });
});
