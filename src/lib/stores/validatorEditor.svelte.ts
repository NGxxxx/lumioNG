// State + actions for the visual $jsonSchema validator editor (tree <-> JSON, sample, test on data, gated save).
import { sampleDocuments, countDocuments } from "../api/documents";
import { errorMessage } from "../api/errors";
import { findCmd } from "../domain/mongosh";
import { inferSchema } from "../domain/schema";
import {
  parseJsonSchema, toJsonSchema, fromSampledSchema, emptyNode, addProperty, removeProperty,
  renameProperty, setRequired, updateAt, splitValidator, joinValidator, violatorsFilter, jsonEqual, schemaIsOpaque,
  type SchemaNode, type NodePath,
} from "../domain/jsonSchemaModel";
import { createDestructiveGate } from "./destructiveGate.svelte";
import { sessionEnvironment } from "./sessionEnv";
import { settings } from "./settings.svelte";

export const VIOLATOR_PREVIEW = 20;
const SAMPLE_SIZE = 100;

export function createValidatorEditor(args: {
  sessionId: string; db: string; coll: string;
  /** The stored validator (whole document, `$jsonSchema` plus any other operators), or null. */
  validatorJson: string | null;
  level: string; action: string;
  /** Persists the validator (collectionInfo.saveValidator); resolves false on failure. */
  save: (validatorJson: string, level: string, action: string) => Promise<boolean>;
}) {
  const { sessionId, db, coll } = args;
  let root = $state<SchemaNode>(emptyNode());
  let rest = $state<Record<string, unknown>>({});
  /** The validator as it would be saved once edited (tree edits re-serialise it; JSON edits set it as typed). */
  let current = $state.raw<Record<string, unknown>>({});
  let hasSchema = $state(false);
  /** `$jsonSchema` present but not an object: the tree cannot represent it, so only the JSON tab edits. */
  let locked = $state(false);
  /** False until a tree edit or a JSON edit that really changes the value: an untouched validator is saved as stored. */
  let dirty = $state(false);
  let loadError = $state<string | null>(null);
  let jsonText = $state("{}");
  let jsonError = $state<string | null>(null);
  let level = $state(args.level);
  let action = $state(args.action);
  let violators = $state<number | null>(null);
  let busy = $state<"sample" | "test" | null>(null);
  let error = $state<string | null>(null);
  const destructive = createDestructiveGate(() => sessionEnvironment(sessionId));

  let original: unknown = {};
  function adopt(v: Record<string, unknown>) {
    const { schema, rest: r } = splitValidator(v);
    current = v;
    rest = r;
    hasSchema = schema !== null;
    locked = schemaIsOpaque(schema);
    root = schema !== null && !locked ? parseJsonSchema(schema) : emptyNode();
  }

  function load(text: string | null) {
    try {
      original = text && text.trim() ? JSON.parse(text) : {};
      if (original === null || typeof original !== "object" || Array.isArray(original)) throw new Error("Stored validator is not a JSON object");
      adopt(original as Record<string, unknown>);
    } catch (e) {
      original = undefined;
      loadError = e instanceof Error ? e.message : String(e);
    }
    jsonText = text && text.trim() ? text : "{}";
  }
  load(args.validatorJson);

  /** Tree edit: applies `fn` to the root and rewrites the JSON text. No-op while the schema is opaque. */
  function edit(fn: (r: SchemaNode) => SchemaNode) {
    if (locked || loadError) return;
    root = fn(root);
    hasSchema = true;
    current = joinValidator(toJsonSchema(root), rest);
    dirty = true;
    jsonText = JSON.stringify(current, null, 2);
    jsonError = null;
    violators = null;
  }

  /** JSON tab edit: a valid object replaces the tree; anything else keeps the tree and reports the error. */
  function setJsonText(text: string) {
    jsonText = text;
    try {
      const v: unknown = JSON.parse(text);
      if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("Validator must be a JSON object");
      adopt(v as Record<string, unknown>);
      dirty = original === undefined || !jsonEqual(v, original);
      loadError = null;
      jsonError = null;
      violators = null;
    } catch (e) {
      jsonError = e instanceof Error ? e.message : String(e);
    }
  }

  async function createFromSample() {
    if (locked || loadError) return;
    busy = "sample";
    error = null;
    try {
      const docs = await sampleDocuments(sessionId, db, coll, "{}", SAMPLE_SIZE, settings.queryTimeoutMs);
      const node = fromSampledSchema(inferSchema(docs), { requiredThreshold: 0.99 });
      edit(() => node);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = null;
    }
  }

  const violatorsFilterJson = () => JSON.stringify(violatorsFilter(current));

  /** Counts the documents that break the schema in the tree. */
  async function testOnData() {
    busy = "test";
    error = null;
    violators = null;
    try {
      violators = await countDocuments(sessionId, db, coll, violatorsFilterJson(), settings.queryTimeoutMs);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = null;
    }
  }

  /** mongosh statement for a Query tab that lists the first violators. */
  function violatorsStatement(): string {
    return findCmd({ coll, filter: violatorsFilterJson(), limit: VIOLATOR_PREVIEW });
  }

  /** Saves (PROD asks first). Blocked while the JSON tab holds unparsable text. */
  async function requestSave() {
    if (jsonError || loadError) return;
    // Untouched: send the stored text as-is (only level/action change). Edited: send the edited value.
    const json = dirty ? JSON.stringify(current) : (args.validatorJson?.trim() ? args.validatorJson : "{}");
    const run = async () => {
      if (!(await args.save(json, level, action))) throw new Error("save failed");
    };
    await destructive.request(
      { op: "setValidator", target: { db, coll }, undoable: true, skipConfirm: sessionEnvironment(sessionId) !== "prod" },
      run,
    );
  }

  return {
    get root() { return root; },
    get jsonText() { return jsonText; },
    get jsonError() { return jsonError; },
    get level() { return level; },
    set level(v: string) { level = v; },
    get action() { return action; },
    set action(v: string) { action = v; },
    get violators() { return violators; },
    get busy() { return busy; },
    get error() { return error; },
    get validatorJson() { return JSON.stringify(current); },
    get dirty() { return dirty; },
    get locked() { return locked; },
    /** Why Save is blocked: the stored validator is unreadable, or the JSON tab holds invalid text. */
    get loadError() { return loadError; },
    /** The PROD confirmation (rendered by DestructiveDialog). */
    get destructive() { return destructive; },
    edit,
    setJsonText,
    update: (path: NodePath, patch: Partial<SchemaNode>) => edit((r) => updateAt(r, path, patch)),
    addField: (path: NodePath, name: string) => edit((r) => addProperty(r, path, name)),
    removeField: (path: NodePath, name: string) => edit((r) => removeProperty(r, path, name)),
    renameField: (path: NodePath, from: string, to: string) => edit((r) => renameProperty(r, path, from, to)),
    setRequired: (path: NodePath, name: string, on: boolean) => edit((r) => setRequired(r, path, name, on)),
    createFromSample,
    testOnData,
    violatorsStatement,
    requestSave,
  };
}
