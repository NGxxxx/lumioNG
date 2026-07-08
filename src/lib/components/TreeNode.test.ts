import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import TreeNode from "./TreeNode.svelte";
import { settings } from "../stores/settings.svelte";

const noop = () => {};

describe("TreeNode leaf", () => {
  it("editing a valid string → onchange with new value, no error", async () => {
    const onchange = vi.fn();
    const onerror = vi.fn();
    const { container } = render(TreeNode, {
      props: { label: "name", value: "a", path: "name", onchange, onremove: noop, onerror },
    });
    const input = container.querySelector("input.leaf")!;
    await fireEvent.input(input, { target: { value: "b" } });
    expect(onchange).toHaveBeenCalledWith("b");
    expect(onerror).toHaveBeenLastCalledWith("name", false);
  });

  it("invalid int → onerror(path,true), NO onchange, shows error", async () => {
    const onchange = vi.fn();
    const onerror = vi.fn();
    const { container, getByText } = render(TreeNode, {
      props: { label: "n", value: { $numberInt: "2" }, path: "n", onchange, onremove: noop, onerror },
    });
    const input = container.querySelector("input.leaf")!;
    await fireEvent.input(input, { target: { value: "abc" } });
    expect(onchange).not.toHaveBeenCalled();
    expect(onerror).toHaveBeenLastCalledWith("n", true);
    expect(getByText(/32-bit/)).toBeTruthy();
  });

  it("valid int → onchange with {$numberInt}", async () => {
    const onchange = vi.fn();
    const { container } = render(TreeNode, {
      props: { label: "n", value: { $numberInt: "2" }, path: "n", onchange, onremove: noop, onerror: noop },
    });
    const input = container.querySelector("input.leaf")!;
    await fireEvent.input(input, { target: { value: "5" } });
    expect(onchange).toHaveBeenCalledWith({ $numberInt: "5" });
  });

  it("locked key (_id) → no input field, shows 🔒", () => {
    const { container, getByText } = render(TreeNode, {
      props: {
        label: "_id",
        value: { $oid: "507f1f77bcf86cd799439011" },
        path: "_id",
        locked: true,
        removable: false,
        onchange: noop,
        onremove: noop,
        onerror: noop,
      },
    });
    expect(container.querySelector("input.leaf")).toBeNull();
    expect(getByText("🔒")).toBeTruthy();
  });
});

describe("TreeNode wrap mode (app-wide Wrap toggle)", () => {
  beforeEach(() => settings.setWrapLongLines(false));

  const longValue = "x".repeat(110); // over the 100-char threshold
  const shortValue = "English"; // well under it

  it("a long string leaf renders a wrapping textarea instead of an input when wrap is on", () => {
    settings.setWrapLongLines(true);
    const { container } = render(TreeNode, {
      props: { label: "bio", value: longValue, path: "bio", onchange: noop, onremove: noop, onerror: noop },
    });
    expect(container.querySelector("input.leaf")).toBeNull();
    expect(container.querySelector("textarea.leaf")).toBeTruthy();
  });

  it("a short string leaf stays a plain input even when wrap is on (textarea would look odd)", () => {
    settings.setWrapLongLines(true);
    const { container } = render(TreeNode, {
      props: { label: "language", value: shortValue, path: "language", onchange: noop, onremove: noop, onerror: noop },
    });
    expect(container.querySelector("textarea.leaf")).toBeNull();
    expect(container.querySelector("input.leaf")).toBeTruthy();
  });

  it("a long string leaf stays a plain input when wrap is off", () => {
    const { container } = render(TreeNode, {
      props: { label: "bio", value: longValue, path: "bio", onchange: noop, onremove: noop, onerror: noop },
    });
    expect(container.querySelector("textarea.leaf")).toBeNull();
    expect(container.querySelector("input.leaf")).toBeTruthy();
  });

  it("editing via the wrapping textarea still calls onchange with the new value", async () => {
    settings.setWrapLongLines(true);
    const onchange = vi.fn();
    const { container } = render(TreeNode, {
      props: { label: "bio", value: longValue, path: "bio", onchange, onremove: noop, onerror: noop },
    });
    const textarea = container.querySelector("textarea.leaf")!;
    await fireEvent.input(textarea, { target: { value: "b" } });
    expect(onchange).toHaveBeenCalledWith("b");
  });

  it("non-string leaves (numbers) keep the plain input even when wrap is on", () => {
    settings.setWrapLongLines(true);
    const { container } = render(TreeNode, {
      props: { label: "n", value: { $numberInt: "2" }, path: "n", onchange: noop, onremove: noop, onerror: noop },
    });
    expect(container.querySelector("textarea.leaf")).toBeNull();
    expect(container.querySelector("input.leaf")).toBeTruthy();
  });
});

