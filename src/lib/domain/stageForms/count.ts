import type { StageCodec } from "./types";

export const countCodec: StageCodec<string> = {
  parse: (body) => (typeof body === "string" && body.length > 0 ? body : null),
  build: (m) => m,
  summarize: (m) => `as ${m}`,
};
