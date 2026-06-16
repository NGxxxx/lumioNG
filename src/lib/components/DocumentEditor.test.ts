import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import DocumentEditor from "./DocumentEditor.svelte";
import * as ipc from "../ipc";

vi.mock("../ipc", () => ({
  insertDocument: vi.fn(),
  replaceDocument: vi.fn(),
  idJson: vi.fn(() => '{"$oid":"abc"}'),
  errorMessage: (e: unknown) => String(e),
}));

describe("DocumentEditor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cú pháp JSON sai → chặn save, không gọi backend, hiện lỗi", async () => {
    const onsaved = vi.fn();
    const { getByText, container } = render(DocumentEditor, {
      props: { mode: "insert", db: "d", coll: "c", initial: null, onsaved, oncancel: () => {} },
    });
    const textarea = container.querySelector("textarea")!;
    await fireEvent.input(textarea, { target: { value: "{ bad json" } });
    await fireEvent.click(getByText("Save"));

    expect(ipc.insertDocument).not.toHaveBeenCalled();
    expect(onsaved).not.toHaveBeenCalled();
    expect(getByText(/sai cú pháp/)).toBeTruthy();
  });

  it("JSON hợp lệ ở chế độ insert → gọi insertDocument với text", async () => {
    const onsaved = vi.fn();
    (ipc.insertDocument as ReturnType<typeof vi.fn>).mockResolvedValue('{"$oid":"1"}');
    const { getByText, container } = render(DocumentEditor, {
      props: { mode: "insert", db: "d", coll: "c", initial: null, onsaved, oncancel: () => {} },
    });
    const textarea = container.querySelector("textarea")!;
    await fireEvent.input(textarea, { target: { value: '{"a":1}' } });
    await fireEvent.click(getByText("Save"));

    expect(ipc.insertDocument).toHaveBeenCalledWith("d", "c", '{"a":1}');
  });

  it("JSON hợp lệ ở chế độ edit → gọi replaceDocument với _id và text đã sửa", async () => {
    const onsaved = vi.fn();
    (ipc.replaceDocument as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { getByText, container } = render(DocumentEditor, {
      props: {
        mode: "edit",
        db: "d",
        coll: "c",
        initial: { _id: { $oid: "abc" }, a: 1 },
        onsaved,
        oncancel: () => {},
      },
    });
    const textarea = container.querySelector("textarea")!;
    await fireEvent.input(textarea, { target: { value: '{"_id":{"$oid":"abc"},"a":2}' } });
    await fireEvent.click(getByText("Save"));

    expect(ipc.replaceDocument).toHaveBeenCalledWith(
      "d",
      "c",
      '{"$oid":"abc"}',
      '{"_id":{"$oid":"abc"},"a":2}',
    );
  });
});
