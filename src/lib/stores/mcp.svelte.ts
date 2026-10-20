import { untrack } from "svelte";
import { startMcp, stopMcp, setMcpSessions } from "../api/mcp";
import { errorMessage } from "../api/errors";
import {
  DEFAULT_MCP_PORT, cleanFields, generateToken, isValidPort, isValidToken, parseRedactFields, pushActivity,
  type McpActivity, type McpSession,
} from "../domain/mcp";
import { prefs } from "./prefs.svelte";

const ENABLED_KEY = "mcp-enabled";
const PORT_KEY = "mcp-port";
const WRITES_KEY = "mcp-allow-writes";
const TOKEN_KEY = "mcp-token";
const REDACT_KEY = "mcp-redact-fields";
const AUDIT_READS_KEY = "mcp-audit-reads";

export type McpState = "off" | "starting" | "running" | "error";

function read(key: string): string | null {
  try {
    return prefs.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    prefs.setItem(key, value);
  } catch {
    /* storage unavailable — keep the in-memory value */
  }
}

/** Built-in MCP server: persisted on/off + settings, live status, and recent tool calls. */
export function createMcp() {
  const readPort = () => {
    const p = Number(read(PORT_KEY));
    return isValidPort(p) ? p : DEFAULT_MCP_PORT;
  };
  const readToken = () => {
    const t = read(TOKEN_KEY);
    if (t && isValidToken(t)) return t;
    const fresh = generateToken();
    write(TOKEN_KEY, fresh);
    return fresh;
  };
  let enabled = $state(untrack(() => read(ENABLED_KEY) === "true"));
  let port = $state(untrack(readPort));
  let allowWrites = $state(untrack(() => read(WRITES_KEY) === "true"));
  let token = $state(untrack(readToken));
  let redactFields = $state.raw<string[]>(untrack(() => parseRedactFields(read(REDACT_KEY))));
  let auditReads = $state(untrack(() => read(AUDIT_READS_KEY) === "true"));
  // The singleton is created while prefs.json is still loading; re-read once it is in.
  prefs.afterHydrate(() => {
    enabled = read(ENABLED_KEY) === "true";
    port = readPort();
    allowWrites = read(WRITES_KEY) === "true";
    token = readToken();
    redactFields = parseRedactFields(read(REDACT_KEY));
    auditReads = read(AUDIT_READS_KEY) === "true";
  });
  let status = $state<McpState>("off");
  let error = $state<string | null>(null);
  let activity = $state.raw<McpActivity[]>([]);
  let calls = $state(0);
  let lastSessions = "";
  let seq = 0;

  function onActivity(a: McpActivity) {
    activity = pushActivity(activity, a);
    calls++;
  }

  /** Starts (or restarts) with the current settings; a superseded attempt's result is dropped. */
  async function start() {
    const my = ++seq;
    status = "starting";
    error = null;
    try {
      await startMcp(port, token, allowWrites, onActivity, redactFields, auditReads);
      if (my === seq) status = "running";
    } catch (e) {
      if (my !== seq) return;
      status = "error";
      error = errorMessage(e);
    }
  }

  async function stop() {
    ++seq;
    status = "off";
    error = null;
    try {
      await stopMcp();
    } catch {
      /* already stopped */
    }
  }

  /** Applies a settings change: restart only while it is meant to be on. */
  function restartIfOn() {
    if (enabled) void start();
  }

  return {
    get enabled() { return enabled; },
    get port() { return port; },
    get allowWrites() { return allowWrites; },
    get token() { return token; },
    get redactFields() { return redactFields; },
    get auditReads() { return auditReads; },
    get status() { return status; },
    get error() { return error; },
    get activity() { return activity; },
    get calls() { return calls; },
    /** Called once at app start: brings the server back if it was on last time. */
    init() {
      if (enabled) void start();
    },
    setEnabled(v: boolean) {
      enabled = v;
      write(ENABLED_KEY, v ? "true" : "false");
      void (v ? start() : stop());
    },
    toggle() {
      this.setEnabled(!enabled);
    },
    /** Returns false (and changes nothing) for an invalid port. */
    setPort(p: number): boolean {
      if (!isValidPort(p)) return false;
      if (p === port) return true;
      port = p;
      write(PORT_KEY, String(p));
      restartIfOn();
      return true;
    },
    setAllowWrites(v: boolean) {
      allowWrites = v;
      write(WRITES_KEY, v ? "true" : "false");
      restartIfOn();
    },
    /** Field-name patterns whose values MCP results hide ("[redacted]"). */
    setRedactFields(fields: string[]) {
      redactFields = cleanFields(fields);
      write(REDACT_KEY, JSON.stringify(redactFields));
      restartIfOn();
    },
    /** Also audit MCP read calls (writes are always audited). */
    setAuditReads(v: boolean) {
      auditReads = v;
      write(AUDIT_READS_KEY, v ? "true" : "false");
      restartIfOn();
    },
    /** New token: every configured client must be updated, so the old one stops working at once. */
    regenerateToken() {
      token = generateToken();
      write(TOKEN_KEY, token);
      restartIfOn();
    },
    clearActivity() {
      activity = [];
    },
    /** Pushes the exposed connection list to the backend when it actually changed. */
    syncSessions(list: McpSession[]) {
      const key = JSON.stringify(list);
      if (key === lastSessions) return;
      lastSessions = key;
      setMcpSessions(list).catch(() => { lastSessions = ""; });
    },
  };
}

export const mcp = createMcp();
