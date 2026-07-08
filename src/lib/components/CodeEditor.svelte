<!-- src/lib/components/CodeEditor.svelte -->
<script lang="ts">
  import { onMount } from "svelte";
  import { EditorView, keymap, lineNumbers } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { bracketMatching } from "@codemirror/language";
  import {
    autocompletion,
    closeBrackets,
    closeBracketsKeymap,
    completionKeymap,
    type CompletionSource,
  } from "@codemirror/autocomplete";
  import { javascript } from "@codemirror/lang-javascript";
  import { js as beautifyJs } from "js-beautify";
  import { appEditorTheme } from "../domain/cmTheme";

  let { value, onChange, onSelectionChange, onRun, complete, readonly = false }: {
    value: string;
    onChange: (text: string) => void;
    onSelectionChange?: (from: number, to: number) => void;
    onRun?: () => void;
    complete?: CompletionSource;
    readonly?: boolean;
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
      autocompletion(complete ? { override: [complete], activateOnTyping: true } : {}),
      keymap.of([
        ...(onRun ? [{ key: "Mod-Enter", run: () => { onRun!(); return true; } }] : []),
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorState.readOnly.of(readonly),
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

  // Push EXTERNAL value changes into the view — only on a real diff, to avoid the
  // onChange → store → value feedback loop and wasted reparse transactions.
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

  // Pretty-prints the whole document (js-beautify), so one-liner queries like
  // db.users.find({name:"a"}) get expanded into readable multi-line code, not just reindented.
  export function format() {
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
