// src/lib/components/Toolbar.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import Toolbar from "./Toolbar.svelte";
import { settings } from "../stores/settings.svelte";
import type { Command, CommandId } from "../domain/commands";

function cmd(disabled = false, run: () => void = vi.fn()): Command {
  return { disabled, run };
}

function baseCommands(overrides: Partial<Record<CommandId, Command>> = {}): Partial<Record<CommandId, Command>> {
  return {
    "file.sessionManager": cmd(),
    "file.refresh": cmd(true),
    "file.newDocument": cmd(true),
    "file.export": cmd(true),
    "file.import": cmd(true),
    "query.run": cmd(true),
    "query.runSelection": cmd(true),
    "query.stop": cmd(true),
    "query.explain": cmd(true),
    "query.aggregate": cmd(true),
    "query.save": cmd(true),
    ...overrides,
  };
}

const base = { commands: baseCommands(), canNewDoc: true, onToggleLog: vi.fn() };

describe("Toolbar", () => {
  it("Session manager is always enabled and calls its command's run", async () => {
    const run = vi.fn();
    const { getByLabelText } = render(Toolbar, {
      props: { ...base, commands: baseCommands({ "file.sessionManager": cmd(false, run) }) },
    });
    const btn = getByLabelText("Session manager") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await fireEvent.click(btn);
    expect(run).toHaveBeenCalled();
  });

  it("Refresh is disabled when its command is disabled", () => {
    const { getByLabelText } = render(Toolbar, { props: base });
    expect((getByLabelText("Refresh") as HTMLButtonElement).disabled).toBe(true);
  });

  it("New document is disabled when no collection is active", () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base, canNewDoc: false } });
    expect((getByLabelText("New document") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Run query (contextual button) is disabled in default state", () => {
    const { getByLabelText } = render(Toolbar, { props: base });
    expect((getByLabelText("Run query") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Command log is always enabled and calls onToggleLog", async () => {
    const onToggleLog = vi.fn();
    const { getByLabelText } = render(Toolbar, { props: { ...base, onToggleLog } });
    const btn = getByLabelText("Command log") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await fireEvent.click(btn);
    expect(onToggleLog).toHaveBeenCalled();
  });
});

describe("Toolbar Wrap toggle", () => {
  beforeEach(() => settings.setWrapLongLines(false));

  it("is always enabled and toggles settings.wrapLongLines on each click", async () => {
    const { getByLabelText } = render(Toolbar, { props: base });
    const btn = getByLabelText("Wrap") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(settings.wrapLongLines).toBe(false);
    await fireEvent.click(btn);
    expect(settings.wrapLongLines).toBe(true);
    await fireEvent.click(btn);
    expect(settings.wrapLongLines).toBe(false);
  });
});

