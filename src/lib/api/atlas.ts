import { invoke } from "@tauri-apps/api/core";
import type { AtlasCluster, AtlasProject } from "../domain/atlas";

/** Proxy settings in the shape `ProxyConfig` expects (`kind` is "http" | "socks5"); null goes direct. */
export interface AtlasProxy {
  kind: string;
  host: string;
  port: number;
  user: string;
  password: string;
}

/** Whether a client secret is stored for this Service Account (the secret itself never comes back). */
export async function atlasHasCredentials(clientId: string): Promise<boolean> {
  return await invoke<boolean>("atlas_has_credentials", { clientId });
}

/** Verifies the Service Account against Atlas, then stores its secret. Resolves "keychain" or "vault". */
export async function atlasSaveCredentials(clientId: string, clientSecret: string, proxy: AtlasProxy | null = null): Promise<"keychain" | "vault"> {
  return await invoke<"keychain" | "vault">("atlas_save_credentials", { clientId, clientSecret, proxy });
}

export async function atlasForgetCredentials(clientId: string): Promise<void> {
  await invoke("atlas_forget_credentials", { clientId });
}

export async function atlasListProjects(clientId: string, proxy: AtlasProxy | null = null): Promise<AtlasProject[]> {
  return await invoke<AtlasProject[]>("atlas_list_projects", { clientId, proxy });
}

export async function atlasListClusters(clientId: string, groupId: string, proxy: AtlasProxy | null = null): Promise<AtlasCluster[]> {
  return await invoke<AtlasCluster[]>("atlas_list_clusters", { clientId, groupId, proxy });
}
