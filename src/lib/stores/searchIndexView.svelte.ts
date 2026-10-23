import { atlasVersion, listSearchIndexes, createSearchIndex, updateSearchIndex, dropSearchIndex } from "../api/searchIndexes";
import { errorMessage, rawErrorText } from "../api/errors";
import {
  isAtlasUri, isSearchUnsupported, parseSearchIndexList, validateSearchDefinition, SEARCH_TEMPLATES,
  type SearchDefinitionProblem, type SearchIndexRow, type SearchIndexType, type SearchTemplate,
} from "../domain/atlas";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { createDestructiveGate } from "./destructiveGate.svelte";
import { sessionEnvironment } from "./sessionEnv";
import { atlasDetect } from "./atlasDetect";
import { createAsyncGuard } from "./asyncGuard.svelte";
import * as m from "#lib/paraglide/messages.js";

export interface SearchEditor {
  mode: "create" | "edit";
  name: string;
  type: SearchIndexType;
  definition: string;
}

const quote = (s: string) => JSON.stringify(s);

/** State and actions for the Search index tab: Atlas detection, the index list and the definition editor. */
export function createSearchIndexView(sessionId: string, db: string, coll: string, uri: string | undefined) {
  // A *.mongodb.net host is Atlas without asking; any other server is probed with `atlasVersion`.
  let isAtlas = $state(isAtlasUri(uri) || atlasDetect.get(sessionId) === true);
  let rows = $state.raw<SearchIndexRow[]>([]);
  let unsupported = $state(false);
  let loaded = $state(false);
  let editor = $state<SearchEditor | null>(null);
  let problem = $state<SearchDefinitionProblem | null>(null);
  let saving = $state(false);
  const guard = createAsyncGuard();
  const destructive = createDestructiveGate(() => sessionEnvironment(sessionId));

  /** Settles whether the server is Atlas; a failing probe means "no", never an error. */
  async function detect(): Promise<boolean> {
    if (isAtlas) return true;
    const cached = atlasDetect.get(sessionId);
    if (cached !== undefined) return (isAtlas = cached);
    try {
      isAtlas = (await atlasVersion(sessionId)) !== null;
    } catch {
      return false; // transient: do not cache a failed probe
    }
    atlasDetect.set(sessionId, isAtlas);
    return isAtlas;
  }

  async function refresh() {
    const gen = guard.begin();
    try {
      const raw = await commandLog.pushTimed(`db.getCollection(${quote(coll)}).aggregate([{ $listSearchIndexes: {} }])`, sessionId, () =>
        listSearchIndexes(sessionId, db, coll));
      if (!guard.isCurrent(gen)) return;
      rows = parseSearchIndexList(raw);
      unsupported = false;
      guard.setError(null);
    } catch (e) {
      if (!guard.isCurrent(gen)) return;
      if (isSearchUnsupported(rawErrorText(e))) {
        unsupported = true;
        rows = [];
        guard.setError(null);
      } else {
        guard.setError(errorMessage(e));
      }
    } finally {
      loaded = true;
      guard.finish(gen);
    }
  }

  /** Called when the tab is opened. */
  async function load() {
    if (loaded) return;
    await refresh();
  }

  function template(id: SearchTemplate["id"]): SearchTemplate {
    return SEARCH_TEMPLATES.find((t) => t.id === id) ?? SEARCH_TEMPLATES[0];
  }

  function openCreate(templateId: SearchTemplate["id"] = "dynamic") {
    const t = template(templateId);
    editor = { mode: "create", name: "", type: t.type, definition: t.definition };
    problem = null;
  }

  function openEdit(name: string) {
    const r = rows.find((x) => x.name === name);
    if (!r) return;
    editor = { mode: "edit", name: r.name, type: r.type === "vectorSearch" ? "vectorSearch" : "search", definition: r.definition };
    problem = null;
  }

  function applyTemplate(id: SearchTemplate["id"]) {
    if (!editor || editor.mode !== "create") return;
    const t = template(id);
    editor = { ...editor, type: t.type, definition: t.definition };
    problem = null;
  }

  function setDefinition(text: string) {
    if (editor) editor = { ...editor, definition: text };
    problem = null;
  }
  function setName(name: string) {
    if (editor) editor = { ...editor, name };
  }
  function setType(type: SearchIndexType) {
    if (editor && editor.mode === "create") editor = { ...editor, type };
    problem = null;
  }
  function closeEditor() {
    if (!saving) {
      editor = null;
      problem = null;
    }
  }

  async function runWrite(cmdText: string, fn: () => Promise<unknown>) {
    activity.begin(m.common_running());
    try {
      await commandLog.pushTimed(cmdText, sessionId, fn);
    } finally {
      activity.end();
    }
  }

  async function doSave(e: SearchEditor) {
    saving = true;
    try {
      const def = JSON.stringify(JSON.parse(e.definition));
      if (e.mode === "create") {
        const name = e.name.trim() || null;
        await runWrite(
          `db.getCollection(${quote(coll)}).createSearchIndex(${name ? quote(name) + ", " : ""}${quote(e.type)}, ${def})`,
          () => createSearchIndex(sessionId, db, coll, name, e.type, def),
        );
      } else {
        await runWrite(
          `db.getCollection(${quote(coll)}).updateSearchIndex(${quote(e.name)}, ${def})`,
          () => updateSearchIndex(sessionId, db, coll, e.name, def),
        );
      }
      editor = null;
      await refresh();
    } finally {
      saving = false;
    }
  }

  /** Validates, asks for confirmation on PROD, then creates / updates. Errors land in `error`. */
  async function requestSave() {
    const e = editor;
    if (!e || saving) return;
    problem = validateSearchDefinition(e.definition, e.type);
    if (problem) return;
    guard.setError(null);
    try {
      // PROD opens the confirmation (its errors show in the dialog); elsewhere the policy runs it at once.
      await destructive.request(
        { op: "searchIndexWrite", target: { db, coll, index: e.name || undefined, detail: e.mode === "edit" ? e.name : undefined } },
        () => doSave(e),
      );
    } catch (err) {
      guard.setError(errorMessage(err));
    }
  }

  /** Dropping always asks, and on every environment the index name must be typed. */
  function requestDrop(name: string) {
    void destructive.request({ op: "dropIndex", target: { db, coll, index: name } }, async () => {
      await runWrite(`db.getCollection(${quote(coll)}).dropSearchIndex(${quote(name)})`, () => dropSearchIndex(sessionId, db, coll, name));
      await refresh();
    });
  }

  return {
    get isAtlas() { return isAtlas; },
    get rows() { return rows; },
    get unsupported() { return unsupported; },
    get loaded() { return loaded; },
    get loading() { return guard.loading; },
    get error() { return guard.error; },
    get editor() { return editor; },
    get problem() { return problem; },
    get saving() { return saving; },
    get destructive() { return destructive; },
    detect,
    load,
    refresh,
    openCreate,
    openEdit,
    applyTemplate,
    setDefinition,
    setName,
    setType,
    closeEditor,
    requestSave,
    requestDrop,
  };
}