describe("Toolbar Run query", () => {
  it("is disabled when its command is disabled", () => {
    const { getByLabelText } = render(Toolbar, { props: base });
    expect((getByLabelText("Run query") as HTMLButtonElement).disabled).toBe(true);
  });
  it("calls its command's run when enabled and clicked", async () => {
    const run = vi.fn();
    const { getByLabelText } = render(Toolbar, {
      props: { ...base, commands: baseCommands({ "query.run": cmd(false, run) }) },
    });
    await fireEvent.click(getByLabelText("Run query"));
    expect(run).toHaveBeenCalled();
  });
  it("shows the F9 shortcut in its tooltip", () => {
    // The `tooltip` action (src/lib/actions/tooltip.ts) renders a floating .app-tooltip div into
    // document.body after a 300ms hover delay — it does not set any DOM attribute directly on the
    // button, so the tooltip's actual text has to be read after simulating that hover.
    vi.useFakeTimers();
    try {
      const { getByLabelText } = render(Toolbar, { props: base });
      const wrapper = getByLabelText("Run query").closest(".tt") as HTMLElement;
      wrapper.dispatchEvent(new PointerEvent("pointerenter"));
      vi.advanceTimersByTime(300);
      expect(document.body.querySelector(".app-tooltip")?.textContent).toContain("F9");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Toolbar Save", () => {
  it("is disabled when its command is disabled (default)", () => {
    const { getByLabelText } = render(Toolbar, { props: base });
    expect((getByLabelText("Save") as HTMLButtonElement).disabled).toBe(true);
  });
  it("calls its command's run when enabled and clicked", async () => {
    const run = vi.fn();
    const { getByLabelText } = render(Toolbar, {
      props: { ...base, commands: baseCommands({ "query.save": cmd(false, run) }) },
    });
    await fireEvent.click(getByLabelText("Save"));
    expect(run).toHaveBeenCalled();
  });
});

describe("Toolbar Delete document", () => {
  it("is disabled when canDeleteDoc is false (default)", () => {
    const { getByLabelText } = render(Toolbar, { props: base });
    expect((getByLabelText("Delete document") as HTMLButtonElement).disabled).toBe(true);
  });
  it("calls ondeletedocument when enabled and clicked", async () => {
    const ondeletedocument = vi.fn();
    const { getByLabelText } = render(Toolbar, {
      props: { ...base, canDeleteDoc: true, ondeletedocument },
    });
    await fireEvent.click(getByLabelText("Delete document"));
    expect(ondeletedocument).toHaveBeenCalled();
  });
  it("shows the Del shortcut in its tooltip", () => {
    vi.useFakeTimers();
    try {
      const { getByLabelText } = render(Toolbar, { props: base });
      const wrapper = getByLabelText("Delete document").closest(".tt") as HTMLElement;
      wrapper.dispatchEvent(new PointerEvent("pointerenter"));
      vi.advanceTimersByTime(300);
      expect(document.body.querySelector(".app-tooltip")?.textContent).toContain("Del");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Toolbar Edit document", () => {
  it("is disabled when canEditDoc is false (default)", () => {
    const { getByLabelText } = render(Toolbar, { props: base });
    expect((getByLabelText("Edit document") as HTMLButtonElement).disabled).toBe(true);
  });
  it("calls oneditdocument when enabled and clicked", async () => {
    const oneditdocument = vi.fn();
    const { getByLabelText } = render(Toolbar, {
      props: { ...base, canEditDoc: true, oneditdocument },
    });
    await fireEvent.click(getByLabelText("Edit document"));
    expect(oneditdocument).toHaveBeenCalled();
  });
  it("shows the F2 shortcut in its tooltip", () => {
    vi.useFakeTimers();
    try {
      const { getByLabelText } = render(Toolbar, { props: base });
      const wrapper = getByLabelText("Edit document").closest(".tt") as HTMLElement;
      wrapper.dispatchEvent(new PointerEvent("pointerenter"));
      vi.advanceTimersByTime(300);
      expect(document.body.querySelector(".app-tooltip")?.textContent).toContain("F2");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Toolbar Stop", () => {
  it("is disabled when its command is disabled (default)", () => {
    const { getByLabelText } = render(Toolbar, { props: base });
    expect((getByLabelText("Stop") as HTMLButtonElement).disabled).toBe(true);
  });
  it("calls its command's run when enabled and clicked", async () => {
    const run = vi.fn();
    const { getByLabelText } = render(Toolbar, {
      props: { ...base, commands: baseCommands({ "query.stop": cmd(false, run) }) },
    });
    await fireEvent.click(getByLabelText("Stop"));
    expect(run).toHaveBeenCalled();
  });
  it("shows the Esc shortcut in its tooltip", () => {
    vi.useFakeTimers();
    try {
      const { getByLabelText } = render(Toolbar, { props: base });
      const wrapper = getByLabelText("Stop").closest(".tt") as HTMLElement;
      wrapper.dispatchEvent(new PointerEvent("pointerenter"));
      vi.advanceTimersByTime(300);
      expect(document.body.querySelector(".app-tooltip")?.textContent).toContain("Esc");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Toolbar Find", () => {
  it("is disabled when canFind is false (default)", () => {
    const { getByLabelText } = render(Toolbar, { props: base });
    expect((getByLabelText("Find") as HTMLButtonElement).disabled).toBe(true);
  });
  it("calls onfind when enabled and clicked", async () => {
    const onfind = vi.fn();
    const { getByLabelText } = render(Toolbar, { props: { ...base, canFind: true, onfind } });
    await fireEvent.click(getByLabelText("Find"));
    expect(onfind).toHaveBeenCalled();
  });
  it("shows the Ctrl+F shortcut in its tooltip", () => {
    vi.useFakeTimers();
    try {
      const { getByLabelText } = render(Toolbar, { props: base });
      const wrapper = getByLabelText("Find").closest(".tt") as HTMLElement;
      wrapper.dispatchEvent(new PointerEvent("pointerenter"));
      vi.advanceTimersByTime(300);
      expect(document.body.querySelector(".app-tooltip")?.textContent).toContain("Ctrl+F");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Toolbar Aggregate", () => {
  it("is disabled when its command is disabled (default)", () => {
    const { getByLabelText } = render(Toolbar, { props: base });
    expect((getByLabelText("Aggregate") as HTMLButtonElement).disabled).toBe(true);
  });
  it("calls its command's run when enabled and clicked", async () => {
    const run = vi.fn();
    const { getByLabelText } = render(Toolbar, {
      props: { ...base, commands: baseCommands({ "query.aggregate": cmd(false, run) }) },
    });
    await fireEvent.click(getByLabelText("Aggregate"));
    expect(run).toHaveBeenCalled();
  });
});

describe("Toolbar Explain", () => {
  it("is disabled when its command is disabled (default)", () => {
    const { getByLabelText } = render(Toolbar, { props: base });
    expect((getByLabelText("Explain") as HTMLButtonElement).disabled).toBe(true);
  });
  it("calls its command's run when enabled and clicked", async () => {
    const run = vi.fn();
    const { getByLabelText } = render(Toolbar, {
      props: { ...base, commands: baseCommands({ "query.explain": cmd(false, run) }) },
    });
    await fireEvent.click(getByLabelText("Explain"));
    expect(run).toHaveBeenCalled();
  });
});
