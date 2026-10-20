import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/svelte";

vi.mock("../api/mcp", () => ({
  startMcp: vi.fn(async () => ({ running: true, port: 7737, allowWrites: false })),
  stopMcp: vi.fn(async () => {}),
  setMcpSessions: vi.fn(async () => {}),
}));

import McpDialog from "./McpDialog.svelte";
import { mcp } from "../stores/mcp.svelte";
import { startMcp } from "../api/mcp";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mcp.setEnabled(false);
  mcp.setAllowWrites(false);
  mcp.setPort(7737);
  vi.mocked(startMcp).mockClear();
});

describe("McpDialog", () => {
  it("enabling from the dialog starts the server and shows its endpoint", async () => {
    render(McpDialog, { props: { onclose: vi.fn() } });
    expect(screen.getByRole("status").textContent).toContain("Off");
    await fireEvent.click(screen.getByLabelText("Enable MCP server"));
    await flush();
    expect(startMcp).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("http://127.0.0.1:7737/mcp");
  });

  it("the token is masked until shown, and the client snippet carries it", async () => {
    render(McpDialog, { props: { onclose: vi.fn() } });
    expect(screen.getByLabelText("Access token").textContent).not.toContain(mcp.token);
    expect(document.querySelector("pre")!.textContent).not.toContain(mcp.token);
    await fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByLabelText("Access token").textContent).toBe(mcp.token);
    expect(document.querySelector("pre")!.textContent).toContain(`claude mcp add --transport http lumiong`);
    await fireEvent.click(screen.getByRole("tab", { name: "VS Code" }));
    expect(document.querySelector("pre")!.textContent).toContain(`"Bearer ${mcp.token}"`);
  });

  it("an out-of-range port is flagged and not applied", async () => {
    render(McpDialog, { props: { onclose: vi.fn() } });
    const port = screen.getByLabelText("Port");
    await fireEvent.input(port, { target: { value: "80" } });
    await fireEvent.blur(port);
    expect(screen.getByText("Use a port between 1024 and 65535")).toBeInTheDocument();
    expect(mcp.port).toBe(7737);
    await fireEvent.input(port, { target: { value: "9100" } });
    await fireEvent.blur(port);
    expect(mcp.port).toBe(9100);
  });

  it("allow writes is off by default and toggles the store", async () => {
    render(McpDialog, { props: { onclose: vi.fn() } });
    const box = screen.getByLabelText(/Allow writes/) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await fireEvent.click(box);
    expect(mcp.allowWrites).toBe(true);
  });

  it("the hidden-fields list is edited as text and the audit-reads box toggles the store", async () => {
    render(McpDialog, { props: { onclose: vi.fn() } });
    const box = screen.getByLabelText("Hidden fields") as HTMLInputElement;
    expect(box.value).toContain("password");
    await fireEvent.input(box, { target: { value: "iban, *secret*, iban" } });
    await fireEvent.blur(box);
    expect(mcp.redactFields).toEqual(["iban", "*secret*"]);
    const reads = screen.getByLabelText(/Also audit MCP read calls/) as HTMLInputElement;
    expect(reads.checked).toBe(false);
    await fireEvent.click(reads);
    expect(mcp.auditReads).toBe(true);
  });
});
