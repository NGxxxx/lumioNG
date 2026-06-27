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
</script>

<div class="cm-host" bind:this={host}></div>

<style>
  .cm-host { height: 100%; overflow: hidden; }
  .cm-host :global(.cm-editor) { height: 100%; }
  .cm-host :global(.cm-scroller) { overflow: auto; }
</style>
