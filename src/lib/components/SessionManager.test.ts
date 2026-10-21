// src/lib/components/SessionManager.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import SessionManager from "./SessionManager.svelte";
import { listConnections, saveConnection, type SavedConnection } from "../api/connections";
import { handleModalKeydown } from "#lib/stores/modalStack.js";
import { connectionPrefill } from "../stores/connectionPrefill";

function key(k: string): KeyboardEvent {
  return { key: k, target: null } as unknown as KeyboardEvent;
}

vi.mock("../api/connections", () => ({
  getSecretStorage: vi.fn(async () => "keychain"),
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
    sshPasswordEnc: "", sshPrivateKeyPath: "", sshPassphraseEnc: "", proxyType: "none", proxyHost: "", proxyPort: null, proxyUser: "", proxyPasswordEnc: "", awsSessionTokenEnc: "", gssapiServiceName: "", gssapiServiceRealm: "", gssapiCanonicalize: "", oidcMode: "", oidcEnvironment: "", oidcTokenResource: "", environment: "", color: "", mcpAccess: "read",
    ...over,
  };
}

describe("SessionManager", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens with the connection string handed over by the Atlas browser, without a password", async () => {
    connectionPrefill.set({ uri: "mongodb+srv://cluster0.ab1cd.mongodb.net", label: "Cluster0" });
    const { getByLabelText } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    await vi.waitFor(() => expect((getByLabelText("Connection type:") as HTMLSelectElement).value).toBe("mongodb+srv"));
    expect(connectionPrefill.take()).toBeNull();
  });

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

  it("the connection string field fills host and user", async () => {
    const { getByLabelText } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    const uriInput = getByLabelText("Connection string") as HTMLInputElement;
    await fireEvent.input(uriInput, { target: { value: "mongodb://bob@dbhost:27017/" } });
    await fireEvent.keyDown(uriInput, { key: "Enter" });
    expect((getByLabelText("Hostname / IP:") as HTMLInputElement).value).toBe("dbhost");
    expect((getByLabelText("User:") as HTMLInputElement).value).toBe("bob");
  });

  it("an empty list points at the connection string field", async () => {
    const { findByRole, getByLabelText } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    await fireEvent.click(await findByRole("button", { name: "Paste a connection string to get started" }));
    expect(document.activeElement).toBe(getByLabelText("Connection string"));
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

  it("the footer button is always labelled Save, also while editing a saved session", async () => {
    (listConnections as ReturnType<typeof vi.fn>).mockResolvedValueOnce([saved()]);
    const { findByText, getByRole, queryByRole } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    expect(getByRole("button", { name: "Save" })).toBeTruthy();
    await fireEvent.click(await findByText("Local"));
    expect(getByRole("button", { name: "Save" })).toBeTruthy();
    expect(queryByRole("button", { name: "Update" })).toBeNull();
  });

  it("saving keeps the name filled and the row selected", async () => {
    const a = saved({ id: 1, label: "Local" });
    (listConnections as ReturnType<typeof vi.fn>).mockResolvedValueOnce([a]);
    (saveConnection as ReturnType<typeof vi.fn>).mockResolvedValueOnce([a]);
    const { findByText, getByRole, getByLabelText } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    const row = (await findByText("Local")).closest(".session-row") as HTMLElement;
    await fireEvent.click(row);
    await fireEvent.click(getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(saveConnection).toHaveBeenCalled());
    await vi.waitFor(() => expect(row.classList.contains("selected")).toBe(true));
    expect((getByLabelText("Hostname / IP:") as HTMLInputElement).value).toBe("localhost");
    expect(getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("saving a new session selects the new row", async () => {
    const b = saved({ id: 5, label: "Fresh" });
    (saveConnection as ReturnType<typeof vi.fn>).mockResolvedValueOnce([b]);
    const { getByRole, getByLabelText, findByText } = render(SessionManager, { onconnected: vi.fn(), onclose: vi.fn() });
    await fireEvent.input(getByLabelText("Session name"), { target: { value: "Fresh" } });
    await fireEvent.input(getByLabelText("Hostname / IP:"), { target: { value: "h" } });
    await fireEvent.click(getByRole("button", { name: "Save" }));
    const row = (await findByText("Fresh")).closest(".session-row") as HTMLElement;
    await vi.waitFor(() => expect(row.classList.contains("selected")).toBe(true));
  });
});
