// Wires the session health monitor to the app's real session manager, backend ping and toasts.
import { sessionPing } from "../api/connection";
import { sessionManager } from "./sessionManager.svelte";
import { createSessionHealth } from "./sessionHealth.svelte";
import { toast } from "./toast.svelte";
import * as m from "#lib/paraglide/messages.js";

const DEGRADED_TOAST_MS = 10_000;

/** Starts monitoring every open session; returns the function that stops it. */
export function startSessionHealth(): () => void {
  const health = createSessionHealth({
    ping: sessionPing,
    sessions: () => sessionManager.sessions,
    setStatus: sessionManager.setHealth,
    reconnect: sessionManager.reconnect,
    onDegraded: (id, cause) => {
      const label = sessionManager.sessions.find((s) => s.id === id)?.label ?? id;
      const message = cause.sshEndpoint
        ? m.session_degraded_ssh_toast({ label, endpoint: cause.sshEndpoint })
        : m.session_degraded_toast({ label });
      toast.push(message, "error", DEGRADED_TOAST_MS, {
        label: m.session_reconnect_action(),
        // reconnectNow ignores the click while a reconnect for this session is already running.
        run: () => void health.reconnectNow(id),
      });
    },
  });
  return health.start();
}
