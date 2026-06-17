import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import DocumentForm from "./DocumentForm.svelte";
import * as documents from "../api/documents";

vi.mock("../api/documents", () => ({
  insertDocument: vi.fn(),
  replaceDocument: vi.fn(),
}));
vi.mock("../domain/docid", () => ({
  idJson: vi.fn(() => '{"$oid":"abc"}'),
}));

describe("DocumentForm — Raw JSON view", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cú pháp JSON sai → chặn save, không gọi backend, hiện lỗi", async () => {
    const onsaved = vi.fn();
    const { getByText, container } = render(DocumentForm, {
      props: { mode: "insert", db: "d", coll: "c", initial: null, onsaved, oncancel: () => {} },
    });
    await fireEvent.click(getByText("Raw JSON"));
    const textarea = container.querySelector("textarea")!;
    await fireEvent.input(textarea, { target: { value: "{ bad json" } });
    await fireEvent.click(getByText("Save"));

    expect(documents.insertDocument).not.toHaveBeenCalled();
    expect(onsaved).not.toHaveBeenCalled();
    expect(getByText(/sai cú pháp/)).toBeTruthy();
  });

  it("JSON hợp lệ ở chế độ insert → gọi insertDocument với JSON", async () => {
    const onsaved = vi.fn();
    (documents.insertDocument as ReturnType<typeof vi.fn>).mockResolvedValue('{"$oid":"1"}');
    const { getByText, container } = render(DocumentForm, {
      props: { mode: "insert", db: "d", coll: "c", initial: null, onsaved, oncancel: () => {} },
    });
    await fireEvent.click(getByText("Raw JSON"));
    const textarea = container.querySelector("textarea")!;
    await fireEvent.input(textarea, { target: { value: '{"a":1}' } });
    await fireEvent.click(getByText("Save"));

    expect(documents.insertDocument).toHaveBeenCalledWith("d", "c", '{"a":1}');
  });

  it("JSON hợp lệ ở chế độ edit → gọi replaceDocument với _id và JSON đã sửa", async () => {
    const onsaved = vi.fn();
    (documents.replaceDocument as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { getByText, container } = render(DocumentForm, {
      props: {
        mode: "edit",
        db: "d",
        coll: "c",
        initial: { _id: { $oid: "abc" }, a: 1 },
        onsaved,
        oncancel: () => {},
      },
    });
    await fireEvent.click(getByText("Raw JSON"));
    const textarea = container.querySelector("textarea")!;
    await fireEvent.input(textarea, { target: { value: '{"_id":{"$oid":"abc"},"a":2}' } });
    await fireEvent.click(getByText("Save"));

    expect(documents.replaceDocument).toHaveBeenCalledWith(
      "d",
      "c",
      '{"$oid":"abc"}',
      '{"_id":{"$oid":"abc"},"a":2}',
    );
  });

  it("Raw JSON sai cú pháp → bấm Tree bị chặn, giữ Raw view + báo lỗi", async () => {
    const { getByText, container } = render(DocumentForm, {
      props: { mode: "insert", db: "d", coll: "c", initial: null, onsaved: () => {}, oncancel: () => {} },
    });
    await fireEvent.click(getByText("Raw JSON"));
    const textarea = container.querySelector("textarea")!;
    await fireEvent.input(textarea, { target: { value: "{ bad json" } });
    await fireEvent.click(getByText("Tree"));
    // vẫn còn textarea (chưa chuyển sang Tree) + có lỗi cú pháp
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(getByText(/sai cú pháp/)).toBeTruthy();
  });
});

describe("DocumentForm — Tree view", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mặc định mở Tree view (không có textarea), hiện field", () => {
    const { container, getByText } = render(DocumentForm, {
      props: {
        mode: "edit",
        db: "d",
        coll: "c",
        initial: { _id: { $oid: "abc" }, a: "x" },
        onsaved: () => {},
        oncancel: () => {},
      },
    });
    expect(container.querySelector("textarea")).toBeNull();
    expect(getByText("a")).toBeTruthy();
  });

  it("sửa field trong tree → Save gọi replaceDocument với JSON đã đổi (giữ _id)", async () => {
    const onsaved = vi.fn();
    (documents.replaceDocument as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { getByText, container } = render(DocumentForm, {
      props: {
        mode: "edit",
        db: "d",
        coll: "c",
        initial: { _id: { $oid: "abc" }, a: "x" },
        onsaved,
        oncancel: () => {},
      },
    });
    const input = container.querySelector("input.leaf")!;
    await fireEvent.input(input, { target: { value: "y" } });
    await fireEvent.click(getByText("Save"));

    expect(documents.replaceDocument).toHaveBeenCalledWith(
      "d",
      "c",
      '{"$oid":"abc"}',
      JSON.stringify({ _id: { $oid: "abc" }, a: "y" }),
    );
  });

  it("field lỗi kiểu trong tree → Save vô hiệu, không gọi backend", async () => {
    const onsaved = vi.fn();
    const { getByText, container } = render(DocumentForm, {
      props: {
        mode: "edit",
        db: "d",
        coll: "c",
        initial: { _id: { $oid: "abc" }, n: { $numberInt: "2" } },
        onsaved,
        oncancel: () => {},
      },
    });
    const input = container.querySelector("input.leaf")!;
    await fireEvent.input(input, { target: { value: "abc" } });
    const saveBtn = getByText("Save") as HTMLButtonElement;
    await fireEvent.click(saveBtn);

    expect(saveBtn.disabled).toBe(true);
    expect(documents.replaceDocument).not.toHaveBeenCalled();
    expect(onsaved).not.toHaveBeenCalled();
  });

  it("toggle Tree(lỗi)→Raw→Tree → Save bật lại (treeValid được reset)", async () => {
    const { getByText, container } = render(DocumentForm, {
      props: {
        mode: "edit",
        db: "d",
        coll: "c",
        initial: { _id: { $oid: "abc" }, n: { $numberInt: "2" } },
        onsaved: () => {},
        oncancel: () => {},
      },
    });
    const input = container.querySelector("input.leaf")!;
    await fireEvent.input(input, { target: { value: "abc" } }); // không hợp lệ -> treeValid=false
    expect((getByText("Save") as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(getByText("Raw JSON"));
    await fireEvent.click(getByText("Tree"));
    expect((getByText("Save") as HTMLButtonElement).disabled).toBe(false);
  });
});
