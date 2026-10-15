import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import IndexCreateForm from "./IndexCreateForm.svelte";

// CodeEditor (CodeMirror) measures ranges; jsdom doesn't implement these. Stub them so it mounts
// (same stub as CodeEditor.test.ts / RoleList.test.ts).
beforeAll(() => {
  const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} };
  (Range.prototype as unknown as { getClientRects: () => unknown }).getClientRects = () => ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  });
  (Range.prototype as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => rect;
});

describe("IndexCreateForm", () => {
  it("submit calls onsubmit with (rows, unique, name, sparse, ttlSeconds, partialFilter, collation)", async () => {
    const onsubmit = vi.fn().mockResolvedValue(undefined);
    const { getByText, getByLabelText } = render(IndexCreateForm, {
      props: { onsubmit, oncancel: vi.fn() },
    });
    await fireEvent.input(getByLabelText("Field 1"), { target: { value: "email" } });
    await fireEvent.click(getByText("Create"));
    expect(onsubmit).toHaveBeenCalledWith([{ field: "email", dir: 1 }], false, "", false, null, "", "");
  });

  it("＋ field adds a field-1 row", async () => {
    const { getByText, getByLabelText } = render(IndexCreateForm, {
      props: { onsubmit: vi.fn().mockResolvedValue(undefined), oncancel: vi.fn() },
    });
    await fireEvent.click(getByText("＋ field"));
    expect(getByLabelText("Field 2")).toBeTruthy();
  });

  it("onsubmit reject shows inline error", async () => {
    const onsubmit = vi.fn().mockRejectedValue("err_index_no_field");
    const { getByText, findByText } = render(IndexCreateForm, {
      props: { onsubmit, oncancel: vi.fn() },
    });
    await fireEvent.click(getByText("Create"));
    expect(await findByText("At least one field is required.")).toBeTruthy();
  });

  it("Advanced options starts collapsed; toggling reveals sparse/TTL fields", async () => {
    const { getByText, queryByLabelText, getByLabelText } = render(IndexCreateForm, {
      props: { onsubmit: vi.fn().mockResolvedValue(undefined), oncancel: vi.fn() },
    });
    expect(queryByLabelText("sparse")).toBeNull();
    await fireEvent.click(getByText("Advanced options"));
    expect(getByLabelText("sparse")).toBeTruthy();
    expect(getByLabelText("Expire after (seconds)", { exact: false, selector: "input[type=checkbox]" })).toBeTruthy();
    expect(getByLabelText("Seconds until expiry")).toBeTruthy();
  });

  it("TTL seconds input is disabled until the TTL checkbox is checked", async () => {
    const { getByText, getByLabelText } = render(IndexCreateForm, {
      props: { onsubmit: vi.fn().mockResolvedValue(undefined), oncancel: vi.fn() },
    });
    await fireEvent.click(getByText("Advanced options"));
    expect((getByLabelText("Seconds until expiry") as HTMLInputElement).disabled).toBe(true);
    await fireEvent.click(getByLabelText("Expire after (seconds)", { exact: false, selector: "input[type=checkbox]" }));
    expect((getByLabelText("Seconds until expiry") as HTMLInputElement).disabled).toBe(false);
  });

  it("checking sparse and TTL sends them in onsubmit", async () => {
    const onsubmit = vi.fn().mockResolvedValue(undefined);
    const { getByText, getByLabelText } = render(IndexCreateForm, {
      props: { onsubmit, oncancel: vi.fn() },
    });
    await fireEvent.input(getByLabelText("Field 1"), { target: { value: "createdAt" } });
    await fireEvent.click(getByText("Advanced options"));
    await fireEvent.click(getByLabelText("sparse"));
    await fireEvent.click(getByLabelText("Expire after (seconds)", { exact: false, selector: "input[type=checkbox]" }));
    await fireEvent.input(getByLabelText("Seconds until expiry"), { target: { value: "3600" } });
    await fireEvent.click(getByText("Create"));
    expect(onsubmit).toHaveBeenCalledWith(
      [{ field: "createdAt", dir: 1 }], false, "", true, 3600, "", "",
    );
  });
});
