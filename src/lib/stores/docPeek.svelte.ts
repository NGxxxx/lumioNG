// src/lib/stores/docPeek.svelte.ts — state + actions for the grid's quick-look drawer (view / edit with diff).
import { replaceDocument } from "../api/documents";
import { errorMessage } from "../api/errors";
import { diffDocs, type DocChange } from "../domain/docDiff";
import { idJson } from "../domain/docid";
import type { Doc } from "../domain/doc";
import { replaceCmd } from "../domain/mongosh";
import { commandLog } from "./commandLog.svelte";
import { undo } from "./undo.svelte";

export interface DocPeekDeps {
  sessionId: () => string;
  db: () => string | null;
  /** Collection the documents came from; null for results with no single source (aggregations). */
  coll: () => string | null;
  /** Fetches the full document (the grid may hold a projected copy). */
  loadFull: (d: Doc) => Promise<Doc>;
  readOnly: () => boolean;
  /** Called with the saved document so the host can replace its grid row. */
  onSaved: (saved: Doc) => void;
}

/** A pending "unsaved changes" question: closing the drawer, or switching it to another document. */
export type PeekConfirm = "close" | "switch";

export function createDocPeek(deps: DocPeekDeps) {
  let open = $state(false);
  let mode = $state<"view" | "edit">("view");
  // Documents can be large: raw state, always reassigned whole.
  let doc = $state.raw<Doc | null>(null);
  let draft = $state.raw<Doc | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let saving = $state(false);
  let stale = $state(false);
  let confirm = $state<PeekConfirm | null>(null);
  // Where the shown document came from — captured at show time, so a later re-run or navigation in
  // the host can never redirect a save to a different collection.
  let source = $state.raw<{ db: string | null; coll: string | null } | null>(null);
  // The grid row the drawer was opened from (identity tells sync() whether the row changed) and the
  // _id last requested (so following the same document — even after a failed load — never reloads).
  let lastRow: Doc | null = null;
  let lastEdit = false;
  let targetId: string | null = null;
  let pendingTarget: Doc | null = null;
  let loadSeq = 0;

  const changes = $derived<DocChange[]>(mode === "edit" && doc && draft ? diffDocs(doc, draft) : []);
  const dirty = $derived(changes.length > 0);
  const canEdit = $derived(doc !== null && idJson(doc) !== null && (source?.coll ?? null) !== null && !deps.readOnly());

  async function load(d: Doc, edit: boolean) {
    const seq = ++loadSeq;
    open = true;
    loading = true;
    error = null;
    stale = false;
    confirm = null;
    mode = "view";
    draft = null;
    lastRow = d;
    lastEdit = edit;
    targetId = idJson(d);
    source = { db: deps.db(), coll: deps.coll() };
    try {
      const full = await deps.loadFull(d);
      if (seq !== loadSeq) return;
      doc = full;
      if (edit) startEdit();
    } catch (e) {
      if (seq !== loadSeq) return;
      doc = null;
      error = errorMessage(e);
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  function show(d: Doc, edit = false): Promise<void> {
    return load(d, edit);
  }

  /** An undo wrote to `change`'s collection: reload a clean drawer showing it; flag a dirty one. */
  function refreshIfShowing(change: { sessionId: string; db: string; coll: string } | null) {
    if (!change || !open || !source || !lastRow) return;
    if (change.sessionId !== deps.sessionId() || change.db !== source.db || change.coll !== source.coll) return;
    if (dirty) {
      stale = true;
      return;
    }
    void load(lastRow, false);
  }

  /** Re-runs the last load (after a failure). */
  async function retry(): Promise<void> {
    if (lastRow) await load(lastRow, lastEdit);
  }

  /** Re-targets the drawer at another document. With unsaved edits it asks first (returns "dirty"). */
  async function follow(d: Doc): Promise<"ok" | "dirty"> {
    const id = idJson(d);
    if (id !== null && id === targetId) return "ok";
    if (dirty) {
      pendingTarget = d;
      confirm = "switch";
      return "dirty";
    }
    await load(d, false);
    return "ok";
  }

  function reset() {
    loadSeq++;
    open = false;
    mode = "view";
    doc = null;
    draft = null;
    error = null;
    stale = false;
    confirm = null;
    source = null;
    lastRow = null;
    targetId = null;
    pendingTarget = null;
  }

  /** Closes unless there are unsaved edits (returns "dirty" without asking). */
  function close(): "ok" | "dirty" {
    if (dirty) return "dirty";
    reset();
    return "ok";
  }

  /** Closes, or asks Save / Discard / Stay when there are unsaved edits. */
  function requestClose(): "ok" | "dirty" {
    if (!dirty) return close();
    confirm = "close";
    return "dirty";
  }

  /** Carries out what the pending question was about (after Save or Discard). */
  async function continuePending() {
    const kind = confirm;
    const target = pendingTarget;
    confirm = null;
    pendingTarget = null;
    if (kind === "switch" && target) await load(target, false);
    else if (kind === "close") reset();
  }

  async function confirmSave() {
    if (await save()) await continuePending();
  }

  async function confirmDiscard() {
    discard();
    await continuePending();
  }

  function confirmStay() {
    confirm = null;
    pendingTarget = null;
  }

  function startEdit() {
    if (!canEdit || !doc) return;
    draft = doc;
    mode = "edit";
  }

  function setDraft(next: Doc) {
    draft = next;
  }

  function discard() {
    draft = null;
    mode = "view";
    error = null;
  }

  async function save(): Promise<boolean> {
    if (!doc || !draft || saving) return false;
    const id = idJson(doc);
    const db = source?.db ?? null;
    const coll = source?.coll ?? null;
    if (id === null || db === null || coll === null) return false;
    const next = draft;
    const json = JSON.stringify(next);
    const sid = deps.sessionId();
    saving = true;
    error = null;
    try {
      await commandLog.pushTimed(replaceCmd(coll, id, json), sid, () => replaceDocument(sid, db, coll, id, json));
      undo.record({ kind: "replace", sessionId: sid, db, coll, before: doc, after: next });
      doc = next;
      draft = null;
      mode = "view";
      stale = false;
      lastRow = next; // the host swaps this object into its rows; sync() must not treat it as a change
      deps.onSaved(next);
      return true;
    } catch (e) {
      error = errorMessage(e);
      return false;
    } finally {
      saving = false;
    }
  }

  /**
   * The host's rows changed (reload, page change, inline edit, re-run). A vanished document closes a
   * clean drawer and is flagged stale on a dirty one; a changed row is reloaded when clean and flagged
   * as a conflict (stale) when dirty, so a save never silently reverts someone else's change.
   */
  function sync(rows: Doc[]) {
    if (!open || targetId === null) return;
    const row = rows.find((r) => idJson(r) === targetId);
    if (!row) {
      if (dirty) stale = true;
      else reset();
      return;
    }
    if (row === lastRow) return;
    if (dirty) {
      stale = true;
      return;
    }
    void load(row, false);
  }

  return {
    get open() { return open; },
    get mode() { return mode; },
    get doc() { return doc; },
    get draft() { return draft; },
    get changes() { return changes; },
    get dirty() { return dirty; },
    get loading() { return loading; },
    get error() { return error; },
    get saving() { return saving; },
    get canEdit() { return canEdit; },
    get stale() { return stale; },
    get confirm() { return confirm; },
    show,
    follow,
    retry,
    refreshIfShowing,
    close,
    requestClose,
    confirmSave,
    confirmDiscard,
    confirmStay,
    startEdit,
    setDraft,
    discard,
    save,
    sync,
  };
}

export type DocPeek = ReturnType<typeof createDocPeek>;

// One drawer per owner (a cached collection view / query run), created in its own effect root so its
// state — including an unsaved draft — outlives the component that shows it (tab or view switches).
const peeks = new WeakMap<object, DocPeek>();

export function docPeekFor(owner: object, deps: DocPeekDeps): DocPeek {
  let p = peeks.get(owner);
  if (!p) {
    $effect.root(() => {
      p = createDocPeek(deps);
    });
    peeks.set(owner, p!);
  }
  return p!;
}
