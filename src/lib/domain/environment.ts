/** Connection environment label; "" means unlabeled. */
export type Environment = "" | "dev" | "staging" | "prod";

export const ENV_META: Record<Environment, { short: string; tone: "danger" | "warn" | "ok" | null }> = {
  "": { short: "", tone: null },
  dev: { short: "DEV", tone: "ok" },
  staging: { short: "STG", tone: "warn" },
  prod: { short: "PROD", tone: "danger" },
};

const PROD = new Set(["prod", "production"]);
const STAGING = new Set(["stag", "staging", "uat", "preprod"]);
const DEV = new Set(["dev", "local", "localhost"]);

/** Guess an environment from a connection label and host (whole-word, case-insensitive); prod wins, no hint → null. */
export function suggestEnvironment(label: string, host: string): Environment | null {
  const text = `${label} ${host}`.toLowerCase();
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((w) => PROD.has(w))) return "prod";
  if (words.some((w) => STAGING.has(w))) return "staging";
  if (words.some((w) => DEV.has(w)) || /(^|[^0-9.])127\.0\.0\.1($|[^0-9])/.test(text)) return "dev";
  return null;
}
