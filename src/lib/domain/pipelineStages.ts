/** Converts between a Query tab's runnable aggregate script and the Pipeline Tree editor's stage
 *  list. Parsing (script → stages) is intentionally all-or-nothing: anything the mongosh-literal
 *  parser can't handle, or that isn't a single bare `aggregate([...])` call, fails the whole
 *  parse — callers fall back to script-only editing rather than rendering a partially-understood
 *  pipeline. */
import { methodHeadAt } from "./queryStatement";
import { parseMongoshValue } from "./mongoshLiteral";
import { PIPELINE_STAGES } from "./mongoOps";
import { describeValue } from "./extjson";
import { hasInput } from "./bsontree";

export interface StageEntry {
  /** Stable across edits/reorders — used as the Svelte `{#each}` key and the preview cache key. */
  id: string;
  /** Stage operator name including the leading "$", e.g. "$match". */
  name: string;
  body: unknown;
}

let nextStageId = 0;
/** Mints a fresh, unique stage id (monotonic counter — uniqueness is all that's required). */
export function newStageId(): string {
  return `stage-${nextStageId++}`;
}

const STAGE_NAMES = new Set(PIPELINE_STAGES.map((s) => s.label));

/** Reduces one raw pipeline-array element (`{ "$match": {...} }`) to a stage entry; `null` if it
 *  isn't a single-key object naming a known stage. */
function pipelineElementToEntry(raw: unknown): { name: string; body: unknown } | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const keys = Object.keys(raw as Record<string, unknown>);
  if (keys.length !== 1 || !STAGE_NAMES.has(keys[0])) return null;
  return { name: keys[0], body: (raw as Record<string, unknown>)[keys[0]] };
}

export interface ParsedPipeline {
  ok: true;
  coll: string;
  stages: StageEntry[];
}
export interface ParsePipelineFailure {
  ok: false;
}

/** Recovers `{ coll, stages }` from a script that is *only* a single
 *  `db.getCollection("coll").aggregate([...])` (or `db.coll.aggregate([...])`) call whose pipeline
 *  argument the mongosh-literal parser accepts. Anything else fails. */
export function parsePipelineFromScript(script: string): ParsedPipeline | ParsePipelineFailure {
  if (script.trim().length === 0) return { ok: false };
  const head = methodHeadAt(script, script.length);
  if (!head || head.method !== "aggregate") return { ok: false };
  if (script.slice(0, head.start).trim().length > 0) return { ok: false }; // anything before the call — reject rather than silently ignore it

  const result = parseMongoshValue(script, head.argOpen + 1);
  if (!result.ok || !Array.isArray(result.value)) return { ok: false };

  let end = result.end;
  while (end < script.length && /\s/.test(script[end])) end++;
  if (script[end] !== ")") return { ok: false };
  end++;
  while (end < script.length && /[\s;]/.test(script[end])) end++;
  if (end !== script.length) return { ok: false };

  const stages: StageEntry[] = [];
  for (const raw of result.value) {
    const entry = pipelineElementToEntry(raw);
    if (entry === null) return { ok: false };
    stages.push({ id: newStageId(), ...entry });
  }
  return { ok: true, coll: head.coll, stages };
}

/** Rebuilds runnable script text from a stage list — the inverse of `parsePipelineFromScript`. */
export function stagesToScript(coll: string, stages: StageEntry[]): string {
  const pipeline = stages.map((s) => ({ [s.name]: s.body }));
  return `db.getCollection("${coll}").aggregate(\n${JSON.stringify(pipeline, null, 2)}\n)`;
}

/** Whether a stage's body renders as a `TreeEditor` (plain object) or a single `TreeLeafInput`
 *  (scalar) — decided by the value's own shape, not by which operator it is, so every stage
 *  (including ones with more than one valid body shape, e.g. `$unwind`) works uniformly. `null`
 *  when the value is neither (e.g. a bare array stage body) — callers show a read-only fallback. */
export function stageBodyKind(value: unknown): "object" | "leaf" | null {
  const type = describeValue(value).type;
  if (hasInput(type)) return "leaf";
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return "object";
  return null;
}

/** Default body inserted when the user picks a stage operator from the "Add stage" dropdown. */
export function defaultStageBody(name: string): unknown {
  switch (name) {
    case "$limit":
    case "$skip":
      return 10;
    case "$count":
      return "total";
    case "$unwind":
    case "$sortByCount":
      return "$field";
    case "$sample":
      return { size: 10 };
    case "$out":
      return "REPLACE_WITH_COLLECTION_NAME";
    case "$replaceRoot":
      return { newRoot: "$field" };
    default:
      return {};
  }
}

/** Whether `body` is still exactly the freshly-added default for stage `name` — true right after
 *  a stage is added or its operator changed, false as soon as the user edits anything. Used to
 *  decide whether changing a stage's operator needs a confirm dialog (nothing to lose vs. real
 *  content about to be discarded). */
export function isDefaultStageBody(name: string, body: unknown): boolean {
  return JSON.stringify(body) === JSON.stringify(defaultStageBody(name));
}
