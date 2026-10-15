// src/lib/domain/toolbarLayout.ts — which registry commands the panel header shows for each view.
import type { CommandId } from "./commands";

/** The view the main panel is showing; the header's actions depend only on this. */
export type ViewKey =
  | "collection.data"
  | "collection.schema"
  | "collection.indexes"
  | "collection.info"
  | "database"
  | "host"
  | "query"
  | "document";

/** One header action: an icon button, the single filled primary button, or an item in the ⋯ menu. */
export type ToolbarEntry = { id: CommandId; style: "icon" | "primary"; overflow?: boolean };

const icon = (id: CommandId): ToolbarEntry => ({ id, style: "icon" });
const more = (id: CommandId): ToolbarEntry => ({ id, style: "icon", overflow: true });

const LAYOUT: Record<ViewKey, ToolbarEntry[]> = {
  "collection.data": [
    icon("file.refresh"),
    icon("file.import"),
    icon("file.export"),
    more("query.aggregate"),
    more("grid.focusFilter"),
    more("view.toggleWrap"),
    more("view.toggleSavedQueries"),
    more("view.resetLayout"),
    { id: "file.newDocument", style: "primary" },
  ],
  "collection.schema": [icon("file.refresh")],
  "collection.indexes": [icon("file.refresh")],
  "collection.info": [icon("file.refresh")],
  database: [icon("file.refresh"), icon("file.import"), more("file.newQuery")],
  host: [icon("file.refresh")],
  // Run / Stop / Explain / Save live in the query tab's own title row.
  query: [],
  // The document form keeps its own Cancel button; Save is mirrored here as the primary action.
  document: [{ id: "query.save", style: "primary" }],
};

/** Header actions for `view`, in display order (overflow entries render inside the ⋯ menu). */
export function toolbarFor(view: ViewKey): ToolbarEntry[] {
  return LAYOUT[view];
}
