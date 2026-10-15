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
  | "goto.nextTab"
  | "goto.prevTab"
  | "goto.host"
  | "goto.database"
  | "goto.collection"
  | "goto.data"
  | "view.closeWorkTab"
  | "view.resetToDefault"
  | "view.commandPalette"
  | "help.about"
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
  "goto.nextTab": "Mod+Tab",
  "goto.prevTab": "Mod+Shift+Tab",
  "goto.host": "Mod+1",
  "goto.database": "Mod+2",
  "goto.collection": "Mod+3",
  "goto.data": "Mod+4",
  "view.closeWorkTab": "Mod+F4",
  "view.commandPalette": "Mod+K",
  "help.about": "F1",
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

/** A registry entry: whether the action is currently available, and what running it does. Labels stay local to whichever component renders the command (menu item text vs. toolbar tooltip legitimately differ) — this type deliberately carries no label. */
export type Command = {
  disabled: boolean;
  run: () => void;
};
