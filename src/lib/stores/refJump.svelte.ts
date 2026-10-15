// src/lib/stores/refJump.svelte.ts — following an ObjectId to the document it references.
// Nothing is looked up before a click; each click is at most one `_id` lookup (the newest click wins);
// a whole-database search only runs when the user asks for it.
import { findById } from "../api/documents";
import { listPlainCollections } from "../api/connection";
import { errorMessage } from "../api/errors";
import { isSelfId, memoryKey, normalizeRefPath, refIdText, resolveRef, type RefResolution, type RefTarget } from "../domain/refTarget";
import type { Doc } from "../domain/doc";
import type { DocPeek } from "./docPeek.svelte";
import { forget as forgetTarget, getRemembered, remember } from "./refMemory";

export type RefInput = { path: string; value: unknown; db: string; coll: string };

export type RefMenu = {
  input: RefInput;
  /** Where the menu sits (the clicked cell), when known. */
  anchor: { x: number; y: number } | null;
  /** Candidate collections from the name guess (may be empty). */
  targets: RefTarget[];
  /** The collection that was tried and didn't contain the document. */
  notFoundIn: string | null;
  remembered: string | null;
  searching: { done: number; total: number } | null;
  /** PROD: the whole-database search waits for one confirmation. */
  confirmSearch: boolean;
  /** The whole-database search finished without a hit. */
  notFoundAnywhere: boolean;
  error: string | null;
};

export interface RefJumpDeps {
  sessionId: () => string;
  connId: () => number | null;
  /** The database's collection names as the sidebar already knows them (no request). */
  collections: (db: string) => string[];
  peek: DocPeek;
  prod: () => boolean;
}

export function createRefJump(deps: RefJumpDeps) {
  let menu = $state.raw<RefMenu | null>(null);
  let pending = $state(false);
  let seq = 0;

  const keyOf = (i: RefInput) => memoryKey(deps.connId(), i.db, i.coll, i.path);

  async function lookup(target: RefTarget, idText: string): Promise<Doc | null> {
    const text = await findById(deps.sessionId(), target.db, target.coll, idText);
    return text ? (JSON.parse(text) as Doc) : null;
  }

  function openMenu(input: RefInput, anchor: RefMenu["anchor"], targets: RefTarget[], notFoundIn: string | null, error: string | null = null) {
    menu = { input, anchor, targets, notFoundIn, remembered: getRemembered(keyOf(input)), searching: null, confirmSearch: false, notFoundAnywhere: false, error };
  }

  /** Follows the reference in `input.value`. Opens the target in the drawer, or a menu to choose where to look. */
  async function jump(raw: RefInput, anchor: RefMenu["anchor"] = null) {
    const input = { ...raw, path: normalizeRefPath(raw.path) };
    const idText = refIdText(input.value);
    if (idText === null || isSelfId(input.path)) return;
    const my = ++seq;
    const res: RefResolution = resolveRef(input, deps.collections(input.db), getRemembered(keyOf(input)));
    if (res.kind !== "one") {
      pending = false;
      openMenu(input, anchor, res.kind === "many" ? res.targets : [], null);
      return;
    }
    pending = true;
    menu = null;
    try {
      const found = await lookup(res.target, idText);
      if (my !== seq) return; // a newer click took over
      if (found) deps.peek.showRef(found, res.target, input.path);
      else openMenu(input, anchor, [], res.target.coll);
    } catch (e) {
      if (my !== seq) return;
      openMenu(input, anchor, [], null, errorMessage(e));
    } finally {
      if (my === seq) pending = false;
    }
  }

  /** The user chose where to look; a hit is remembered for this field. */
  async function pick(target: RefTarget) {
    const m = menu;
    if (!m) return;
    const idText = refIdText(m.input.value);
    if (idText === null) return;
    const my = ++seq;
    pending = true;
    try {
      const found = await lookup(target, idText);
      if (my !== seq) return;
      if (found) {
        remember(keyOf(m.input), target.coll);
        menu = null;
        deps.peek.showRef(found, target, m.input.path);
      } else {
        menu = { ...m, notFoundIn: target.coll, error: null };
      }
    } catch (e) {
      if (my === seq) menu = { ...m, error: errorMessage(e) };
    } finally {
      if (my === seq) pending = false;
    }
  }

  /** Looks in every collection of the database, one at a time, until the document is found. */
  async function searchAll() {
    const m = menu;
    if (!m) return;
    if (deps.prod() && !m.confirmSearch) {
      menu = { ...m, confirmSearch: true };
      return;
    }
    const idText = refIdText(m.input.value);
    if (idText === null) return;
    const my = ++seq;
    // Real collections only: a lookup on a view would run its whole pipeline.
    let listed: string[];
    try {
      listed = await listPlainCollections(deps.sessionId(), m.input.db);
    } catch (e) {
      // Without the list we can't tell views apart: don't search blind.
      if (my === seq) menu = { ...m, error: errorMessage(e), searching: null };
      return;
    }
    if (my !== seq) return;
    const colls = listed.filter((c) => !c.startsWith("system.") && c !== m.notFoundIn);
    menu = { ...m, searching: { done: 0, total: colls.length }, error: null };
    for (let i = 0; i < colls.length; i++) {
      const target = { db: m.input.db, coll: colls[i] };
      let found: Doc | null = null;
      try {
        found = await lookup(target, idText);
      } catch {
        found = null; // a view or a forbidden collection: keep going
      }
      if (my !== seq) return;
      if (found) {
        remember(keyOf(m.input), target.coll);
        menu = null;
        deps.peek.showRef(found, target, m.input.path);
        return;
      }
      menu = menu && { ...menu, searching: { done: i + 1, total: colls.length } };
    }
    if (my === seq && menu) menu = { ...menu, searching: null, notFoundAnywhere: true };
  }

  function cancelSearch() {
    seq++;
    if (menu) menu = { ...menu, searching: null };
  }

  function forget() {
    if (!menu) return;
    forgetTarget(keyOf(menu.input));
    menu = { ...menu, remembered: null };
  }

  function closeMenu() {
    seq++;
    pending = false;
    menu = null;
  }

  return {
    get menu() { return menu; },
    get pending() { return pending; },
    jump,
    pick,
    searchAll,
    cancelSearch,
    forget,
    closeMenu,
  };
}

export type RefJump = ReturnType<typeof createRefJump>;
