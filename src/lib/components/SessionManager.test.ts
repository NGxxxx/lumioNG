// src/lib/components/SessionManager.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import SessionManager from "./SessionManager.svelte";

vi.mock("../api/connections", () => ({
  listConnections: vi.fn().mockResolvedValue([]),
  saveConnection: vi.fn().mockResolvedValue([]),
  deleteConnection: vi.fn().mockResolvedValue([]),
}));
vi.mock("../api/connection", () => ({ connect: vi.fn().mockResolvedValue(undefined) }));

describe("SessionManager", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables port when SRV is selected", async () => {
    const { getByLabelText } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    const type = getByLabelText("Connection type") as HTMLSelectElement;
    await fireEvent.change(type, { target: { value: "mongodb+srv" } });
    const portInput = getByLabelText("Port") as HTMLInputElement;
    expect(portInput.disabled).toBe(true);
  });

  it("disables user/password when auth is None", () => {
    const { getByLabelText } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    expect((getByLabelText("User") as HTMLInputElement).disabled).toBe(true);
    expect((getByLabelText("Password") as HTMLInputElement).disabled).toBe(true);
  });

  it("Import from URI fills host and user", async () => {
    const { getByLabelText, getByText } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    const importInput = getByLabelText("Import from URI") as HTMLInputElement;
    await fireEvent.input(importInput, { target: { value: "mongodb://bob@dbhost:27017/" } });
    await fireEvent.click(getByText("Import"));
    expect((getByLabelText("Hostname / IP") as HTMLInputElement).value).toBe("dbhost");
    expect((getByLabelText("User") as HTMLInputElement).value).toBe("bob");
  });
});
