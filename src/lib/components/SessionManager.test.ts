// src/lib/components/SessionManager.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import SessionManager from "./SessionManager.svelte";
import { listConnections, type SavedConnection } from "../api/connections";
import { handleModalKeydown } from "#lib/stores/modalStack.js";

function key(k: string): KeyboardEvent {
  return { key: k, target: null } as unknown as KeyboardEvent;
}

vi.mock("../api/connections", () => ({
  listConnections: vi.fn().mockResolvedValue([]),
  saveConnection: vi.fn().mockResolvedValue([]),
  deleteConnection: vi.fn().mockResolvedValue([]),
  touchConnection: vi.fn().mockResolvedValue([]),
}));
vi.mock("../api/connection", () => ({ connect: vi.fn().mockResolvedValue(undefined) }));

function saved(over: Partial<SavedConnection> = {}): SavedConnection {
  return {
    id: 1, label: "Local", scheme: "mongodb", host: "localhost", port: 27017,
    authMethod: "none", user: "", passwordEnc: "", authSource: "", replicaSet: "",
    tls: false, extraOptions: "", readOnly: false,
    tlsCertificateKeyFile: "", tlsCertificateKeyFilePasswordEnc: "",
    sshEnabled: false, sshHost: "", sshPort: 22, sshUser: "", sshAuthMethod: "password",
    sshPasswordEnc: "", sshPrivateKeyPath: "", sshPassphraseEnc: "",
    ...over,
  };
}

describe("SessionManager", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables port when SRV is selected", async () => {
    const { getByLabelText } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    const type = getByLabelText("Connection type:") as HTMLSelectElement;
    await fireEvent.change(type, { target: { value: "mongodb+srv" } });
    const portInput = getByLabelText("Port:") as HTMLInputElement;
    expect(portInput.disabled).toBe(true);
  });

  it("disables user/password when auth is None", () => {
    const { getByLabelText } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    expect((getByLabelText("User:") as HTMLInputElement).disabled).toBe(true);
    expect((getByLabelText("Password:") as HTMLInputElement).disabled).toBe(true);
  });

  it("Import from URI fills host and user", async () => {
    const { getByLabelText, getByText } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    const importInput = getByLabelText("Import from URI:") as HTMLInputElement;
    await fireEvent.input(importInput, { target: { value: "mongodb://bob@dbhost:27017/" } });
    await fireEvent.click(getByText("Import"));
    expect((getByLabelText("Hostname / IP:") as HTMLInputElement).value).toBe("dbhost");
    expect((getByLabelText("User:") as HTMLInputElement).value).toBe("bob");
  });

  it("shows 'Never connected' for a saved session with no last-connect time", async () => {
    (listConnections as ReturnType<typeof vi.fn>).mockResolvedValueOnce([saved({ lastConnectedAt: null })]);
    const { findByText } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    expect(await findByText("Never connected")).toBeTruthy();
  });

  it("shows the single-host notice only when the SSH tab is enabled", async () => {
    const { getByLabelText, getByText, queryByText } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    await fireEvent.click(getByText("SSH Tunnel"));
    expect(queryByText(/restricts this connection to a single host/)).toBeNull();
    await fireEvent.click(getByLabelText("Use SSH Tunnel"));
    expect(getByText(/restricts this connection to a single host/)).toBeTruthy();
  });

  it("disables mongodb+srv and replica set once the SSH tunnel is enabled", async () => {
    const { getByLabelText, getByText } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    await fireEvent.click(getByText("SSH Tunnel"));
    await fireEvent.click(getByLabelText("Use SSH Tunnel"));
    await fireEvent.click(getByText("General"));
    const type = getByLabelText("Connection type:") as HTMLSelectElement;
    expect(Array.from(type.options).some((o) => o.value === "mongodb+srv")).toBe(false);
    expect((getByLabelText("Replica set:") as HTMLInputElement).disabled).toBe(true);
  });

  it("hides user/password and shows a certificate picker for X.509", async () => {
    const { getByLabelText, queryByLabelText } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    const auth = getByLabelText("Authentication:") as HTMLSelectElement;
    await fireEvent.change(auth, { target: { value: "x509" } });
    expect(queryByLabelText("User:")).toBeNull();
    expect(getByLabelText("Client certificate (PEM):")).toBeTruthy();
  });

  it("shows TLS force-checked (though disabled) for X.509 even when the underlying value is off", async () => {
    const { getByLabelText } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    const auth = getByLabelText("Authentication:") as HTMLSelectElement;
    const tls = getByLabelText("TLS / SSL:") as HTMLInputElement;
    expect(tls.checked).toBe(false);
    await fireEvent.change(auth, { target: { value: "x509" } });
    expect(tls.checked).toBe(true);
    expect(tls.disabled).toBe(true);
  });

  it("shows auth database force-filled with $external (though disabled) for LDAP", async () => {
    const { getByLabelText } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    const auth = getByLabelText("Authentication:") as HTMLSelectElement;
    const authSource = getByLabelText("Auth database:") as HTMLInputElement;
    const tls = getByLabelText("TLS / SSL:") as HTMLInputElement;
    await fireEvent.change(auth, { target: { value: "ldap" } });
    expect(authSource.value).toBe("$external");
    expect(authSource.disabled).toBe(true);
    expect(tls.checked).toBe(true);
    expect(tls.disabled).toBe(true);
  });

  it("keeps TLS freely toggleable for None and Password auth methods", async () => {
    const { getByLabelText } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    const tls = getByLabelText("TLS / SSL:") as HTMLInputElement;
    expect(tls.disabled).toBe(false);
    await fireEvent.click(tls);
    expect(tls.checked).toBe(true);
    const auth = getByLabelText("Authentication:") as HTMLSelectElement;
    await fireEvent.change(auth, { target: { value: "password" } });
    expect(tls.disabled).toBe(false);
    expect(tls.checked).toBe(true);
    await fireEvent.click(tls);
    expect(tls.checked).toBe(false);
  });

  it("Escape calls onclose", () => {
    const onclose = vi.fn();
    render(SessionManager, { onconnected: vi.fn(), onclose });
    handleModalKeydown(key("Escape"));
    expect(onclose).toHaveBeenCalled();
  });

  it("Enter does nothing — no single unambiguous primary action in this multi-field form", () => {
    const onconnected = vi.fn();
    render(SessionManager, { onconnected, onclose: vi.fn() });
    handleModalKeydown(key("Enter"));
    expect(onconnected).not.toHaveBeenCalled();
  });
});
