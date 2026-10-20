import * as m from "#lib/paraglide/messages.js";
import { idJson } from "../domain/docid";
import { clipboardTextOf } from "../domain/extjson";
import { type Doc } from "../domain/doc";
import { getByPath } from "../domain/schema";
import { isInlineEditable, isModalEditable } from "../domain/celledit";
import { duplicateForInsert } from "../domain/skeleton";
import type { FilterOp } from "../domain/filter";
import type { MenuItem } from "../domain/gridView";
import type { createRowSelection } from "./rowSelection.svelte";
import type { createCollectionBulk } from "./collectionBulk.svelte";
import type { createExportRequest } from "./exportRequest.svelte";

/** What the context-menu block needs from the owning collection view (all read lazily). */
export interface CollectionMenuCtx {
  getDocs: () => Doc[];
  selection: ReturnType<typeof createRowSelection>;
  getBulk: () => ReturnType<typeof createCollectionBulk>;
  getExportFlow: () => ReturnType<typeof createExportRequest>;
  filterBy: (path: string, op: FilterOp, value?: unknown) => Promise<void>;
  reloadDocs: () => Promise<void>;
  copy: (text: string) => Promise<void>;
  copySelectedAs: (format: "json" | "csv") => Promise<void>;
  requestDeleteSelected: () => void;
  startEdit: (row: number, key: string) => Promise<void>;
  newDocument: () => Doc;
}

/** The cell right-click menu of one collection view: which items it offers and what each one does. */
export function createCollectionMenu(ctx: CollectionMenuCtx) {
  const { selection } = ctx;

  function menuItems(): MenuItem[] {
    const menu = selection.menu;
    if (!menu) return [];
    const value = getByPath(ctx.getDocs()[menu.row], menu.key);
    const n = selection.effectiveSelectionCount();
    const hasId = idJson(ctx.getDocs()[menu.row]) !== null;
    const items: MenuItem[] = [];
    if (n === 1) items.push({ label: m.peek_quick_look(), action: "peek" });
    if (n === 1) items.push({ label: m.cell_filter_eq(), action: "filterEq" }, { label: m.cell_filter_ne(), action: "filterNe" });
    if (n === 1) items.push({ label: m.cell_filter_exists(), action: "filterExists" }, { label: m.cell_filter_empty(), action: "filterEmpty" });
    if (n === 1) items.push({ label: m.context_menu_open_document(), action: "open" });
    if (n === 1 && hasId) items.push({ label: m.menu_watch_document(), action: "watchDoc" });
    if (menu.source === "tree") items.push({ label: m.context_menu_expand_full_depth(), action: "expandFullDepth" });
    items.push({ label: m.context_menu_refresh(), action: "refresh" });
    items.push({
      label: m.context_menu_edit_cell(),
      action: "editCell",
      disabled: !isInlineEditable(menu.key, value) && !isModalEditable(menu.key, value),
    });
    items.push({
      label: m.context_menu_copy(),
      action: "copy",
      children: [
        { label: m.context_menu_copy_value(), action: "copyValue" },
        { label: m.context_menu_copy_field_path(), action: "copyPath" },
        { label: m.context_menu_copy_id(), action: "copyId", disabled: !hasId },
        { label: m.context_menu_copy_selected_json({ count: n }), action: "copyJson" },
        { label: m.context_menu_copy_selected_csv({ count: n }), action: "copyCsv" },
      ],
    });
    items.push({
      label: m.context_menu_export(),
      action: "export",
      children: [
        { label: m.context_menu_export_selected({ count: n }), action: "exportSelected" },
        { label: m.context_menu_export_all_filter(), action: "exportFilter" },
      ],
    });
    items.push({
      label: m.context_menu_update(),
      action: "update",
      children: [
        { label: m.context_menu_update_selected({ count: n }), action: "updateSelected" },
        { label: m.context_menu_update_all_filter(), action: "updateAll" },
      ],
    });
    items.push({
      label: m.context_menu_delete(),
      action: "delete",
      children: [
        { label: m.context_menu_delete_selected({ count: n }), action: "deleteSelected" },
        { label: m.context_menu_delete_all_filter(), action: "deleteAll" },
      ],
    });
    items.push(
      { label: m.context_menu_new_document(), action: "newDoc" },
      { label: m.context_menu_duplicate_document(), action: "duplicate", disabled: n !== 1 },
    );
    return items;
  }

  /** Returns the doc to open for "open", `{ insert }` (a pre-built skeleton/duplicate) for New/Duplicate,
   *  or `{ expandFullDepth }` (a tree doc index) for the Tree view's "Expand full depth". */
  function onMenuSelect(action: string): { open: Doc } | { insert: Doc } | { expandFullDepth: number } | { peek: Doc } | { watch: string } | null {
    const menu = selection.menu;
    if (!menu) return null;
    const row = menu.row;
    const key = menu.key;
    const doc = ctx.getDocs()[row];
    // closeMenu() is called AFTER the switch so effectiveRows() (used by requestExport/copySelectedAs) can still read menu.row.
    switch (action) {
      case "peek":
        selection.closeMenu();
        return { peek: doc };
      case "filterEq":
      case "filterNe":
        selection.closeMenu();
        void ctx.filterBy(key, action === "filterEq" ? "eq" : "ne", getByPath(doc, key) ?? null);
        return null;
      case "filterExists":
        selection.closeMenu();
        void ctx.filterBy(key, "exists");
        return null;
      case "filterEmpty":
        selection.closeMenu();
        // Spliced into the applied text like the other cell filters, so a filter that is not
        // chip-shaped (e.g. `$or`) is kept instead of replaced.
        void ctx.filterBy(key, "empty");
        return null;
      case "open":
        selection.closeMenu();
        return { open: doc };
      case "watchDoc": {
        selection.closeMenu();
        const id = idJson(doc);
        return id === null ? null : { watch: id };
      }
      case "expandFullDepth":
        selection.closeMenu();
        return { expandFullDepth: row };
      case "refresh":
        ctx.reloadDocs();
        break;
      case "copyValue":
        ctx.copy(clipboardTextOf(getByPath(doc, key)));
        break;
      case "copyPath":
        ctx.copy(key);
        break;
      case "copyId":
        ctx.copy(idJson(doc) ?? "");
        break;
      case "copyJson":
        ctx.copySelectedAs("json");
        break;
      case "copyCsv":
        ctx.copySelectedAs("csv");
        break;
      case "exportSelected":
        ctx.getExportFlow().requestExport("selection");
        break;
      case "exportFilter":
        ctx.getExportFlow().requestExport("filter");
        break;
      case "updateSelected":
        ctx.getBulk().openBulk("update", "selection");
        break;
      case "deleteSelected":
        ctx.requestDeleteSelected();
        break;
      case "updateAll":
        ctx.getBulk().openBulk("update", "filter");
        break;
      case "deleteAll":
        ctx.getBulk().openBulk("delete", "filter");
        break;
      case "newDoc":
        selection.closeMenu();
        return { insert: ctx.newDocument() };
      case "duplicate": {
        const dup = doc ? duplicateForInsert(doc) : null;
        selection.closeMenu();
        return dup ? { insert: dup } : null;
      }
      case "editCell":
        ctx.startEdit(row, key);
        break;
    }
    selection.closeMenu();
    return null;
  }

  return { menuItems, onMenuSelect };
}
