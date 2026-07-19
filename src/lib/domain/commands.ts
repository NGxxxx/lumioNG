// src/lib/domain/commands.ts

export type CommandScope = "global" | "grid" | "editor";

export type CommandId =
  // Global (app menu / toolbar)
  | "file.refresh"
  | "file.newQuery"
  | "file.newDocument"
  | "file.import"
  | "file.export"
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
  | "help.about"
  // Grid (result grid / data view)
  | "grid.newDocument"
  | "grid.duplicateDocument"
  | "grid.deleteDocument"
  | "grid.editCell"
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

export const COMMAND_SCOPE: Record<CommandId, CommandScope> = {
  "file.refresh": "global",
  "file.newQuery": "global",
  "file.newDocument": "global",
  "file.import": "global",
  "file.export": "global",
  "query.run": "global",
  "query.runSelection": "global",
  "query.stop": "global",
  "query.explain": "global",
  "query.aggregate": "global",
  "query.save": "global",
  "goto.nextTab": "global",
  "goto.prevTab": "global",
  "goto.host": "global",
  "goto.database": "global",
  "goto.collection": "global",
  "goto.data": "global",
  "view.closeWorkTab": "global",
  "help.about": "global",
  "grid.newDocument": "grid",
  "grid.duplicateDocument": "grid",
  "grid.deleteDocument": "grid",
  "grid.editCell": "grid",
  "grid.commitEdit": "grid",
  "grid.cancelEdit": "grid",
  "grid.selectAll": "grid",
  "grid.invertSelection": "grid",
  "grid.copySelected": "grid",
  "grid.focusFilter": "grid",
  "editor.run": "editor",
  "editor.runSelection": "editor",
  "editor.explain": "editor",
  "editor.format": "editor",
  "editor.clear": "editor",
  "editor.find": "editor",
  "editor.replace": "editor",
  "editor.findNext": "editor",
  "editor.toggleComment": "editor",
};

/**
 * HeidiSQL-mapped default shortcuts (see the design spec's per-command [confirmed]/[adapted]
 * annotations for provenance). Commands with no HeidiSQL analog and no sensible default
 * (`file.sessionManager`, `file.quit`) are intentionally absent — `SHORTCUTS[id]` is `undefined`
 * for those, meaning "no keyboard shortcut".
 */
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
  "help.about": "F1",
  "grid.newDocument": "Insert",
  "grid.duplicateDocument": "Mod+Insert",
  "grid.deleteDocument": "Mod+Delete",
  "grid.editCell": "F2",
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

/** Every command with a bound shortcut in a given scope — used for same-scope collision checks and to build dispatchers. */
export function shortcutsByScope(scope: CommandScope): { id: CommandId; shortcut: string }[] {
  return (Object.keys(SHORTCUTS) as CommandId[])
    .filter((id) => COMMAND_SCOPE[id] === scope)
    .map((id) => ({ id, shortcut: SHORTCUTS[id]! }));
}
