import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";

vi.mock("../api/atlas", () => ({
  atlasHasCredentials: vi.fn(async () => false), atlasSaveCredentials: vi.fn(async () => "keychain"), atlasForgetCredentials: vi.fn(),
  atlasListProjects: vi.fn(async () => [{ id: "p1", name: "Prod" }]),
  atlasListClusters: vi.fn(async () => [
    { name: "Cluster0", state: "IDLE", clusterType: "REPLICASET", mongoVersion: "7.0.12", srv: "mongodb+srv://cluster0.ab1cd.mongodb.net", standard: null, privateSrv: null },
    { name: "Paused", state: "IDLE", clusterType: "REPLICASET", mongoVersion: "7.0.12", srv: null, standard: null, privateSrv: null },
  ]),
}));
vi.mock("../stores/vault.svelte", () => ({ vault: { ensure: vi.fn() } }));

import * as api from "../api/atlas";
import { prefs } from "../stores/prefs.svelte";
import { connectionPrefill } from "../stores/connectionPrefill";
import AtlasBrowser from "./AtlasBrowser.svelte";

beforeEach(() => {
  vi.clearAllMocks();
  prefs.clear();
  connectionPrefill.take();
});

describe("AtlasBrowser", () => {
  it("signs in with a Service Account, lists clusters and hands the SRV string to the connection form", async () => {
    const onpick = vi.fn();
    const { getByLabelText, findByText, getAllByText, queryByDisplayValue } = render(AtlasBrowser, { props: { onpick } });
    await fireEvent.input(getByLabelText("Client ID"), { target: { value: "mdb_sa_id_1" } });
    await fireEvent.input(getByLabelText("Client secret"), { target: { value: "s3cret" } });
    await fireEvent.click(getAllByText("Sign in").find((e) => e.tagName === "BUTTON")!);
    await findByText("Cluster0");
    expect(api.atlasSaveCredentials).toHaveBeenCalledWith("mdb_sa_id_1", "s3cret");
    expect(queryByDisplayValue("s3cret")).toBeNull(); // the field is cleared once stored
    await fireEvent.click(getAllByText("Use")[0]);
    expect(onpick).toHaveBeenCalledWith("mongodb+srv://cluster0.ab1cd.mongodb.net", "Cluster0");
    expect(connectionPrefill.take()).toEqual({ uri: "mongodb+srv://cluster0.ab1cd.mongodb.net", label: "Cluster0" });
  });

  it("a cluster without a connection string cannot be used", async () => {
    const { getByLabelText, findByText, getAllByText } = render(AtlasBrowser, { props: { onpick: vi.fn() } });
    await fireEvent.input(getByLabelText("Client ID"), { target: { value: "id" } });
    await fireEvent.input(getByLabelText("Client secret"), { target: { value: "s" } });
    await fireEvent.click(getAllByText("Sign in").find((e) => e.tagName === "BUTTON")!);
    await findByText("Paused");
    expect(getAllByText("Use")).toHaveLength(1);
    await waitFor(() => expect(getAllByText(/No connection string/).length).toBeGreaterThan(0));
  });
});
