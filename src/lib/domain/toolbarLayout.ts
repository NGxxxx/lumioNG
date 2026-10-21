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
  | "document"
  | "watch"
  | "compare";

/** One header action: an icon button, the single filled primary button, or an item in the ⋯ menu. */
export type ToolbarEntry = { id: CommandId; style: "icon" | "primary"; overflow?: boolean };

const icon = (id: CommandId): ToolbarEntry => ({ id, style: "icon" });
const more = (id: CommandId): ToolbarEntry => ({ id, style: "icon", overflow: true });

const LAYOUT: Record<ViewKey, ToolbarEntry[]> = {
  "collection.data": [
    icon("file.refresh"),
    icon("file.import"),
    icon("file.export"),
    icon("query.watch"),
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
  database: [icon("file.refresh"), icon("file.import"), icon("query.watch"), more("file.newQuery")],
  host: [icon("file.refresh"), icon("query.watch")],
  // Run / Stop / Explain / Save live in the query tab's own title row.
  query: [],
  // The document form keeps its own Cancel button; Save is mirrored here as the primary action.
  document: [{ id: "query.save", style: "primary" }],
  // Record / Pause / Clear / Export live in the watch tab's own bar.
  watch: [],
  // Compare / Dry run / Sync live in the compare tab itself.
  compare: [],
};

/** Header actions for `view`, in display order (overflow entries render inside the ⋯ menu). */
export function toolbarFor(view: ViewKey): ToolbarEntry[] {
  return LAYOUT[view];
}
