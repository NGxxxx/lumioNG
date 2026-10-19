import { describe, it, expect } from "vitest";
import {
  clientSnippets, endpointUrl, exposedSessions, generateToken, isValidPort, isValidToken, pushActivity, MAX_ACTIVITY,
  type McpActivity,
} from "./mcp";

describe("mcp domain", () => {
  it("validates ports in the unprivileged range", () => {
    expect(isValidPort(7737)).toBe(true);
    expect(isValidPort(80)).toBe(false);
    expect(isValidPort(70000)).toBe(false);
    expect(isValidPort(1.5)).toBe(false);
  });

  it("mints 48-char hex tokens that pass validation", () => {
    const t = generateToken((a) => a.fill(171));
    expect(t).toBe("ab".repeat(24));
    expect(isValidToken(generateToken())).toBe(true);
    expect(generateToken()).not.toBe(generateToken());
  });

  it("rejects short or spaced tokens", () => {
    expect(isValidToken("short")).toBe(false);
    expect(isValidToken("has space in the middle!!")).toBe(false);
    expect(isValidToken("  0123456789abcdef  ")).toBe(true);
  });

  it("builds an endpoint and one snippet per client, all carrying url and token", () => {
    expect(endpointUrl(7737)).toBe("http://127.0.0.1:7737/mcp");
    const snippets = clientSnippets(7737, "tok123");
    expect(snippets.map((s) => s.id)).toEqual(["claude-code", "claude-desktop", "cursor", "vscode"]);
    for (const s of snippets) {
      expect(s.text).toContain("http://127.0.0.1:7737/mcp");
      expect(s.text).toContain("Bearer tok123");
      if (s.kind === "json") expect(() => JSON.parse(s.text)).not.toThrow();
    }
    expect(snippets[0].text).toBe('claude mcp add --transport http lumiong http://127.0.0.1:7737/mcp --header "Authorization: Bearer tok123"');
    expect(JSON.parse(snippets[3].text).servers.lumiong.type).toBe("http");
  });

  it("exposes only connected sessions", () => {
    const out = exposedSessions([
      { id: "a", label: "Local", status: "connected", environment: "dev", readOnly: false },
      { id: "b", label: "Down", status: "error", environment: "", readOnly: false },
    ]);
    expect(out).toEqual([{ id: "a", label: "Local", environment: "dev", readOnly: false }]);
  });

  it("keeps activity newest first and bounded", () => {
    const a = (tool: string): McpActivity => ({ tool, connection: null, ok: true, ms: 1, error: null });
    let list: McpActivity[] = [];
    for (let i = 0; i < MAX_ACTIVITY + 5; i++) list = pushActivity(list, a(`t${i}`));
    expect(list).toHaveLength(MAX_ACTIVITY);
    expect(list[0].tool).toBe(`t${MAX_ACTIVITY + 4}`);
  });
});
