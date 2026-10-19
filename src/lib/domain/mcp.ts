/** Pure helpers for the built-in MCP server: settings validation, token minting, and the
 *  copy-paste snippets that register it with each AI client. */

/** Unassigned by IANA and unlikely to clash with a dev server. */
export const DEFAULT_MCP_PORT = 7737;
export const MCP_SERVER_NAME = "lumiong";
/** Matches the Rust side's minimum (commands/mcp.rs). */
export const MIN_TOKEN_LEN = 16;
export const MAX_ACTIVITY = 50;

export type McpSession = { id: string; label: string; environment: string; readOnly: boolean };
export type McpActivity = { tool: string; connection: string | null; ok: boolean; ms: number; error: string | null };
export type McpClientId = "claude-code" | "claude-desktop" | "cursor" | "vscode";
export type McpSnippet = { id: McpClientId; label: string; kind: "shell" | "json"; text: string };

export function isValidPort(n: number): boolean {
  return Number.isInteger(n) && n >= 1024 && n <= 65535;
}

/** 48 hex chars of randomness; `fill` is injectable for tests. */
export function generateToken(fill: (a: Uint8Array<ArrayBuffer>) => Uint8Array = (a) => crypto.getRandomValues(a)): string {
  return Array.from(fill(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isValidToken(t: string): boolean {
  return t.trim().length >= MIN_TOKEN_LEN && !/\s/.test(t.trim());
}

export function endpointUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

/** Registration snippets for the common MCP clients. Claude Desktop only speaks stdio, so it goes
 *  through the `mcp-remote` bridge (the header is passed via env to survive Windows arg quoting). */
export function clientSnippets(port: number, token: string): McpSnippet[] {
  const url = endpointUrl(port);
  const auth = `Bearer ${token}`;
  const json = (v: unknown) => JSON.stringify(v, null, 2);
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      kind: "shell",
      text: `claude mcp add --transport http ${MCP_SERVER_NAME} ${url} --header "Authorization: ${auth}"`,
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      kind: "json",
      text: json({
        mcpServers: {
          [MCP_SERVER_NAME]: {
            command: "npx",
            args: ["-y", "mcp-remote", url, "--header", "Authorization:${LUMIO_AUTH}"],
            env: { LUMIO_AUTH: auth },
          },
        },
      }),
    },
    {
      id: "cursor",
      label: "Cursor",
      kind: "json",
      text: json({ mcpServers: { [MCP_SERVER_NAME]: { url, headers: { Authorization: auth } } } }),
    },
    {
      id: "vscode",
      label: "VS Code",
      kind: "json",
      text: json({ servers: { [MCP_SERVER_NAME]: { type: "http", url, headers: { Authorization: auth } } } }),
    },
  ];
}

/** The connections MCP may see: connected sessions only, labelled as in the app. */
export function exposedSessions(
  sessions: readonly { id: string; label: string; status: string; environment: string; readOnly: boolean }[],
): McpSession[] {
  return sessions
    .filter((s) => s.status === "connected")
    .map((s) => ({ id: s.id, label: s.label, environment: s.environment, readOnly: s.readOnly }));
}

/** Newest first, bounded. */
export function pushActivity(list: readonly McpActivity[], a: McpActivity, max = MAX_ACTIVITY): McpActivity[] {
  return [a, ...list].slice(0, max);
}
