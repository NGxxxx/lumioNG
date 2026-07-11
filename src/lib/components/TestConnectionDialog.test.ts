import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import TestConnectionDialog from "./TestConnectionDialog.svelte";

describe("TestConnectionDialog", () => {
  it("shows the success message and closes on OK", async () => {
    const onclose = vi.fn();
    const { getByText } = render(TestConnectionDialog, {
      props: { result: { ok: true }, onclose },
    });
    getByText("✓ Connected");
    await fireEvent.click(getByText("OK"));
    expect(onclose).toHaveBeenCalled();
  });

  it("shows the SSH-specific failure message", () => {
    const { getByText } = render(TestConnectionDialog, {
      props: { result: { ok: false, kind: "ssh", message: "auth rejected" }, onclose: vi.fn() },
    });
    getByText("SSH tunnel failed: auth rejected");
  });

  it("shows the Mongo-specific failure message", () => {
    const { getByText } = render(TestConnectionDialog, {
      props: { result: { ok: false, kind: "mongo", message: "bad auth" }, onclose: vi.fn() },
    });
    getByText("MongoDB connection failed: bad auth");
  });

  it("shows the raw message for a validation failure", () => {
    const { getByText } = render(TestConnectionDialog, {
      props: { result: { ok: false, kind: "validation", message: "SSH port must be between 1 and 65535." }, onclose: vi.fn() },
    });
    getByText("SSH port must be between 1 and 65535.");
  });

  it("closes on Escape", async () => {
    const onclose = vi.fn();
    render(TestConnectionDialog, { props: { result: { ok: true }, onclose } });
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onclose).toHaveBeenCalled();
  });
});
