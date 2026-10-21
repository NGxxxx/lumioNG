import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/atlas", () => ({
  atlasHasCredentials: vi.fn(), atlasSaveCredentials: vi.fn(), atlasForgetCredentials: vi.fn(), atlasListProjects: vi.fn(), atlasListClusters: vi.fn(),
}));
vi.mock("./vault.svelte", () => ({ vault: { ensure: vi.fn() } }));

import * as api from "../api/atlas";
import { vault } from "./vault.svelte";
import { prefs } from "./prefs.svelte";
import { connectionPrefill } from "./connectionPrefill";
import { createAtlasBrowser } from "./atlasBrowser.svelte";
import type { AtlasCluster } from "../domain/atlas";

const cluster = (name: string, srv: string | null): AtlasCluster => ({ name, state: "IDLE", clusterType: "REPLICASET", mongoVersion: "7.0", srv, standard: null, privateSrv: null });

beforeEach(() => {
  vi.clearAllMocks();
  prefs.clear();
  connectionPrefill.take();
});

describe("atlas browser", () => {
  it("signs in, stores the secret, clears the field and lists the single project's clusters", async () => {
    vi.mocked(api.atlasSaveCredentials).mockResolvedValue("keychain");
    vi.mocked(api.atlasListProjects).mockResolvedValue([{ id: "p1", name: "Prod" }]);
    vi.mocked(api.atlasListClusters).mockResolvedValue([cluster("C0", "mongodb+srv://c0.x.mongodb.net")]);
    const b = createAtlasBrowser();
    b.clientId = " mdb_sa_id_1 ";
    b.secret = "s3cret";
    await b.signIn();
    expect(api.atlasSaveCredentials).toHaveBeenCalledWith("mdb_sa_id_1", "s3cret");
    expect(b.secret).toBe("");
    expect(b.hasSaved).toBe(true);
    expect(b.projectId).toBe("p1");
    expect(b.clusters.map((c) => c.name)).toEqual(["C0"]);
    expect(prefs.getItem("atlas-client-id")).toBe("mdb_sa_id_1");
    expect(JSON.stringify([b.clientId, b.note, b.error])).not.toContain("s3cret");
  });

  it("a rejected sign-in keeps the form, shows the error and does not list projects", async () => {
    vi.mocked(api.atlasSaveCredentials).mockRejectedValue({ kind: "Connection", message: "Atlas rejected the Service Account credentials (HTTP 401)" });
    const b = createAtlasBrowser();
    b.clientId = "id";
    b.secret = "bad";
    await b.signIn();
    expect(b.error).toContain("401");
    expect(b.hasSaved).toBe(false);
    expect(api.atlasListProjects).not.toHaveBeenCalled();
  });

  it("a locked vault asks to unlock and retries once", async () => {
    vi.mocked(api.atlasSaveCredentials).mockRejectedValueOnce({ kind: "Vault", message: "vault_locked" }).mockResolvedValueOnce("vault");
    vi.mocked(vault.ensure).mockResolvedValue(true);
    vi.mocked(api.atlasListProjects).mockResolvedValue([]);
    const b = createAtlasBrowser();
    b.clientId = "id";
    b.secret = "s";
    await b.signIn();
    expect(vault.ensure).toHaveBeenCalledWith("unlock");
    expect(api.atlasSaveCredentials).toHaveBeenCalledTimes(2);
    expect(b.hasSaved).toBe(true);
    expect(b.error).toBeNull();
  });

  it("a cancelled unlock leaves a clear error", async () => {
    vi.mocked(api.atlasSaveCredentials).mockRejectedValue({ kind: "Vault", message: "vault_uninitialized" });
    vi.mocked(vault.ensure).mockResolvedValue(false);
    const b = createAtlasBrowser();
    b.clientId = "id";
    b.secret = "s";
    await b.signIn();
    expect(vault.ensure).toHaveBeenCalledWith("setup");
    expect(b.error).toBeTruthy();
    expect(b.hasSaved).toBe(false);
  });

  it("init reuses a stored secret without asking for it again", async () => {
    prefs.setItem("atlas-client-id", "id");
    vi.mocked(api.atlasHasCredentials).mockResolvedValue(true);
    vi.mocked(api.atlasListProjects).mockResolvedValue([{ id: "a", name: "A" }, { id: "b", name: "B" }]);
    vi.mocked(api.atlasListClusters).mockResolvedValue([cluster("X", null)]);
    const b = createAtlasBrowser();
    await b.init();
    expect(b.hasSaved).toBe(true);
    expect(b.projects).toHaveLength(2);
    expect(b.projectId).toBe("");
    await b.selectProject("b");
    expect(api.atlasListClusters).toHaveBeenCalledWith("id", "b");
  });

  it("pick hands the SRV string to the connection form and refuses a cluster without one", () => {
    const b = createAtlasBrowser();
    expect(b.pick(cluster("Paused", null))).toBeNull();
    expect(connectionPrefill.take()).toBeNull();
    expect(b.pick(cluster("C0", "mongodb+srv://c0.x.mongodb.net"))).toEqual({ uri: "mongodb+srv://c0.x.mongodb.net", label: "C0" });
    expect(connectionPrefill.take()).toEqual({ uri: "mongodb+srv://c0.x.mongodb.net", label: "C0" });
    expect(connectionPrefill.take()).toBeNull();
  });

  it("sign out forgets the secret and the remembered id", async () => {
    vi.mocked(api.atlasForgetCredentials).mockResolvedValue();
    prefs.setItem("atlas-client-id", "id");
    const b = createAtlasBrowser();
    b.clientId = "id";
    await b.signOut();
    expect(api.atlasForgetCredentials).toHaveBeenCalledWith("id");
    expect(prefs.getItem("atlas-client-id")).toBeNull();
    expect(b.hasSaved).toBe(false);
  });
});
