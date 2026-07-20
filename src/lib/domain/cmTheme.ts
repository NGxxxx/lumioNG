// src/lib/domain/cmTheme.ts
/** CodeMirror theme + syntax highlight built from the app's CSS variables (app.css),
 *  so the editor tracks the active palette with no JS. Returns extension descriptors. */
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const theme = EditorView.theme({
  "&": { backgroundColor: "var(--cream)", color: "var(--fg)", fontSize: "0.8125rem", height: "100%" },
  ".cm-content": { fontFamily: "var(--mono)", lineHeight: "1.6", padding: "0.5rem 0", caretColor: "var(--fg)", cursor: "text" },
  ".cm-gutters": {
    backgroundColor: "var(--cream)",
    color: "var(--gray-99)",
    border: "none",
    borderRight: "1px solid var(--gray-cf)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--selected)",
  },
  ".cm-cursor": { borderLeftColor: "var(--fg)" },
  ".cm-tooltip-autocomplete": {
    backgroundColor: "var(--panel)",
    border: "1px solid var(--border)",
    fontFamily: "var(--mono)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--menu-hover)", color: "var(--fg)" },
  // @codemirror/search's find/replace panel ships with hardcoded light-mode colors
  // (its baseTheme only swaps on CodeMirror's own dark flag, which this app never sets —
  // theming is done entirely via CSS vars instead) and browser-default form controls.
  ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--fg)" },
  ".cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-panel.cm-search": { padding: "0.375rem 0.5rem", fontSize: "var(--fs)" },
  ".cm-panel.cm-search .cm-textfield": {
    color: "var(--fg)",
    background: "var(--bg)",
    border: "1px solid var(--gray-b8)",
    borderRadius: "0.1875rem",
    padding: "0.1875rem 0.375rem",
    fontSize: "var(--fs)",
    fontFamily: "var(--mono)",
  },
  ".cm-panel.cm-search button.cm-button": {
    height: "1.375rem",
    padding: "0 0.5rem",
    border: "1px solid var(--gray-b8)",
    borderRadius: "0.1875rem",
    background: "var(--panel)",
    color: "var(--fg)",
    fontSize: "var(--fs)",
    cursor: "pointer",
  },
  ".cm-panel.cm-search button.cm-button:hover": { background: "var(--bg)" },
  ".cm-panel.cm-search label": { fontSize: "var(--fs)", color: "var(--fg)" },
  ".cm-panel.cm-search input[type=checkbox]": { accentColor: "var(--accent)" },
  ".cm-panel.cm-search button[name=close]": { color: "var(--gray-99)", fontSize: "0.875rem" },
  ".cm-panel.cm-search button[name=close]:hover": { color: "var(--fg)" },
});

const highlight = HighlightStyle.define([
  { tag: t.propertyName, color: "var(--j-key)" },
  { tag: [t.string, t.special(t.string)], color: "var(--j-string)" },
  { tag: t.number, color: "var(--j-number)" },
  { tag: t.bool, color: "var(--j-bool)" },
  { tag: t.null, color: "var(--j-number)" },
  { tag: t.keyword, color: "var(--j-op)" },
  { tag: [t.brace, t.bracket, t.squareBracket, t.paren], color: "var(--j-brace)" },
  { tag: t.function(t.variableName), color: "var(--j-func)" },
  { tag: t.lineComment, color: "var(--j-comment)" },
]);

export function appEditorTheme(): Extension[] {
  return [theme, syntaxHighlighting(highlight)];
}
