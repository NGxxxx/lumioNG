import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import TreeNode from "./TreeNode.svelte";

const noop = () => {};

describe("TreeNode lá", () => {
  it("sửa string hợp lệ → onchange với chuỗi mới, không lỗi", async () => {
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

  it("sửa int sai → onerror(path,true), KHÔNG onchange, hiện lỗi", async () => {
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

  it("sửa int hợp lệ → onchange với {$numberInt}", async () => {
    const onchange = vi.fn();
    const { container } = render(TreeNode, {
      props: { label: "n", value: { $numberInt: "2" }, path: "n", onchange, onremove: noop, onerror: noop },
    });
    const input = container.querySelector("input.leaf")!;
    await fireEvent.input(input, { target: { value: "5" } });
    expect(onchange).toHaveBeenCalledWith({ $numberInt: "5" });
  });

  it("lá khóa (_id) → không có ô nhập, có 🔒", () => {
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

describe("TreeNode object", () => {
  // Dùng root:true (đúng như TreeEditor render) để không có nút Remove/header riêng
  // của chính node object, tránh lệch chỉ số getAllByLabelText.
  it("thêm field mới → onchange với key + giá trị rỗng đúng kiểu", async () => {
    const onchange = vi.fn();
    const { container, getByText } = render(TreeNode, {
      props: { root: true, label: "", value: { a: "x" }, path: "", removable: false, onchange, onremove: noop, onerror: noop },
    });
    const nameInput = container.querySelector("input.name")!;
    await fireEvent.input(nameInput, { target: { value: "newf" } });
    await fireEvent.click(getByText("+ Add field"));
    expect(onchange).toHaveBeenCalledWith({ a: "x", newf: "" });
  });

  it("thêm field trùng tên → báo lỗi, KHÔNG onchange", async () => {
    const onchange = vi.fn();
    const { container, getByText } = render(TreeNode, {
      props: { root: true, label: "", value: { a: "x" }, path: "", removable: false, onchange, onremove: noop, onerror: noop },
    });
    const nameInput = container.querySelector("input.name")!;
    await fireEvent.input(nameInput, { target: { value: "a" } });
    await fireEvent.click(getByText("+ Add field"));
    expect(onchange).not.toHaveBeenCalled();
    expect(getByText(/đã tồn tại/)).toBeTruthy();
  });

  it("xóa field con → onchange với object bỏ key đó", async () => {
    const onchange = vi.fn();
    const { getAllByLabelText } = render(TreeNode, {
      props: { root: true, label: "", value: { a: "x", b: "y" }, path: "", removable: false, onchange, onremove: noop, onerror: noop },
    });
    // root không có nút Remove riêng → nút ✕ đầu tiên là của field "a"
    await fireEvent.click(getAllByLabelText("Remove")[0]);
    expect(onchange).toHaveBeenCalledWith({ b: "y" });
  });
});

describe("TreeNode array", () => {
  it("thêm phần tử → onchange với mảng có phần tử rỗng mới", async () => {
    const onchange = vi.fn();
    const { getByText } = render(TreeNode, {
      props: { label: "arr", value: ["x"], path: "arr", removable: false, onchange, onremove: noop, onerror: noop },
    });
    await fireEvent.click(getByText("+ Add item"));
    expect(onchange).toHaveBeenCalledWith(["x", ""]);
  });

  it("xóa phần tử [0] → onchange với mảng đã splice", async () => {
    const onchange = vi.fn();
    const { getAllByLabelText } = render(TreeNode, {
      props: { label: "arr", value: ["x", "y"], path: "arr", removable: false, onchange, onremove: noop, onerror: noop },
    });
    // node mảng removable:false → không có nút Remove riêng; ✕ đầu tiên là phần tử [0]
    await fireEvent.click(getAllByLabelText("Remove")[0]);
    expect(onchange).toHaveBeenCalledWith(["y"]);
  });
});

describe("TreeNode unmount", () => {
  it("lá đang lỗi bị unmount → dọn cờ lỗi (onerror path,false)", async () => {
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
