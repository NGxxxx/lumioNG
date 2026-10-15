// src/lib/stores/sessionEnv.ts — session id → environment, written by sessionManager. Lets stores that
// sessionManager itself (indirectly) imports look up the environment without an import cycle.
import type { Environment } from "../domain/environment";

const envs = new Map<string, Environment>();

export function setSessionEnvironment(id: string, env: Environment | null) {
  if (env === null) envs.delete(id);
  else envs.set(id, env);
}

const metas = new Map<string, { label: string; connId: number | null }>();

/** Label and saved-connection id of a session (for history entries). */
export function setSessionMeta(id: string, meta: { label: string; connId: number | null } | null) {
  if (meta === null) metas.delete(id);
  else metas.set(id, meta);
}

export function sessionMeta(id: string): { label: string; connId: number | null } {
  return metas.get(id) ?? { label: id, connId: null };
}

/** "" when the session is unknown or unlabeled. */
export function sessionEnvironment(id: string): Environment {
  return envs.get(id) ?? "";
}
