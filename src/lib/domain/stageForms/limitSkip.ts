import type { StageCodec } from "./types";

export const limitSkipCodec: StageCodec<number> = {
  parse: (body) => (typeof body === "number" && Number.isInteger(body) && body >= 0 ? body : null),
  build: (m) => m,
  summarize: (m) => String(m),
};
