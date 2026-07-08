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

  it("format() pretty-prints a one-liner query into multiple readable lines", () => {
    const onChange = vi.fn();
    const { container, component } = render(CodeEditor, {
      props: { value: 'db.users.find({name:"John",age:{$gt:18}})', onChange },
    });
    component.format();
    const lines = Array.from(container.querySelectorAll(".cm-line")).map((l) => l.textContent);
    expect(lines.length).toBeGreaterThan(1);
    expect(onChange).toHaveBeenCalled();
  });

  it("format() reindents already-multiline code without altering its structure", () => {
    const badlyIndented = "function f() {\nconsole.log(1);\n  if (true) {\nconsole.log(2);\n}\n}";
    const { container, component } = render(CodeEditor, {
      props: { value: badlyIndented, onChange: vi.fn() },
    });
    component.format();
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
