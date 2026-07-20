import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/svelte";
import CodeEditor from "./CodeEditor.svelte";

// CodeMirror measures ranges; jsdom doesn't implement these. Stub them so EditorView mounts.
beforeAll(() => {
  const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} };
  (Range.prototype as unknown as { getClientRects: () => unknown }).getClientRects = () => ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  });
  (Range.prototype as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => rect;
});

describe("CodeEditor", () => {
  it("mounts and renders the initial value", () => {
    const { container } = render(CodeEditor, {
      props: { value: 'db.x.aggregate([])', onChange: vi.fn() },
    });
    expect(container.querySelector(".cm-editor")).toBeTruthy();
    expect(container.textContent).toContain("aggregate");
  });

  it("destroys cleanly on unmount", () => {
    const { container, unmount } = render(CodeEditor, { props: { value: "a", onChange: vi.fn() } });
    expect(() => unmount()).not.toThrow();
    expect(container.querySelector(".cm-editor")).toBeFalsy();
  });

  it("format() pretty-prints a one-liner query into multiple readable lines", async () => {
    const onChange = vi.fn();
    const { container, component } = render(CodeEditor, {
      props: { value: 'db.users.find({name:"John",age:{$gt:18}})', onChange },
    });
    await component.format();
    const lines = Array.from(container.querySelectorAll(".cm-line")).map((l) => l.textContent);
    expect(lines.length).toBeGreaterThan(1);
    expect(onChange).toHaveBeenCalled();
  });

  it("format() reindents already-multiline code without altering its structure", async () => {
    const badlyIndented = "function f() {\nconsole.log(1);\n  if (true) {\nconsole.log(2);\n}\n}";
    const { container, component } = render(CodeEditor, {
      props: { value: badlyIndented, onChange: vi.fn() },
    });
    await component.format();
    const lines = Array.from(container.querySelectorAll(".cm-line")).map((l) => l.textContent);
    expect(lines).toEqual([
      "function f() {",
      "  console.log(1);",
      "  if (true) {",
      "    console.log(2);",
      "  }",
      "}",
    ]);
  });
});

describe("CodeEditor keyboard shortcuts", () => {
  function pressKey(container: HTMLElement, key: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean }> = {}) {
    const content = container.querySelector(".cm-content") as HTMLElement;
    content.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }));
  }

  it("F9 calls onRun", () => {
    const onRun = vi.fn();
    const { container } = render(CodeEditor, { props: { value: "a", onChange: vi.fn(), onRun } });
    pressKey(container, "F9");
    expect(onRun).toHaveBeenCalled();
  });

  it("Mod-Enter no longer runs (replaced by F9)", () => {
    const onRun = vi.fn();
    const { container } = render(CodeEditor, { props: { value: "a", onChange: vi.fn(), onRun } });
    pressKey(container, "Enter", { ctrlKey: true });
    expect(onRun).not.toHaveBeenCalled();
  });

  it("Ctrl+F9 calls onRunSelection", () => {
    const onRunSelection = vi.fn();
    const { container } = render(CodeEditor, { props: { value: "a", onChange: vi.fn(), onRunSelection } });
    pressKey(container, "F9", { ctrlKey: true });
    expect(onRunSelection).toHaveBeenCalled();
  });

  it("Ctrl+Shift+F9 calls onExplain", () => {
    const onExplain = vi.fn();
    const { container } = render(CodeEditor, { props: { value: "a", onChange: vi.fn(), onExplain } });
    pressKey(container, "F9", { ctrlKey: true, shiftKey: true });
    expect(onExplain).toHaveBeenCalled();
  });

  it("Ctrl+F8 reformats the document, same as calling format() directly", async () => {
    const { container } = render(CodeEditor, {
      props: { value: 'db.users.find({name:"John",age:{$gt:18}})', onChange: vi.fn() },
    });
    pressKey(container, "F8", { ctrlKey: true });
    await vi.waitFor(() => {
      const lines = Array.from(container.querySelectorAll(".cm-line")).map((l) => l.textContent);
      expect(lines.length).toBeGreaterThan(1);
    });
  });

  it("Ctrl+W clears the document, same as calling clear() directly", () => {
    const { container } = render(CodeEditor, { props: { value: "db.x.find({})", onChange: vi.fn() } });
    pressKey(container, "w", { ctrlKey: true });
    expect(container.querySelector(".cm-content")?.textContent).toBe("");
  });

  it("Ctrl+/ toggles a line comment", () => {
    const onChange = vi.fn();
    const { container } = render(CodeEditor, { props: { value: "db.x.find({})", onChange } });
    pressKey(container, "/", { ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining("//"));
  });

  it("Ctrl+F opens the search panel", () => {
    const { container } = render(CodeEditor, { props: { value: "db.x.find({})", onChange: vi.fn() } });
    pressKey(container, "f", { ctrlKey: true });
    expect(container.querySelector(".cm-search")).toBeTruthy();
  });

  it("Ctrl+R also opens the search/replace panel", () => {
    const { container } = render(CodeEditor, { props: { value: "db.x.find({})", onChange: vi.fn() } });
    pressKey(container, "r", { ctrlKey: true });
    expect(container.querySelector(".cm-search")).toBeTruthy();
  });

  it("F3 opens the search panel and jumps to the first match (no crash with no prior query)", () => {
    const { container } = render(CodeEditor, { props: { value: "db.x.find({})", onChange: vi.fn() } });
    expect(() => pressKey(container, "F3")).not.toThrow();
    expect(container.querySelector(".cm-search")).toBeTruthy();
  });
});
