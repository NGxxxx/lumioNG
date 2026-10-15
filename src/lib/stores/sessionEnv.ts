// src/lib/stores/sessionEnv.ts — session id → environment, written by sessionManager. Lets stores that
// sessionManager itself (indirectly) imports look up the environment without an import cycle.
import type { Environment } from "../domain/environment";

const envs = new Map<string, Environment>();

export function setSessionEnvironment(id: string, env: Environment | null) {
  if (env === null) envs.delete(id);
  else envs.set(id, env);
}

/** "" when the session is unknown or unlabeled. */
export function sessionEnvironment(id: string): Environment {
  return envs.get(id) ?? "";
}
