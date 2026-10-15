// src/lib/domain/commands.ts

export type CommandId =
  // Global (app menu / toolbar)
  | "file.sessionManager"
  | "file.refresh"
  | "file.newQuery"
  | "file.newDocument"
  | "file.import"
  | "file.export"
  | "file.quit"
  | "query.run"
  | "query.runSelection"
  | "query.stop"
  | "query.explain"
  | "query.aggregate"
  | "query.save"
  | "query.history"
  | "goto.nextTab"
  | "goto.prevTab"
  | "goto.host"
  | "goto.database"
  | "goto.data"
  | "goto.schema"
  | "view.closeWorkTab"
  | "view.resetToDefault"
  | "view.resetLayout"
  | "view.commandPalette"
  | "view.toggleLog"
  | "view.toggleWrap"
  | "view.toggleSavedQueries"
  | "help.about"
  | "edit.undo"
  // Grid (result grid / data view)
  | "grid.newDocument"
  | "grid.duplicateDocument"
  | "grid.editDocument"
  | "grid.deleteDocument"
  | "grid.commitEdit"
  | "grid.cancelEdit"
  | "grid.selectAll"
  | "grid.invertSelection"
  | "grid.copySelected"
  | "grid.focusFilter"
  | "grid.cursorDown"
  | "grid.cursorUp"
  | "grid.extendDown"
  | "grid.extendUp"
  | "grid.first"
  | "grid.last"
  | "grid.pageUp"
  | "grid.pageDown"
  | "grid.prevPage"
  | "grid.nextPage"
  | "grid.toggleRow"
  | "grid.peek"
  | "grid.peekEdit"
  | "grid.followRef"
  | "grid.clearOrClose"
  | "grid.slashFilter"
  | "help.shortcuts"
  // Editor (query tab / CodeMirror)
  | "editor.run"
  | "editor.runSelection"
  | "editor.explain"
  | "editor.format"
  | "editor.clear"
  | "editor.find"
  | "editor.replace"
  | "editor.findNext"
  | "editor.toggleComment";

/** HeidiSQL-mapped default shortcuts; commands with no sensible default (`file.sessionManager`, `file.quit`) are intentionally absent. */
export const SHORTCUTS: Partial<Record<CommandId, string>> = {
  "file.refresh": "F5",
  "file.newQuery": "Mod+T",
  "file.newDocument": "Mod+Alt+N",
  "file.import": "Mod+Alt+I",
  "file.export": "Mod+Alt+E",
  "query.run": "F9",
  "query.runSelection": "Mod+F9",
  "query.stop": "Escape",
  "query.explain": "Mod+Shift+F9",
  "query.aggregate": "Mod+Alt+A",
  "query.save": "Mod+S",
  "query.history": "Mod+Shift+H",
  "goto.nextTab": "Mod+Tab",
  "goto.prevTab": "Mod+Shift+Tab",
  "goto.host": "Mod+1",
  "goto.database": "Mod+2",
  "goto.data": "Mod+3",
  "goto.schema": "Mod+4",
  "view.closeWorkTab": "Mod+F4",
  "view.commandPalette": "Mod+K",
  "help.about": "F1",
  "edit.undo": "Mod+Z",
  "grid.newDocument": "Insert",
  "grid.duplicateDocument": "Mod+Insert",
  "grid.editDocument": "F2",
  "grid.deleteDocument": "Mod+Delete",
  "grid.commitEdit": "Mod+Enter",
  "grid.cancelEdit": "Escape",
  "grid.selectAll": "Mod+A",
  "grid.invertSelection": "Mod+I",
  "grid.copySelected": "Mod+C",
  "grid.focusFilter": "Mod+F",
  // Grid navigation: handled by ResultGrid while it has focus (never by the global dispatcher,
  // which only runs ids present in the page's command registry).
  "grid.cursorDown": "ArrowDown",
  "grid.cursorUp": "ArrowUp",
  "grid.extendDown": "Shift+ArrowDown",
  "grid.extendUp": "Shift+ArrowUp",
  "grid.first": "Home",
  "grid.last": "End",
  "grid.pageUp": "PageUp",
  "grid.pageDown": "PageDown",
  "grid.prevPage": "[",
  "grid.nextPage": "]",
  "grid.toggleRow": "x",
  "grid.peek": "Space",
  "grid.peekEdit": "e",
  "grid.followRef": "g",
  "grid.clearOrClose": "Escape",
  "grid.slashFilter": "/",
  "help.shortcuts": "?",
  "editor.run": "F9",
  "editor.runSelection": "Mod+F9",
  "editor.explain": "Mod+Shift+F9",
  "editor.format": "Mod+F8",
  "editor.clear": "Mod+W",
  "editor.find": "Mod+F",
  "editor.replace": "Mod+R",
  "editor.findNext": "F3",
  "editor.toggleComment": "Mod+/",
};

/** Sections of the shortcut sheet; together they list every id in `SHORTCUTS` exactly once. */
export const COMMAND_GROUPS: { group: "general" | "navigation" | "grid" | "editor"; ids: CommandId[] }[] = [
  {
    group: "general",
    ids: [
      "view.commandPalette", "help.shortcuts", "help.about", "file.refresh", "file.newQuery", "file.newDocument",
      "file.import", "file.export", "query.run", "query.runSelection", "query.stop", "query.explain",
      "query.aggregate", "query.save", "query.history", "view.closeWorkTab", "edit.undo",
    ],
  },
  {
    group: "navigation",
    ids: ["goto.host", "goto.database", "goto.data", "goto.schema", "goto.nextTab", "goto.prevTab"],
  },
  {
    group: "grid",
    ids: [
      "grid.cursorDown", "grid.cursorUp", "grid.extendDown", "grid.extendUp", "grid.first", "grid.last",
      "grid.pageUp", "grid.pageDown", "grid.prevPage", "grid.nextPage", "grid.toggleRow", "grid.peek",
      "grid.peekEdit", "grid.followRef", "grid.clearOrClose", "grid.slashFilter", "grid.focusFilter", "grid.selectAll",
      "grid.invertSelection", "grid.copySelected", "grid.newDocument", "grid.duplicateDocument",
      "grid.editDocument", "grid.deleteDocument", "grid.commitEdit", "grid.cancelEdit",
    ],
  },
  {
    group: "editor",
    ids: [
      "editor.run", "editor.runSelection", "editor.explain", "editor.format", "editor.clear", "editor.find",
      "editor.replace", "editor.findNext", "editor.toggleComment",
    ],
  },
];

/** Extra keys that do the same as a command's primary shortcut (shown together in the shortcut sheet). */
export const GRID_ALIASES: Partial<Record<CommandId, string[]>> = {
  "grid.cursorDown": ["j"],
  "grid.cursorUp": ["k"],
};

/** A registry entry: whether the action is currently available, and what running it does. Labels stay local to whichever component renders the command (menu item text vs. toolbar tooltip legitimately differ) — this type deliberately carries no label. */
export type Command = {
  disabled: boolean;
  run: () => void;
};
