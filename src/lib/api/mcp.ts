import { invoke, Channel } from "@tauri-apps/api/core";
import type { McpActivity, McpSession } from "../domain/mcp";

export type McpStatus = { running: boolean; port: number | null; allowWrites: boolean };

/** (Re)starts the built-in MCP server on 127.0.0.1:`port`; every tool call is reported to `onActivity`.
 *  `redactFields` are field-name patterns whose values results hide; `auditReads` also audits read calls. */
export async function startMcp(
  port: number,
  token: string,
  allowWrites: boolean,
  onActivity: (a: McpActivity) => void,
  redactFields: string[] = [],
  auditReads = false,
): Promise<McpStatus> {
  const ch = new Channel<McpActivity>();
  ch.onmessage = onActivity;
  return await invoke<McpStatus>("mcp_start", { port, token, allowWrites, onActivity: ch, redactFields, auditReads });
}

export async function stopMcp(): Promise<void> {
  await invoke("mcp_stop");
}

export async function getMcpStatus(): Promise<McpStatus> {
  return await invoke<McpStatus>("mcp_status");
}

/** Replaces the connections MCP clients can see. */
export async function setMcpSessions(sessions: McpSession[]): Promise<void> {
  await invoke("mcp_set_sessions", { sessions });
}