describe("TreeNode object", () => {
  // Use root:true (as TreeEditor renders) so the object node itself has no Remove button or own header,
  // avoiding index mismatches when querying getAllByLabelText.
  it("adding a new field → onchange with key and empty default value", async () => {
    const onchange = vi.fn();
    const { container, getByText } = render(TreeNode, {
      props: { root: true, label: "", value: { a: "x" }, path: "", removable: false, onchange, onremove: noop, onerror: noop },
    });
    const nameInput = container.querySelector("input.name")!;
    await fireEvent.input(nameInput, { target: { value: "newf" } });
    await fireEvent.click(getByText("+ Add field"));
    expect(onchange).toHaveBeenCalledWith({ a: "x", newf: "" });
  });

  it("duplicate field name → shows error, NO onchange", async () => {
    const onchange = vi.fn();
    const { container, getByText } = render(TreeNode, {
      props: { root: true, label: "", value: { a: "x" }, path: "", removable: false, onchange, onremove: noop, onerror: noop },
    });
    const nameInput = container.querySelector("input.name")!;
    await fireEvent.input(nameInput, { target: { value: "a" } });
    await fireEvent.click(getByText("+ Add field"));
    expect(onchange).not.toHaveBeenCalled();
    expect(getByText(/already exists/i)).toBeTruthy();
  });

  it("removing a child field → onchange with object without that key", async () => {
    const onchange = vi.fn();
    const { getAllByLabelText } = render(TreeNode, {
      props: { root: true, label: "", value: { a: "x", b: "y" }, path: "", removable: false, onchange, onremove: noop, onerror: noop },
    });
    // root has no own Remove button → first ✕ belongs to field "a"
    await fireEvent.click(getAllByLabelText("Remove")[0]);
    expect(onchange).toHaveBeenCalledWith({ b: "y" });
  });
});

describe("TreeNode array", () => {
  it("adding an item → onchange with array containing new empty element", async () => {
    const onchange = vi.fn();
    const { getByText } = render(TreeNode, {
      props: { label: "arr", value: ["x"], path: "arr", removable: false, onchange, onremove: noop, onerror: noop },
    });
    await fireEvent.click(getByText("+ Add item"));
    expect(onchange).toHaveBeenCalledWith(["x", ""]);
  });

  it("removing element [0] → onchange with spliced array", async () => {
    const onchange = vi.fn();
    const { getAllByLabelText } = render(TreeNode, {
      props: { label: "arr", value: ["x", "y"], path: "arr", removable: false, onchange, onremove: noop, onerror: noop },
    });
    // array node removable:false → no own Remove button; first ✕ belongs to element [0]
    await fireEvent.click(getAllByLabelText("Remove")[0]);
    expect(onchange).toHaveBeenCalledWith(["y"]);
  });
});

describe("TreeNode unmount", () => {
  it("leaf with active error unmounted → clears error flag (onerror path,false)", async () => {
    const onerror = vi.fn();
    const { container, unmount } = render(TreeNode, {
      props: { label: "n", value: { $numberInt: "2" }, path: "n", onchange: noop, onremove: noop, onerror },
    });
    const input = container.querySelector("input.leaf")!;
    await fireEvent.input(input, { target: { value: "abc" } }); // -> onerror("n", true)
    unmount();
    expect(onerror).toHaveBeenLastCalledWith("n", false);
  });
});
