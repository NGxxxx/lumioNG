// src/lib/components/Toolbar.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import Toolbar from "./Toolbar.svelte";
import { settings } from "../stores/settings.svelte";

const base = { connected: true, canNewDoc: true, onsession: vi.fn(), onrefresh: vi.fn(), onnewdocument: vi.fn(), onToggleLog: vi.fn() };

describe("Toolbar", () => {
  it("Session manager is always enabled and calls onsession", async () => {
    const onsession = vi.fn();
    const { getByLabelText } = render(Toolbar, { props: { ...base, connected: false, onsession } });
    const btn = getByLabelText("Session manager") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await fireEvent.click(btn);
    expect(onsession).toHaveBeenCalled();
  });

  it("Refresh is disabled when not connected", () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base, connected: false } });
    expect((getByLabelText("Refresh") as HTMLButtonElement).disabled).toBe(true);
  });

  it("New document is disabled when no collection is active", () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base, canNewDoc: false } });
    expect((getByLabelText("New document") as HTMLButtonElement).disabled).toBe(true);
  });

  it("contextual button (Run query) is disabled in default state", () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base } });
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
    const { getByLabelText } = render(Toolbar, { props: { ...base } });
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
  it("is disabled when canRun is false", () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base, canRun: false, onrun: vi.fn() } });
    expect((getByLabelText("Run query") as HTMLButtonElement).disabled).toBe(true);
  });
  it("calls onrun when enabled and clicked", async () => {
    const onrun = vi.fn();
    const { getByLabelText } = render(Toolbar, { props: { ...base, canRun: true, onrun } });
    await fireEvent.click(getByLabelText("Run query"));
    expect(onrun).toHaveBeenCalled();
  });
});

describe("Toolbar Save", () => {
  it("is disabled when canSave is false (default)", () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base } });
    expect((getByLabelText("Save") as HTMLButtonElement).disabled).toBe(true);
  });
  it("calls onsave when enabled and clicked", async () => {
    const onsave = vi.fn();
    const { getByLabelText } = render(Toolbar, { props: { ...base, canSave: true, onsave } });
    await fireEvent.click(getByLabelText("Save"));
    expect(onsave).toHaveBeenCalled();
  });
});

describe("Toolbar Delete document", () => {
  it("is disabled when canDeleteDoc is false (default)", () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base } });
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
});

describe("Toolbar Stop", () => {
  it("is disabled when canStop is false (default)", () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base } });
    expect((getByLabelText("Stop") as HTMLButtonElement).disabled).toBe(true);
  });
  it("calls onstop when enabled and clicked", async () => {
    const onstop = vi.fn();
    const { getByLabelText } = render(Toolbar, { props: { ...base, canStop: true, onstop } });
    await fireEvent.click(getByLabelText("Stop"));
    expect(onstop).toHaveBeenCalled();
  });
});

describe("Toolbar Find", () => {
  it("is disabled when canFind is false (default)", () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base } });
    expect((getByLabelText("Find") as HTMLButtonElement).disabled).toBe(true);
  });
  it("calls onfind when enabled and clicked", async () => {
    const onfind = vi.fn();
    const { getByLabelText } = render(Toolbar, { props: { ...base, canFind: true, onfind } });
    await fireEvent.click(getByLabelText("Find"));
    expect(onfind).toHaveBeenCalled();
  });
});

describe("Toolbar Aggregate", () => {
  it("is disabled when canAggregate is false (default)", () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base } });
    expect((getByLabelText("Aggregate") as HTMLButtonElement).disabled).toBe(true);
  });
  it("calls onaggregate when enabled and clicked", async () => {
    const onaggregate = vi.fn();
    const { getByLabelText } = render(Toolbar, {
      props: { ...base, canAggregate: true, onaggregate },
    });
    await fireEvent.click(getByLabelText("Aggregate"));
    expect(onaggregate).toHaveBeenCalled();
  });
});

describe("Toolbar Indexes", () => {
  it("is disabled when canIndexes is false (default)", () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base } });
    expect((getByLabelText("Indexes") as HTMLButtonElement).disabled).toBe(true);
  });
  it("calls onindexes when enabled and clicked", async () => {
    const onindexes = vi.fn();
    const { getByLabelText } = render(Toolbar, {
      props: { ...base, canIndexes: true, onindexes },
    });
    await fireEvent.click(getByLabelText("Indexes"));
    expect(onindexes).toHaveBeenCalled();
  });
});

describe("Toolbar Explain", () => {
  it("is disabled when canExplainQuery is false (default)", () => {
    const { getByLabelText } = render(Toolbar, { props: { ...base } });
    expect((getByLabelText("Explain") as HTMLButtonElement).disabled).toBe(true);
  });
  it("calls onexplainquery when enabled and clicked", async () => {
    const onexplainquery = vi.fn();
    const { getByLabelText } = render(Toolbar, {
      props: { ...base, canExplainQuery: true, onexplainquery },
    });
    await fireEvent.click(getByLabelText("Explain"));
    expect(onexplainquery).toHaveBeenCalled();
  });
});
