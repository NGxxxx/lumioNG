import * as m from "#lib/paraglide/messages.js";
import type { MenuItem } from "../domain/gridView";

/** The grid context menu's Copy submenu (collection grid and query results share it). */
export function copyMenuChildren(selectedCount: number, hasId: boolean): MenuItem[] {
  return [
    { label: m.context_menu_copy_value(), action: "copyValue" },
    { label: m.context_menu_copy_field_path(), action: "copyPath" },
    { label: m.context_menu_copy_id(), action: "copyId", disabled: !hasId },
    { label: m.context_menu_copy_selected_json({ count: selectedCount }), action: "copyJson" },
    { label: m.context_menu_copy_selected_csv({ count: selectedCount }), action: "copyCsv" },
  ];
}
