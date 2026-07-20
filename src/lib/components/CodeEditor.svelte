<!-- src/lib/components/CodeEditor.svelte -->
<script lang="ts">
  import { onMount } from "svelte";
  import { EditorView, keymap, lineNumbers } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap, toggleComment } from "@codemirror/commands";
  import { bracketMatching } from "@codemirror/language";
  import { search, openSearchPanel, findNext } from "@codemirror/search";
  import {
    autocompletion,
    closeBrackets,
    closeBracketsKeymap,
    completionKeymap,
    type CompletionSource,
  } from "@codemirror/autocomplete";
  import { javascript } from "@codemirror/lang-javascript";
  import { appEditorTheme } from "../domain/cmTheme";

  let { value, onChange, onSelectionChange, onRun, onRunSelection, onExplain, complete, readonly = false, wrap = false }: {
    value: string;
    onChange: (text: string) => void;
    onSelectionChange?: (from: number, to: number) => void;
    onRun?: () => void;
    onRunSelection?: () => void;
    onExplain?: () => void;
    complete?: CompletionSource;
    readonly?: boolean;
    wrap?: boolean;
  } = $props();

  let host: HTMLDivElement;
  let view: EditorView | null = null;

  onMount(() => {
    const extensions = [
      lineNumbers(),
      history(),
      bracketMatching(),
      closeBrackets(),
      javascript(),
      search(),
      autocompletion(complete ? { override: [complete], activateOnTyping: true } : {}),
      keymap.of([
        ...(onRun ? [{ key: "F9", run: () => { onRun!(); return true; } }] : []),
        ...(onRunSelection ? [{ key: "Mod-F9", run: () => { onRunSelection!(); return true; } }] : []),
        ...(onExplain ? [{ key: "Mod-Shift-F9", run: () => { onExplain!(); return true; } }] : []),
        { key: "Mod-F8", run: () => { format(); return true; } },
        { key: "Mod-w", run: () => { clear(); return true; } },
        { key: "Mod-/", run: toggleComment },
        { key: "Mod-f", run: openSearchPanel },
        { key: "Mod-r", run: openSearchPanel },
        { key: "F3", run: findNext },
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorState.readOnly.of(readonly),
      ...(wrap ? [EditorView.lineWrapping] : []),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChange(u.state.doc.toString());
        if (u.selectionSet && onSelectionChange) {
          const r = u.state.selection.main;
          onSelectionChange(r.from, r.to);
        }
      }),
      appEditorTheme(),
    ];
    // Seed the doc with the initial value; CodeMirror is the source of truth from here.
    view = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: host });
    return () => {
      view?.destroy();
      view = null;
    };
  });

  // Push EXTERNAL value changes into the view only on a real diff, to avoid an onChange → store → value feedback loop.
  $effect(() => {
    const next = value;
    if (view && next !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
    }
  });

  // Imperative commands for the context menu, called via bind:this.
  export function cut() {
    if (!view) return;
    const sel = view.state.selection.main;
    if (sel.empty) return;
    navigator.clipboard?.writeText(view.state.sliceDoc(sel.from, sel.to)).catch(() => {});
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert: "" } });
    view.focus();
  }

  export function copy() {
    if (!view) return;
    const sel = view.state.selection.main;
    if (sel.empty) return;
    navigator.clipboard?.writeText(view.state.sliceDoc(sel.from, sel.to)).catch(() => {});
  }

  export async function paste() {
    if (!view || !navigator.clipboard) return;
    try {
      const text = await navigator.clipboard.readText();
      const sel = view.state.selection.main;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: { anchor: sel.from + text.length },
      });
      view.focus();
    } catch {
      // Clipboard permission denied — silently no-op.
    }
  }

  export function clear() {
    if (!view) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } });
    view.focus();
  }

  // Pretty-prints the whole document (js-beautify) so one-liner queries get expanded into readable multi-line code.
  // js-beautify (~150kB) is lazy-loaded here so it doesn't ship in the main bundle for users who never click Format.
  export async function format() {
    if (!view) return;
    const { js_beautify: beautifyJs } = await import("js-beautify/js/lib/beautify.js");
    if (!view) return;
    const current = view.state.doc.toString();
    const formatted = beautifyJs(current, {
      indent_size: 2,
      space_in_empty_paren: false,
      brace_style: "collapse",
    });
    if (formatted === current) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: formatted } });
    view.focus();
  }
</script>

<div class="cm-host" bind:this={host}></div>

<style>
  .cm-host { height: 100%; overflow: hidden; }
  .cm-host :global(.cm-editor) { height: 100%; }
  .cm-host :global(.cm-scroller) { overflow: auto; }
</style>
